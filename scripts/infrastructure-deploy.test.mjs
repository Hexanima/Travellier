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

  if (typeof deploymentModule.createInfrastructureDeployer === 'function') {
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
        serverlessArguments: ['--stage', 'dev', '--param', 'photoBucketName=dev-photos'],
        environment: {
          MONGODB_URI: 'mongodb+srv://travellier.example/database',
          MONGODB_DATABASE_NAME: 'travellier_dev',
        },
      })

      assert.deepEqual(calls[0], [
        'deploy',
        ['--stage', 'dev', '--param', 'photoBucketName=dev-photos'],
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
