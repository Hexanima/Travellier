import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { load } from 'js-yaml'

const module = await import('../infrastructure/pending-services.cjs').catch(() => ({}))
const build = module.createPendingServices ?? (() => ({ Resources: {}, Outputs: {} }))
const arn = (stage, kind) => `arn:aws:lambda:sa-east-1:123456789012:function:travellier-api-${stage}-${kind}`

describe('pending services infrastructure', () => {
  it('is connected to the existing Serverless stack', () => {
    assert.match(readFileSync(new URL('../serverless.yml', import.meta.url), 'utf8'), /file\(infrastructure\/pending-services\.cjs\):resources/)
  })

  it('excludes credentials and the mobile client from Lambda artifacts', () => {
    const service = load(readFileSync(new URL('../serverless.yml', import.meta.url), 'utf8'))
    for (const pattern of ['!**/.env', '!**/.env.*', '!**/*.p8', '!**/*.p12', '!**/service-account*.json', '!**/service.json', '!**/*-firebase-adminsdk-*.json', '!apps/web/**']) {
      assert.ok(service.package?.patterns.includes(pattern), `Missing package exclusion ${pattern}`)
    }
  })

  it('uses the documented ARN returned by Ref for existing Secrets Manager resources', () => {
    const service = load(readFileSync(new URL('../serverless.yml', import.meta.url), 'utf8'))
    const resources = service.provider.iam.role.statements.find((statement) => statement.Action.includes('secretsmanager:GetSecretValue')).Resource
    assert.deepEqual(resources, [{ Ref: 'MongoConfigurationSecret' }, { Ref: 'JwtSigningSecret' }])
  })

  for (const stage of ['dev', 'prod']) {
    it(`${stage}: provisions encrypted queues with bounded retries and restricted redrive`, () => {
      const { Resources: resources } = build(stage)
      for (const kind of ['Events', 'StorageDeletion']) {
        const queue = resources[`${kind}Queue`].Properties
        assert.equal(queue.SqsManagedSseEnabled, true)
        assert.equal(queue.VisibilityTimeout, 360)
        assert.equal(queue.MessageRetentionPeriod, 86400)
        assert.deepEqual(queue.RedrivePolicy, { deadLetterTargetArn: { 'Fn::GetAtt': [`${kind}DeadLetterQueue`, 'Arn'] }, maxReceiveCount: 5 })
        assert.deepEqual(resources[`${kind}DeadLetterQueue`].Properties.RedriveAllowPolicy.sourceQueueArns,
          [{ 'Fn::Sub': `arn:\${AWS::Partition}:sqs:\${AWS::Region}:\${AWS::AccountId}:travellier-${stage}-${kind === 'Events' ? 'events' : 'storage-deletion'}` }])
        assert.equal(resources[`${kind}DeadLetterQueue`].Properties.MessageRetentionPeriod, 1209600)
      }
    })

    it(`${stage}: does not enqueue ticks or acknowledge work without a consumer`, () => {
      const { Resources: resources } = build(stage)
      assert.equal(resources.EventsSchedule.Properties.State, 'DISABLED')
      assert.equal(resources.StorageDeletionSchedule.Properties.State, 'DISABLED')
      assert.equal(resources.EventsConsumer, undefined)
      assert.equal(resources.StorageDeletionConsumer, undefined)
    })

    it(`${stage}: connects only matching consumer ARNs with partial batch failures`, () => {
      const { Resources: resources } = build(stage, {
        eventsConsumerArn: arn(stage, 'events'), storageDeletionConsumerArn: arn(stage, 'storage-deletion'),
      })
      for (const kind of ['Events', 'StorageDeletion']) {
        assert.equal(resources[`${kind}Schedule`].Properties.State, 'ENABLED')
        assert.equal(resources[`${kind}Consumer`].Properties.BatchSize, 1)
        assert.deepEqual(resources[`${kind}Consumer`].Properties.FunctionResponseTypes, ['ReportBatchItemFailures'])
        const target = resources[`${kind}Schedule`].Properties.Targets[0]
        assert.deepEqual(target.RetryPolicy, { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 5 })
        assert.deepEqual(target.DeadLetterConfig, { Arn: { 'Fn::GetAtt': [`${kind}DeliveryDeadLetterQueue`, 'Arn'] } })
        assert.deepEqual(JSON.parse(target.Input), { kind: kind === 'Events' ? 'events' : 'storageDeletionJobs', stage })
      }
    })

    it(`${stage}: separates workers, secrets and stage scoped permissions`, () => {
      const { Resources: resources } = build(stage)
      const statements = (role) => resources[role].Properties.Policies.flatMap((policy) => policy.PolicyDocument.Statement)
      const cleanup = statements('StorageDeletionWorkerRole')
      const push = statements('EventsWorkerRole')
      assert.deepEqual(cleanup.find((s) => s.Action.includes('s3:DeleteObject')).Resource, { 'Fn::Sub': '${PhotoBucket.Arn}/trips/*' })
      assert.equal(cleanup.some((s) => s.Action.some((action) => action.startsWith('sns:'))), false)
      assert.equal(push.some((s) => s.Action.some((action) => action.startsWith('s3:'))), false)
      assert.equal(push.some((s) => s.Action.includes('sns:CreatePlatformApplication')), false)
      assert.equal(JSON.stringify(push).includes(`travellier-${stage}-android`), true)
      for (const statement of [...cleanup, ...push]) {
        assert.notEqual(statement.Resource, '*')
        assert.equal(statement.Action.some((action) => action.endsWith(':*')), false)
      }
      for (const name of ['FcmCredentialsSecret', 'ApnsCredentialsSecret', 'PushApplicationsSecret']) {
        assert.equal(resources[name].Type, 'AWS::SecretsManager::Secret')
        assert.equal(resources[name].Properties.SecretString, undefined)
        assert.ok(build(stage).Outputs[`${name}Arn`])
      }
      assert.equal(JSON.stringify([...cleanup, ...push]).includes('FcmCredentialsSecret'), false)
      assert.equal(JSON.stringify([...cleanup, ...push]).includes('ApnsCredentialsSecret'), false)
    })

    it(`${stage}: restricts EventBridge queue access to the corresponding rule and account`, () => {
      const policy = build(stage).Resources.PendingQueuePolicy.Properties.PolicyDocument.Statement
      for (const kind of ['Events', 'StorageDeletion']) {
        const statement = policy.find((s) => s.Sid === `${kind}ScheduleDelivery`)
        assert.deepEqual(statement.Principal, { Service: 'events.amazonaws.com' })
        assert.deepEqual(statement.Condition.ArnEquals['aws:SourceArn'], { 'Fn::GetAtt': [`${kind}Schedule`, 'Arn'] })
        assert.deepEqual(statement.Condition.StringEquals['aws:SourceAccount'], { Ref: 'AWS::AccountId' })
      }
      assert.ok(policy.some((s) => s.Effect === 'Deny' && s.Condition.Bool['aws:SecureTransport'] === 'false'))
      assert.equal(Object.values(build(stage).Resources).filter((r) => r.Type === 'AWS::CloudWatch::Alarm').length, 6)
    })
  }

  it('rejects unsupported stages and consumers belonging to another stage or name', () => {
    assert.throws(() => build('staging'), /stage/)
    assert.throws(() => build('dev', { eventsConsumerArn: arn('prod', 'events') }), /consumer/)
    assert.throws(() => build('prod', { storageDeletionConsumerArn: arn('prod', 'events') }), /consumer/)
  })

  it('contains no circular CloudFormation resource dependencies', () => {
    const { Resources: resources } = build('dev', { eventsConsumerArn: arn('dev', 'events') })
    const dependencies = (value) => {
      if (Array.isArray(value)) return value.flatMap(dependencies)
      if (value === null || typeof value !== 'object') return []
      return [value.Ref, value['Fn::GetAtt']?.[0], ...Object.values(value).flatMap(dependencies)].filter((id) => resources[id])
    }
    const visit = (id, path = []) => {
      assert.equal(path.includes(id), false, `circular dependency: ${[...path, id].join(' -> ')}`)
      for (const dependency of new Set(dependencies(resources[id]))) visit(dependency, [...path, id])
    }
    Object.keys(resources).forEach((id) => visit(id))
  })
})
