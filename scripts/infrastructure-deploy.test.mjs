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
    it('writes MongoDB configuration to the deployed secret without passing it to Serverless', async () => {
      const calls = []
      const deploy = deploymentModule.createInfrastructureDeployer({
        runServerless: async (args) => calls.push(['deploy', args]),
        getMongoSecretArn: async (input) => {
          calls.push(['secretArn', input])
          return 'arn:aws:secretsmanager:sa-east-1:123456789012:secret:mongo'
        },
        putMongoSecretValue: async (input) => calls.push(['putSecret', input]),
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
      assert.equal(calls[2][0], 'putSecret')
      assert.equal(calls[2][1].region, 'sa-east-1')
      assert.equal(calls[2][1].secretId, 'arn:aws:secretsmanager:sa-east-1:123456789012:secret:mongo')
      assert.equal(
        calls[2][1].secretString,
        '{"uri":"mongodb+srv://travellier.example/database","databaseName":"travellier_dev"}',
      )
      assert.match(calls[2][1].clientRequestToken, /^[a-f0-9]{64}$/)
    })

    it('fails before deploying when MongoDB deployment settings are missing', async () => {
      let wasDeployed = false
      const deploy = deploymentModule.createInfrastructureDeployer({
        runServerless: async () => {
          wasDeployed = true
        },
        getMongoSecretArn: async () => 'unused',
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
