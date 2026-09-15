import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const servicePath = join(rootDirectory, 'serverless.yml')

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

  it('keeps runtime secrets external and scopes Lambda permissions', () => {
    assert.ok(existsSync(servicePath), 'missing Serverless service configuration')

    const service = readFileSync(servicePath, 'utf8')

    assert.match(service, /^\s*MONGODB_SECRET_ARN:\s*$/m)
    assert.match(service, /^\s*JWT_SECRET_ARN:\s*$/m)
    assert.match(service, /^\s*S3_BUCKET_NAME:\s*\$\{param:photoBucketName\}$/m)
    assert.match(service, /^\s*-\s*secretsmanager:GetSecretValue\s*$/m)
    assert.match(service, /^\s*-\s*s3:PutObject\s*$/m)
    assert.match(service, /^\s*Type:\s*AWS::SecretsManager::Secret$/m)
    assert.match(service, /^\s*DeletionPolicy:\s*Retain$/m)
    assert.doesNotMatch(service, /s3:\*/)
    assert.doesNotMatch(service, /secretsmanager:\*/)
    assert.doesNotMatch(service, /Action:\s*["']\*["']/)
    assert.doesNotMatch(service, /mongodb\+srv:\/\//)
  })
})
