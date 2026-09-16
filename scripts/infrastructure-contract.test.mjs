import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const servicePath = join(rootDirectory, 'serverless.yml')
const packagePath = join(rootDirectory, 'package.json')

describe('Serverless infrastructure contract', () => {
  it('defines the Travellier HTTP API Lambda for configurable stages', () => {
    assert.ok(existsSync(servicePath), 'missing Serverless service configuration')

    const service = readFileSync(servicePath, 'utf8')

    assert.match(service, /^service:\s*travellier-api$/m)
    assert.match(service, /^\s*name:\s*aws$/m)
    assert.match(service, /^\s*runtime:\s*nodejs22\.x$/m)
    assert.match(service, /^\s*stage:\s*\$\{opt:stage, 'dev'\}$/m)
    assert.match(service, /^\s*dev:\s*$/m)
    assert.match(service, /^\s*prod:\s*$/m)
    assert.match(service, /^\s*handler:\s*apps\/api\/src\/lambda\.handler$/m)
    assert.match(service, /^\s*path:\s*\/{proxy\+}\s*$/m)
    assert.match(service, /^\s*method:\s*'\*'\s*$/m)
  })

  it('configures API Gateway CORS for Capacitor and local development', () => {
    assert.ok(existsSync(servicePath), 'missing Serverless service configuration')

    const service = readFileSync(servicePath, 'utf8')

    assert.match(service, /^\s*httpApi:\s*$/m)
    assert.match(service, /^\s*cors:\s*$/m)
    assert.match(service, /^\s*allowedOrigins:\s*$/m)
    assert.match(service, /^\s*-\s*capacitor:\/\/localhost\s*$/m)
    assert.match(service, /^\s*-\s*http:\/\/localhost\s*$/m)
    assert.match(service, /^\s*allowedHeaders:\s*$/m)
    assert.match(service, /^\s*-\s*Authorization\s*$/m)
    assert.match(service, /^\s*allowedMethods:\s*$/m)
    assert.match(service, /^\s*-\s*OPTIONS\s*$/m)
  })

  it('keeps runtime secrets out of the template and scopes Lambda permissions', () => {
    assert.ok(existsSync(servicePath), 'missing Serverless service configuration')

    const service = readFileSync(servicePath, 'utf8')

    assert.match(service, /^\s*MONGODB_SECRET_ARN:\s*$/m)
    assert.match(service, /^\s*JWT_SECRET_ARN:\s*$/m)
    assert.match(service, /^\s*S3_BUCKET_NAME:\s*\$\{param:photoBucketName\}$/m)
    assert.match(service, /^\s*-\s*secretsmanager:GetSecretValue\s*$/m)
    assert.match(service, /^\s*-\s*s3:PutObject\s*$/m)
    assert.match(service, /^\s*Type:\s*AWS::SecretsManager::Secret$/m)
    assert.match(service, /^\s*stackName:\s*\$\{self:service\}-\$\{sls:stage\}\s*$/m)
    assert.match(service, /^\s*DeletionPolicy:\s*Delete$/m)
    assert.match(service, /^\s*UpdateReplacePolicy:\s*Delete$/m)
    assert.doesNotMatch(service, /^\s*(?:DeletionPolicy|UpdateReplacePolicy):\s*Retain$/m)
    assert.doesNotMatch(service, /^\s*Name:\s*/m)
    assert.doesNotMatch(service, /^\s*SecretString:\s*/m)
    assert.doesNotMatch(service, /s3:\*/)
    assert.doesNotMatch(service, /secretsmanager:\*/)
    assert.doesNotMatch(service, /Action:\s*["']\*["']/)
    assert.doesNotMatch(service, /mongodb\+srv:\/\//)
  })

  it('requires an explicit photo bucket for every stage command', () => {
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))

    for (const [stage, command] of [
      ['dev', 'infrastructure:print:dev'],
      ['prod', 'infrastructure:print:prod'],
      ['dev', 'infrastructure:package:dev'],
      ['prod', 'infrastructure:package:prod'],
    ]) {
      const script = manifest.scripts[command]

      assert.match(script, new RegExp(`--stage ${stage}`))
      assert.doesNotMatch(script, /photoBucketName=/)
    }
  })

  it('deploys each stage through the secure MongoDB secret writer', () => {
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))

    for (const stage of ['dev', 'prod']) {
      const script = manifest.scripts[`infrastructure:deploy:${stage}`]

      assert.match(
        script,
        new RegExp(`node scripts/deploy-infrastructure\\.mjs --stage ${stage}`),
      )
      assert.doesNotMatch(script, /serverless deploy/)
    }
  })
})
