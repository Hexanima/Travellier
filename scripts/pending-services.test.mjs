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
      const list = cleanup.find((s) => s.Action.includes('s3:ListBucket'))
      assert.ok(list, 'the cleanup worker lists the bucket')
      assert.deepEqual(list.Resource, { 'Fn::GetAtt': ['PhotoBucket', 'Arn'] })
      assert.deepEqual(list.Condition, { StringLikeIfExists: { 's3:prefix': ['trips/*'] } })
      const s3Actions = cleanup.flatMap((s) => s.Action).filter((action) => action.startsWith('s3:')).sort()
      assert.deepEqual(s3Actions, ['s3:DeleteObject', 's3:ListBucket'])
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

  for (const stage of ['dev', 'prod']) {
    it(`${stage}: grants the events worker exactly the SNS actions it uses, on the applications and endpoints of the stage`, () => {
      const { Resources: resources } = build(stage)
      const statements = (role) => resources[role].Properties.Policies.flatMap((policy) => policy.PolicyDocument.Statement)
      const push = statements('EventsWorkerRole')
      const sns = push.filter((s) => s.Action.some((action) => action.startsWith('sns:')))
      assert.deepEqual(new Set(sns.flatMap((s) => s.Action)), new Set(['sns:CreatePlatformEndpoint', 'sns:Publish', 'sns:SetEndpointAttributes']))
      const prefix = 'arn:${AWS::Partition}:sns:${AWS::Region}:${AWS::AccountId}:'
      const resourcesOf = (action) => sns.filter((s) => s.Action.includes(action)).flatMap((s) => [s.Resource].flat()).map((r) => r['Fn::Sub'])
      assert.deepEqual(resourcesOf('sns:CreatePlatformEndpoint').sort(), [
        `${prefix}app/APNS/travellier-${stage}-ios`, `${prefix}app/APNS_SANDBOX/travellier-${stage}-ios`, `${prefix}app/GCM/travellier-${stage}-android`])
      const endpoints = [
        `${prefix}endpoint/APNS/travellier-${stage}-ios/*`, `${prefix}endpoint/APNS_SANDBOX/travellier-${stage}-ios/*`, `${prefix}endpoint/GCM/travellier-${stage}-android/*`]
      assert.deepEqual(resourcesOf('sns:Publish').sort(), endpoints)
      assert.deepEqual(resourcesOf('sns:SetEndpointAttributes').sort(), endpoints)
      for (const statement of push) assert.notEqual(statement.Resource, '*')
      assert.equal(push.some((s) => s.Action.includes('sns:CreatePlatformApplication')), false)
      const cleanup = statements('StorageDeletionWorkerRole')
      assert.equal(cleanup.some((s) => s.Action.some((action) => action.startsWith('sns:'))), false)
    })

    it(`${stage}: schedules default to the documented frequency and stay disabled without a consumer`, () => {
      const { Resources: resources } = build(stage)
      assert.equal(resources.EventsSchedule.Properties.ScheduleExpression, 'rate(1 minute)')
      assert.equal(resources.StorageDeletionSchedule.Properties.ScheduleExpression, 'rate(5 minutes)')
      assert.equal(resources.EventsSchedule.Properties.State, 'DISABLED')
      assert.equal(resources.StorageDeletionSchedule.Properties.State, 'DISABLED')
    })

    it(`${stage}: keeps the worker log groups in the stack with the function names`, () => {
      const { Resources: resources } = build(stage)
      assert.equal(resources.EventsWorkerLogGroup.Properties.LogGroupName, `/aws/lambda/travellier-api-${stage}-events`)
      assert.equal(resources.StorageDeletionWorkerLogGroup.Properties.LogGroupName, `/aws/lambda/travellier-api-${stage}-storage-deletion`)
    })
  }

  it('parameterizes the schedule expressions and accepts only valid ones', () => {
    const valid = ['rate(1 minute)', 'rate(2 minutes)', 'rate(15 minutes)', 'rate(1 hour)', 'rate(6 hours)', 'rate(1 day)', 'rate(7 days)', 'cron(0/5 * * * ? *)']
    for (const expression of valid) {
      const { Resources: resources } = build('dev', { eventsScheduleExpression: expression, storageDeletionScheduleExpression: expression })
      assert.equal(resources.EventsSchedule.Properties.ScheduleExpression, expression)
      assert.equal(resources.StorageDeletionSchedule.Properties.ScheduleExpression, expression)
    }
    const invalid = ['rate(0 minutes)', 'rate(1 minutes)', 'rate(2 minute)', 'rate(1 hours)', 'cron()', 'cron(* * *)', 'every minute', '', 'rate(1 minute); rm -rf /',
      'rate(1 minute)\n', 'rate(01 minutes)', 'cron(0/5 * * * ? *) extra', 5, null]
    for (const expression of invalid) {
      assert.throws(() => build('dev', { eventsScheduleExpression: expression }), /Invalid schedule expression/, String(expression))
      assert.throws(() => build('dev', { storageDeletionScheduleExpression: expression }), /Invalid schedule expression/, String(expression))
    }
  })

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
