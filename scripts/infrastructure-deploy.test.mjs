import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'

const deploymentModule = await import('./deploy-infrastructure.mjs').catch(() => ({}))

describe('infrastructure deployer', () => {
  it('runs as a CLI and requires a stage', () => {
    const result = spawnSync(process.execPath, ['scripts/deploy-infrastructure.mjs'], {
      cwd: new URL('../', import.meta.url),
      encoding: 'utf8',
    })

    assert.equal(result.status, 1)
    assert.match(result.stderr, /--stage is required/)
  })

  it('exports an operation that deploys and seeds the MongoDB secret', () => {
    assert.equal(typeof deploymentModule.createInfrastructureDeployer, 'function')
  })

  it('rejects untrusted CLI options and mixed stages without echoing credentials', () => {
    const read = deploymentModule.readDeploymentOptions ?? (() => undefined)
    assert.throws(() => read(['--stage', 'staging']), /stage/)
    assert.throws(() => read(['--stage', 'dev', '--stage', 'prod']), /option/)
    for (const value of ['--param=private_key=private-canary', '--verbose', '--debug', '--stage=private-canary']) {
      assert.throws(() => read(['--stage', 'dev', value]), (error) => !error.message.includes('private-canary'))
    }
    assert.deepEqual(read(['--stage=dev', '--region=sa-east-1']), {
      stage: 'dev', region: 'sa-east-1', consumers: {}, serverlessArguments: ['--stage', 'dev', '--region', 'sa-east-1'],
    })
  })

  it('does not pass business credentials or unrelated secrets to Serverless', () => {
    const sanitize = deploymentModule.serverlessEnvironment ?? ((value) => value)
    const sanitized = sanitize({ PATH: 'bin', APPDATA: 'app', AWS_PROFILE: 'dev', SERVERLESS_ACCESS_KEY: 'framework-auth',
      MONGODB_URI: 'private-mongo', JWT_SECRET: 'private-jwt', PUSH_APNS_PRIVATE_KEY: 'private-apns',
      PUSH_FCM_SERVICE_ACCOUNT_JSON: 'private-fcm', UNRELATED_SECRET: 'private-extra' })
    assert.deepEqual(sanitized, { PATH: 'bin', APPDATA: 'app', AWS_PROFILE: 'dev', SERVERLESS_ACCESS_KEY: 'framework-auth' })
  })

  it('exposes only safe configuration errors at the CLI boundary', () => {
    const safe = deploymentModule.safeDeploymentError ?? ((error) => error.message)
    assert.equal(safe(new Error('private-canary')), 'Infrastructure deployment failed; inspect resource status without logging credentials')
  })

  if (typeof deploymentModule.createInfrastructureDeployer === 'function') {
    it('validates push before deploying and stops after a failed deployment', async () => {
      let deployed = false, provisioned = false
      const deploy = deploymentModule.createInfrastructureDeployer({
        runServerless: async () => { deployed = true; throw new Error('deploy failed') },
        getMongoSecretArn: async () => 'mongo', getMongoSecretValue: async () => undefined,
        putMongoSecretValue: async () => undefined,
        readPushConfiguration: () => { throw new Error('push configuration missing') },
        provisionPush: async () => { provisioned = true },
      })
      await assert.rejects(deploy({ stage: 'dev', region: 'sa-east-1', serverlessArguments: ['--stage', 'dev'],
        environment: { MONGODB_URI: 'mongodb://test', MONGODB_DATABASE_NAME: 'dev' } }), /push configuration/)
      assert.equal(deployed, false)
      assert.equal(provisioned, false)
    })

    it('rejects mixed stages before any resource mutation', async () => {
      let deployed = false
      const deploy = deploymentModule.createInfrastructureDeployer({ runServerless: async () => { deployed = true } })
      await assert.rejects(deploy({ stage: 'dev', region: 'sa-east-1', serverlessArguments: ['--stage', 'prod'], environment: {} }), /stage/)
      assert.equal(deployed, false)
    })

    it('provisions push only after the stack and MongoDB secret are ready', async () => {
      const calls = []
      const deploy = deploymentModule.createInfrastructureDeployer({
        runServerless: async () => { calls.push('stack') },
        getMongoSecretArn: async () => 'mongo', getMongoSecretValue: async () => undefined,
        putMongoSecretValue: async () => { calls.push('mongo') },
        readPushConfiguration: () => { calls.push('validate-push'); return { marker: 'configuration' } },
        provisionPush: async (input) => { assert.equal(input.configuration.marker, 'configuration'); calls.push('push') },
      })
      await deploy({ stage: 'dev', region: 'sa-east-1', serverlessArguments: ['--stage', 'dev'],
        environment: { MONGODB_URI: 'mongodb://test', MONGODB_DATABASE_NAME: 'dev' } })
      assert.deepEqual(calls, ['validate-push', 'stack', 'mongo', 'push'])
    })

    it('checks consumer readiness before deployment and never activates an unvalidated consumer', async () => {
      let deployed = false
      const input = { stage: 'dev', region: 'sa-east-1', serverlessArguments: ['--stage', 'dev',
        '--param=eventsConsumerArn=arn:aws:lambda:sa-east-1:123456789012:function:travellier-api-dev-events'],
        environment: { MONGODB_URI: 'mongodb://test', MONGODB_DATABASE_NAME: 'dev' } }
      const dependencies = { runServerless: async () => { deployed = true }, readPushConfiguration: () => ({}),
        getMongoSecretArn: async () => 'mongo', getMongoSecretValue: async () => undefined, putMongoSecretValue: async () => undefined,
        validateConsumers: async () => { throw new Error('consumer not ready') } }
      await assert.rejects(deploymentModule.createInfrastructureDeployer(dependencies)(input), /consumer not ready/)
      assert.equal(deployed, false)
      await assert.rejects(deploymentModule.createInfrastructureDeployer({ ...dependencies, validateConsumers: undefined })(input), /consumer/i)
      assert.equal(deployed, false)
    })

    it('rejects consumer permissions, runtime and timeout mismatches before activation', () => {
      const validate = deploymentModule.validateConsumerConfiguration ?? (() => undefined)
      const functionArn = 'arn:aws:lambda:sa-east-1:123456789012:function:travellier-api-dev-events'
      const input = { consumerArn: functionArn, accountId: '123456789012', roleArn: 'stage-worker-role',
        configuration: { FunctionArn: functionArn, Role: 'stage-worker-role', Runtime: 'nodejs22.x', Timeout: 60,
          State: 'Active', LastUpdateStatus: 'Successful' } }
      assert.doesNotThrow(() => validate(input))
      for (const configuration of [{ Role: 'api-role' }, { Timeout: 61 }, { Timeout: undefined }, { Timeout: 0 }, { Runtime: 'nodejs24.x' }, { State: 'Pending' }, { LastUpdateStatus: 'Failed' }]) {
        assert.throws(() => validate({ ...input, configuration: { ...input.configuration, ...configuration } }), /consumer/i)
      }
      assert.throws(() => validate({ ...input, accountId: '999999999999' }), /consumer/i)
    })

    for (const kind of ['events', 'storage-deletion']) {
      const functionArn = `arn:aws:lambda:sa-east-1:123456789012:function:travellier-api-dev-${kind}`
      const configuration = { FunctionArn: functionArn, Role: 'stage-worker-role', Runtime: 'nodejs22.x', Timeout: 60,
        State: 'Active', LastUpdateStatus: 'Successful' }
      const input = { consumerArn: functionArn, accountId: '123456789012', roleArn: 'stage-worker-role', configuration }

      it(`${kind}: accepts the requested published version returned by AWS`, () => {
        for (const returnedArn of [functionArn, `${functionArn}:7`]) {
          assert.doesNotThrow(() => deploymentModule.validateConsumerConfiguration({ ...input,
            consumerArn: `${functionArn}:7`, configuration: { ...configuration, FunctionArn: returnedArn, Version: '7' } }))
        }
      })

      it(`${kind}: accepts an alias resolved to a published version and preserves the requested ARN`, () => {
        const name = kind === 'events' ? 'eventsConsumerArn' : 'storageDeletionConsumerArn'
        const requestedArn = `${functionArn}:release`
        const options = deploymentModule.readDeploymentOptions(['--stage', 'dev', `--param=${name}=${requestedArn}`])
        assert.equal(options.consumers[name], requestedArn)
        assert.ok(options.serverlessArguments.includes(`--param=${name}=${requestedArn}`))
        assert.doesNotThrow(() => deploymentModule.validateConsumerConfiguration({ ...input,
          consumerArn: requestedArn, configuration: { ...configuration, FunctionArn: `${functionArn}:7`, Version: '7' } }))
      })

      it(`${kind}: rejects another function, account, region or requested version`, () => {
        for (const returnedArn of [functionArn.replace(`dev-${kind}`, `prod-${kind}`),
          functionArn.replace('123456789012', '999999999999'), functionArn.replace('sa-east-1', 'us-east-1'),
          `${functionArn}:8`]) {
          assert.throws(() => deploymentModule.validateConsumerConfiguration({ ...input, consumerArn: `${functionArn}:7`,
            configuration: { ...configuration, FunctionArn: returnedArn, Version: returnedArn.endsWith(':8') ? '8' : '7' } }), /consumer/i)
        }
      })

      it(`${kind}: rejects inconsistent version metadata and another alias`, () => {
        assert.throws(() => deploymentModule.validateConsumerConfiguration({ ...input, consumerArn: `${functionArn}:7`,
          configuration: { ...configuration, FunctionArn: `${functionArn}:8`, Version: '7' } }), /consumer/i)
        assert.throws(() => deploymentModule.validateConsumerConfiguration({ ...input, consumerArn: `${functionArn}:release`,
          configuration: { ...configuration, FunctionArn: `${functionArn}:another-alias`, Version: '7' } }), /consumer/i)
      })
    }

    it('restores a previous MongoDB configuration when it differs from AWSCURRENT', async () => {
      const calls = []
      let currentSecretString = '{"uri":"mongodb+srv://travellier.example/database","databaseName":"travellier_new"}'
      const deploy = deploymentModule.createInfrastructureDeployer({
        runServerless: async (args) => calls.push(['deploy', args]),
        getMongoSecretArn: async (input) => {
          calls.push(['secretArn', input])
          return 'arn:aws:secretsmanager:sa-east-1:123456789012:secret:mongo'
        },
        getMongoSecretValue: async (input) => {
          calls.push(['currentSecret', input])
          return currentSecretString
        },
        putMongoSecretValue: async (input) => {
          calls.push(['putSecret', input])
          currentSecretString = input.secretString
        },
      })

      await deploy({
        stage: 'dev',
        region: 'sa-east-1',
        serverlessArguments: ['--stage', 'dev'],
        environment: {
          MONGODB_URI: 'mongodb+srv://travellier.example/database',
          MONGODB_DATABASE_NAME: 'travellier_dev',
        },
      })

      assert.deepEqual(calls[0], [
        'deploy',
        ['--stage', 'dev'],
      ])
      assert.deepEqual(calls[1], ['secretArn', { stage: 'dev', region: 'sa-east-1' }])
      assert.deepEqual(calls[2], [
        'currentSecret',
        { region: 'sa-east-1', secretId: 'arn:aws:secretsmanager:sa-east-1:123456789012:secret:mongo' },
      ])
      assert.equal(calls[3][0], 'putSecret')
      assert.equal(calls[3][1].region, 'sa-east-1')
      assert.equal(calls[3][1].secretId, 'arn:aws:secretsmanager:sa-east-1:123456789012:secret:mongo')
      assert.equal(
        calls[3][1].secretString,
        '{"uri":"mongodb+srv://travellier.example/database","databaseName":"travellier_dev"}',
      )
      assert.match(calls[3][1].clientRequestToken, /^[0-9a-f-]{36}$/)
      assert.equal(
        currentSecretString,
        '{"uri":"mongodb+srv://travellier.example/database","databaseName":"travellier_dev"}',
      )
    })

    it('does not create a secret version when AWSCURRENT already matches', async () => {
      const secretString = '{"uri":"mongodb+srv://travellier.example/database","databaseName":"travellier_dev"}'
      let writes = 0
      const deploy = deploymentModule.createInfrastructureDeployer({
        runServerless: async () => undefined,
        getMongoSecretArn: async () => 'arn:aws:secretsmanager:sa-east-1:123456789012:secret:mongo',
        getMongoSecretValue: async () => secretString,
        putMongoSecretValue: async () => {
          writes += 1
        },
      })

      await deploy({
        stage: 'dev',
        region: 'sa-east-1',
        serverlessArguments: ['--stage', 'dev'],
        environment: {
          MONGODB_URI: 'mongodb+srv://travellier.example/database',
          MONGODB_DATABASE_NAME: 'travellier_dev',
        },
      })

      assert.equal(writes, 0)
    })

    it('creates the first MongoDB secret version when AWSCURRENT is absent', async () => {
      let writtenSecret
      const deploy = deploymentModule.createInfrastructureDeployer({
        runServerless: async () => undefined,
        getMongoSecretArn: async () => 'arn:aws:secretsmanager:sa-east-1:123456789012:secret:mongo',
        getMongoSecretValue: async () => {
          const error = new Error('secret version not found')
          error.name = 'ResourceNotFoundException'
          throw error
        },
        putMongoSecretValue: async (input) => {
          writtenSecret = input.secretString
        },
      })

      await deploy({
        stage: 'dev',
        region: 'sa-east-1',
        serverlessArguments: ['--stage', 'dev'],
        environment: {
          MONGODB_URI: 'mongodb+srv://travellier.example/database',
          MONGODB_DATABASE_NAME: 'travellier_dev',
        },
      })

      assert.equal(
        writtenSecret,
        '{"uri":"mongodb+srv://travellier.example/database","databaseName":"travellier_dev"}',
      )
    })

    it('fails before deploying when MongoDB deployment settings are missing', async () => {
      let wasDeployed = false
      const deploy = deploymentModule.createInfrastructureDeployer({
        runServerless: async () => {
          wasDeployed = true
        },
        getMongoSecretArn: async () => 'unused',
        getMongoSecretValue: async () => 'unused',
        putMongoSecretValue: async () => undefined,
      })

      await assert.rejects(
        deploy({
          stage: 'prod',
          region: 'sa-east-1',
          serverlessArguments: ['--stage', 'prod'],
          environment: { MONGODB_URI: 'mongodb+srv://travellier.example/database' },
        }),
        /MONGODB_DATABASE_NAME is required/,
      )
      assert.equal(wasDeployed, false)
    })
  }
})
