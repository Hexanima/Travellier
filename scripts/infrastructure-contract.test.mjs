import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { load } from 'js-yaml'

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const servicePath = join(rootDirectory, 'serverless.yml')
const packagePath = join(rootDirectory, 'package.json')
const webDirectory = join(rootDirectory, 'apps', 'web')

const listFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    return entry.isDirectory() ? listFiles(path) : [path]
  })

const extractOrigins = (service, key) => {
  const lines = service.split(/\r?\n/)
  const start = lines.findIndex((line) => new RegExp(`^\\s*${key}:\\s*$`).test(line))
  assert.notEqual(start, -1, `missing ${key}`)
  const indent = lines[start].match(/^\s*/)[0].length
  const origins = []
  for (const line of lines.slice(start + 1)) {
    const item = line.match(/^(\s*)-\s*(\S+)\s*$/)
    if (!item || item[1].length < indent) break
    origins.push(item[2])
  }
  return origins
}

const requiredOrigins = ['capacitor://localhost', 'https://localhost', 'http://localhost']

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
    assert.match(service, /^\s*allowedHeaders:\s*$/m)
    assert.match(service, /^\s*-\s*Authorization\s*$/m)
    assert.match(service, /^\s*allowedMethods:\s*$/m)
    assert.match(service, /^\s*-\s*OPTIONS\s*$/m)
  })

  it('allows the same Capacitor origins (iOS and Android) in API Gateway and the bucket, without wildcards', () => {
    const service = readFileSync(servicePath, 'utf8')
    const apiOrigins = extractOrigins(service, 'allowedOrigins')
    const bucketOrigins = extractOrigins(service, 'AllowedOrigins')

    for (const origins of [apiOrigins, bucketOrigins]) {
      for (const origin of requiredOrigins) {
        assert.ok(origins.includes(origin), `missing origin ${origin}`)
      }
      assert.ok(!origins.some((origin) => origin.includes('*')), 'wildcard origin not allowed')
    }
    assert.deepEqual([...apiOrigins].sort(), [...bucketOrigins].sort())
  })

  it('keeps the Capacitor WebView origin covered by the allowed origins', () => {
    const config = readFileSync(join(webDirectory, 'capacitor.config.ts'), 'utf8')
    const service = readFileSync(servicePath, 'utf8')
    const origins = extractOrigins(service, 'allowedOrigins')

    assert.doesNotMatch(config, /androidScheme:\s*["']http["']/)
    for (const match of config.matchAll(/hostname:\s*["']([^"']+)["']/g)) {
      assert.equal(match[1], 'localhost')
    }
    // Defaults de Capacitor 8: Android https://localhost, iOS capacitor://localhost.
    const android = config.match(/androidScheme:\s*["']([^"']+)["']/)?.[1] ?? 'https'
    const ios = config.match(/iosScheme:\s*["']([^"']+)["']/)?.[1] ?? 'capacitor'
    assert.ok(origins.includes(`${android}://localhost`))
    assert.ok(origins.includes(`${ios}://localhost`))
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
    assert.match(tripPolicy, /s3:PutObject/)
    assert.match(tripPolicy, /s3:GetObject/)
    assert.match(avatarPolicy, /s3:GetObject/)
    const listPolicy = policies.find((policy) => policy.includes('s3:ListBucket'))
    assert.ok(listPolicy, 'the API needs s3:ListBucket so a missing key answers 404 instead of 403')
    assert.match(listPolicy, /Fn::GetAtt: \[PhotoBucket, Arn\]/)
    assert.doesNotMatch(listPolicy, /\$\{PhotoBucket\.Arn\}\/\*/)
    assert.match(listPolicy, /StringLikeIfExists:\s*\n\s*s3:prefix:\s*\n\s*- 'trips\/\*'/)
    assert.doesNotMatch(service, /s3:\*/)
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

const { createPendingServices } = createRequire(import.meta.url)('../infrastructure/pending-services.cjs')
const source = (path) => readFileSync(join(rootDirectory, path), 'utf8')
const constant = (path, name) => {
  const match = source(path).match(new RegExp(String.raw`(?:const|let)\s+${name}\s*=\s*([0-9_]+)`))
  assert.ok(match, `missing constant ${name} in ${path}`)
  return Number(match[1].replaceAll('_', ''))
}

describe('Worker functions contract (T142)', () => {
  const service = load(source('serverless.yml'))
  const pending = source('infrastructure/pending-services.cjs')
  const workers = {
    events: { handler: 'apps/api/src/events-lambda.handler', role: 'EventsWorkerRole', env: ['MONGODB_SECRET_ARN', 'PUSH_APPLICATIONS_SECRET_ARN'] },
    'storage-deletion': { handler: 'apps/api/src/storage-deletion-lambda.handler', role: 'StorageDeletionWorkerRole', env: ['MONGODB_SECRET_ARN', 'S3_BUCKET_NAME'] },
  }

  for (const [name, worker] of Object.entries(workers)) {
    it(`defines the ${name} function with its own role, handler and no triggers`, () => {
      const fn = service.functions[name]
      assert.ok(fn, `missing function ${name}`)
      assert.equal(fn.handler, worker.handler)
      assert.equal(fn.role, worker.role)
      assert.equal(fn.events, undefined, 'the SQS mapping is created by pending-services.cjs')
      assert.equal(fn.disableLogs, true, 'the log group is created by pending-services.cjs')
      assert.equal(fn.memorySize, 256)
      assert.deepEqual(Object.keys(fn.environment).sort(), [...worker.env].sort())
      const { Resources } = createPendingServices('dev')
      const group = name === 'events' ? 'EventsWorkerLogGroup' : 'StorageDeletionWorkerLogGroup'
      assert.equal(Resources[group].Properties.LogGroupName, `/aws/lambda/travellier-api-dev-${name}`)
    })
  }

  it('scopes environment variables per function: JWT only in api, APP_ENV in the provider', () => {
    assert.deepEqual(Object.keys(service.provider.environment), ['APP_ENV'])
    assert.deepEqual(Object.keys(service.functions.api.environment).sort(), ['JWT_SECRET_ARN', 'MONGODB_SECRET_ARN', 'S3_BUCKET_NAME'])
    for (const name of Object.keys(workers)) assert.equal(service.functions[name].environment.JWT_SECRET_ARN, undefined)
    assert.equal(service.functions.events.environment.S3_BUCKET_NAME, undefined)
    assert.equal(service.functions['storage-deletion'].environment.PUSH_APPLICATIONS_SECRET_ARN, undefined)
    assert.deepEqual(service.functions.events.environment.PUSH_APPLICATIONS_SECRET_ARN, { Ref: 'PushApplicationsSecret' })
    const text = source('serverless.yml')
    assert.doesNotMatch(text, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|PRIVATE_KEY|mongodb\+srv:\/\//)
  })

  it('keeps the api function statements without SNS', () => {
    const statements = service.provider.iam.role.statements
    assert.equal(JSON.stringify(statements).includes('sns:'), false)
    assert.equal(service.functions.api.role, undefined)
  })

  it('orders each worker function after its log group', () => {
    const resources = service.resources.find((entry) => entry.extensions)
    assert.ok(resources, 'missing resources.extensions')
    assert.deepEqual(resources.extensions.EventsLambdaFunction.DependsOn, ['EventsWorkerLogGroup'])
    assert.deepEqual(resources.extensions.StorageDashdeletionLambdaFunction.DependsOn, ['StorageDeletionWorkerLogGroup'])
  })

  it('exposes the schedule expressions as stage parameters without consumer ARNs by default', () => {
    const params = service.stages.default.params
    assert.equal(params.eventsScheduleExpression, 'rate(1 minute)')
    assert.equal(params.storageDeletionScheduleExpression, 'rate(5 minutes)')
    assert.equal(params.eventsConsumerArn, '')
    assert.equal(params.storageDeletionConsumerArn, '')
  })

  it('keeps every timeout under its lease and above its internal deadline plus the closing margin', () => {
    const snsCall = constant('apps/api/src/adapters/aws/sns-client.ts', 'SNS_REQUEST_TIMEOUT_MS')
    const queueTimeout = 360
    const cases = [
      // Four SNS calls (create endpoint, publish, reactivate, publish) plus 5 s of closing writes.
      ['events', constant('domain/src/entities/push-dispatch.ts', 'PUSH_DISPATCH_LEASE_SECONDS'),
        constant('apps/api/src/events-lambda.ts', 'EVENTS_DEADLINE_MS'), 4 * snsCall + 5000],
      // No SNS; 10 s: closing writes plus the last S3 call, which has no per-call timeout.
      ['storage-deletion', constant('domain/src/entities/storage-deletion-job.ts', 'STORAGE_DELETION_LEASE_SECONDS'),
        constant('apps/api/src/storage-deletion-lambda.ts', 'STORAGE_DELETION_DEADLINE_MS'), 10_000],
    ]
    for (const [name, lease, deadlineMs, marginMs] of cases) {
      const timeout = service.functions[name].timeout
      assert.ok(timeout < lease, `${name}: timeout ${timeout} must be under the lease ${lease}`)
      assert.ok(timeout > deadlineMs / 1000, `${name}: timeout must exceed the deadline`)
      assert.ok(timeout <= 60, `${name}: the deploy wrapper rejects timeouts above 60 s`)
      assert.ok(timeout * 1000 >= deadlineMs + marginMs, `${name}: timeout leaves less than ${marginMs} ms after the deadline`)
      assert.ok(queueTimeout >= 6 * timeout, `${name}: queue VisibilityTimeout must be at least six times the timeout`)
    }
    assert.match(pending, /VisibilityTimeout: 360/)
  })
})
