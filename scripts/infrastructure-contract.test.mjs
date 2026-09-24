import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const servicePath = join(rootDirectory, 'serverless.yml')
const packagePath = join(rootDirectory, 'package.json')
const webDirectory = join(rootDirectory, 'apps', 'web')

const listFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    return entry.isDirectory() ? listFiles(path) : [path]
  })

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
    assert.match(service, /^\s*S3_BUCKET_NAME:\s*$/m)
    assert.match(service, /^\s*Ref:\s*PhotoBucket$/m)
    assert.match(service, /^\s*-\s*secretsmanager:GetSecretValue\s*$/m)
    assert.match(service, /^\s*-\s*s3:PutObject\s*$/m)
    assert.match(service, /^\s*Fn::Sub:\s*'\$\{PhotoBucket\.Arn\}\/trips\/\*'$/m)
    assert.match(service, /^\s*Type:\s*AWS::SecretsManager::Secret$/m)
    assert.match(service, /^\s*stackName:\s*\$\{self:service\}-\$\{sls:stage\}\s*$/m)
    assert.match(service, /^\s*DeletionPolicy:\s*Delete$/m)
    assert.match(service, /^\s*UpdateReplacePolicy:\s*Delete$/m)
    assert.doesNotMatch(service, /^\s*(?:DeletionPolicy|UpdateReplacePolicy):\s*Retain$/m)
    assert.doesNotMatch(service, /^\s*Name:\s*/m)
    assert.doesNotMatch(service, /^\s*SecretString:\s*/m)
    assert.doesNotMatch(service, /photoBucketName/)
    assert.doesNotMatch(service, /s3:\*/)
    assert.doesNotMatch(service, /secretsmanager:\*/)
    assert.doesNotMatch(service, /Action:\s*["']\*["']/)
    assert.doesNotMatch(service, /mongodb\+srv:\/\//)
  })

  it('provisions a private photo bucket that accepts direct PUT uploads from approved origins', () => {
    assert.ok(existsSync(servicePath), 'missing Serverless service configuration')

    const service = readFileSync(servicePath, 'utf8')

    assert.match(service, /^\s*PhotoBucket:\s*$/m)
    assert.match(service, /^\s*Type:\s*AWS::S3::Bucket$/m)
    assert.match(service, /^\s*CorsConfiguration:\s*$/m)
    assert.match(service, /^\s*AllowedOrigins:\s*$/m)
    assert.match(service, /^\s*-\s*capacitor:\/\/localhost\s*$/m)
    assert.match(service, /^\s*-\s*http:\/\/localhost\s*$/m)
    assert.match(service, /^\s*AllowedMethods:\s*$/m)
    assert.match(service, /^\s*-\s*PUT\s*$/m)
    assert.match(service, /^\s*-\s*AllowedHeaders:\s*$/m)
    assert.match(service, /^\s*-\s*Content-Type\s*$/m)
    assert.match(service, /^\s*PublicAccessBlockConfiguration:\s*$/m)
    assert.match(service, /^\s*BlockPublicAcls:\s*true$/m)
    assert.match(service, /^\s*IgnorePublicAcls:\s*true$/m)
    assert.match(service, /^\s*BlockPublicPolicy:\s*true$/m)
    assert.match(service, /^\s*RestrictPublicBuckets:\s*true$/m)
    assert.match(service, /^\s*OwnershipControls:\s*$/m)
    assert.match(service, /^\s*-\s*ObjectOwnership:\s*BucketOwnerEnforced$/m)
    assert.match(service, /^\s*BucketEncryption:\s*$/m)
    assert.match(service, /^\s*SSEAlgorithm:\s*AES256$/m)
  })

  it('keeps trip photos private until the API authorizes a signed read', () => {
    assert.ok(existsSync(servicePath), 'missing Serverless service configuration')

    const service = readFileSync(servicePath, 'utf8')

    assert.doesNotMatch(service, /^\s*Type:\s*AWS::S3::BucketPolicy$/m)
    assert.doesNotMatch(service, /^\s*Principal:\s*'\*'$/m)
    assert.doesNotMatch(service, /AllowPublicTripPhotoRead/)
    const policies = service.split(/^\s*- Effect: Allow\s*$/m).slice(1)
    const tripPolicy = policies.find((policy) => policy.includes("${PhotoBucket.Arn}/trips/*"))
    const avatarPolicy = policies.find((policy) => policy.includes("${PhotoBucket.Arn}/avatars/*"))
    assert.ok(tripPolicy)
    assert.ok(avatarPolicy)
    assert.doesNotMatch(tripPolicy, /s3:GetObject/)
    assert.match(avatarPolicy, /s3:GetObject/)
  })

  it('does not require callers to provide a photo bucket for stage commands', () => {
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

  it('keeps AWS credentials out of the mobile client', () => {
    const credentialPattern = /AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)|accessKeyId|secretAccessKey/

    for (const path of listFiles(webDirectory)) {
      assert.doesNotMatch(readFileSync(path, 'utf8'), credentialPattern, path)
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
