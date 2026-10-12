// CloudFormation fragment: infrastructure only. T73/T92 provide the consumers.
const ref = (name) => ({ Ref: name })
const arn = (name) => ({ 'Fn::GetAtt': [name, 'Arn'] })
const sub = (value) => ({ 'Fn::Sub': value })
const allow = (Action, Resource) => ({ Effect: 'Allow', Action, Resource })
const policy = (Statement) => ({ Version: '2012-10-17', Statement })

const createPendingServices = (stage, {
  eventsConsumerArn = '', storageDeletionConsumerArn = '',
} = {}) => {
  if (!['dev', 'prod'].includes(stage)) throw new Error('Unsupported infrastructure stage')
  const Resources = {}, Outputs = {}, queueArns = [], queueUrls = [], queueStatements = []
  const consumerArns = { Events: eventsConsumerArn, StorageDeletion: storageDeletionConsumerArn }

  for (const name of ['FcmCredentialsSecret', 'ApnsCredentialsSecret', 'PushApplicationsSecret']) {
    Resources[name] = {
      Type: 'AWS::SecretsManager::Secret', DeletionPolicy: 'Delete', UpdateReplacePolicy: 'Delete',
      Properties: { Description: `Travellier ${stage} ${name}; populated through the deployment SDK, never template parameters.` },
    }
    Outputs[`${name}Arn`] = { Value: ref(name) }
  }

  for (const [kind, suffix, collection] of [
    ['Events', 'events', 'events'], ['StorageDeletion', 'storage-deletion', 'storageDeletionJobs'],
  ]) {
    const consumer = consumerArns[kind]
    if (typeof consumer !== 'string' || (consumer !== '' && !new RegExp(
      `^arn:aws:lambda:[a-z0-9-]+:[0-9]{12}:function:travellier-api-${stage}-${suffix}(?::[a-zA-Z0-9_-]+)?$`,
    ).test(consumer))) throw new Error('Invalid consumer ARN for infrastructure stage')

    const queue = `${kind}Queue`, dlq = `${kind}DeadLetterQueue`, deliveryDlq = `${kind}DeliveryDeadLetterQueue`
    Resources[dlq] = {
      Type: 'AWS::SQS::Queue',
      Properties: {
        SqsManagedSseEnabled: true, MessageRetentionPeriod: 1209600,
        // A Ref to the source queue here would cycle with its RedrivePolicy.
        RedriveAllowPolicy: { redrivePermission: 'byQueue', sourceQueueArns: [
          sub(`arn:\${AWS::Partition}:sqs:\${AWS::Region}:\${AWS::AccountId}:travellier-${stage}-${suffix}`),
        ] },
      },
    }
    Resources[deliveryDlq] = {
      Type: 'AWS::SQS::Queue',
      Properties: { SqsManagedSseEnabled: true, MessageRetentionPeriod: 1209600,
        RedriveAllowPolicy: { redrivePermission: 'denyAll' } },
    }
    Resources[queue] = {
      Type: 'AWS::SQS::Queue',
      Properties: {
        QueueName: `travellier-${stage}-${suffix}`,
        SqsManagedSseEnabled: true, MessageRetentionPeriod: 86400, VisibilityTimeout: 360,
        RedrivePolicy: { deadLetterTargetArn: arn(dlq), maxReceiveCount: 5 },
      },
    }
    queueArns.push(arn(queue), arn(dlq), arn(deliveryDlq))
    queueUrls.push(ref(queue), ref(dlq), ref(deliveryDlq))
    const schedule = `${kind}Schedule`
    Resources[schedule] = {
      Type: 'AWS::Events::Rule',
      Properties: {
        Description: `Wake up the ${collection} consumer; MongoDB remains the durable source of work.`,
        ScheduleExpression: 'rate(1 minute)', State: consumer === '' ? 'DISABLED' : 'ENABLED',
        Targets: [{ Id: `${kind}Queue`, Arn: arn(queue), Input: JSON.stringify({ kind: collection, stage }),
          RetryPolicy: { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 5 },
          DeadLetterConfig: { Arn: arn(deliveryDlq) } }],
      },
    }
    queueStatements.push({
      Sid: `${kind}ScheduleDelivery`, ...allow(['sqs:SendMessage'], [arn(queue), arn(deliveryDlq)]),
      Principal: { Service: 'events.amazonaws.com' },
      Condition: { ArnEquals: { 'aws:SourceArn': arn(schedule) }, StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') } },
    })

    const logGroup = `${kind}WorkerLogGroup`
    Resources[logGroup] = {
      Type: 'AWS::Logs::LogGroup',
      Properties: { LogGroupName: `/aws/lambda/travellier-api-${stage}-${suffix}`, RetentionInDays: stage === 'prod' ? 90 : 14 },
    }
    const workerStatements = [
      allow(['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'], arn(queue)),
      allow(['logs:CreateLogStream', 'logs:PutLogEvents'], sub(`arn:\${AWS::Partition}:logs:\${AWS::Region}:\${AWS::AccountId}:log-group:/aws/lambda/travellier-api-${stage}-${suffix}:*`)),
      allow(['secretsmanager:GetSecretValue'], [ref('MongoConfigurationSecret'), ...(kind === 'Events' ? [ref('PushApplicationsSecret')] : [])]),
    ]
    if (kind === 'StorageDeletion') workerStatements.push(allow(['s3:DeleteObject'], sub('${PhotoBucket.Arn}/trips/*')))
    else workerStatements.push(allow(['sns:Publish'], ['GCM', 'APNS', 'APNS_SANDBOX'].map((platform) =>
      sub(`arn:\${AWS::Partition}:sns:\${AWS::Region}:\${AWS::AccountId}:endpoint/${platform}/travellier-${stage}-${platform === 'GCM' ? 'android' : 'ios'}/*`))))
    const role = `${kind}WorkerRole`
    Resources[role] = {
      Type: 'AWS::IAM::Role',
      Properties: {
        AssumeRolePolicyDocument: policy([{ Effect: 'Allow', Action: ['sts:AssumeRole'], Principal: { Service: 'lambda.amazonaws.com' } }]),
        Policies: [{ PolicyName: `${kind}Worker`, PolicyDocument: policy(workerStatements) }],
      },
    }
    if (consumer !== '') Resources[`${kind}Consumer`] = {
      Type: 'AWS::Lambda::EventSourceMapping', DependsOn: [role, logGroup],
      Properties: { FunctionName: consumer, EventSourceArn: arn(queue), Enabled: true,
        BatchSize: 1, MaximumBatchingWindowInSeconds: 0, FunctionResponseTypes: ['ReportBatchItemFailures'],
        ScalingConfig: { MaximumConcurrency: 2 } },
    }
    Outputs[`${kind}QueueUrl`] = { Value: ref(queue) }
    Outputs[`${kind}QueueArn`] = { Value: arn(queue) }
    Outputs[`${kind}WorkerRoleArn`] = { Value: arn(role) }
    Outputs[`${kind}DeadLetterQueueUrl`] = { Value: ref(dlq) }
    Outputs[`${kind}DeliveryDeadLetterQueueUrl`] = { Value: ref(deliveryDlq) }

    for (const [alarm, queueName, metric, threshold] of [
      ['Backlog', queue, 'ApproximateAgeOfOldestMessage', 600],
      ['ProcessingFailures', dlq, 'ApproximateNumberOfMessagesVisible', 0],
      ['DeliveryFailures', deliveryDlq, 'ApproximateNumberOfMessagesVisible', 0],
    ]) Resources[`${kind}${alarm}Alarm`] = {
      Type: 'AWS::CloudWatch::Alarm',
      Properties: {
        AlarmDescription: `Travellier ${stage}: ${collection} ${alarm}; inspect queue and durable jobs before replay.`,
        Namespace: 'AWS/SQS', MetricName: metric,
        Dimensions: [{ Name: 'QueueName', Value: { 'Fn::GetAtt': [queueName, 'QueueName'] } }],
        Statistic: 'Maximum', Period: 60, EvaluationPeriods: 1,
        Threshold: threshold, ComparisonOperator: 'GreaterThanThreshold', TreatMissingData: 'notBreaching',
      },
    }
  }
  Resources.PendingQueuePolicy = {
    Type: 'AWS::SQS::QueuePolicy',
    Properties: { Queues: queueUrls, PolicyDocument: policy([
      ...queueStatements,
      { Sid: 'RequireTLS', Effect: 'Deny', Action: ['sqs:*'], Resource: queueArns,
        Principal: '*', Condition: { Bool: { 'aws:SecureTransport': 'false' } } },
    ]) },
  }
  return { Resources, Outputs }
}

exports.createPendingServices = createPendingServices
exports.resources = async ({ resolveVariable }) => createPendingServices(
  await resolveVariable('sls:stage'), {
    eventsConsumerArn: await resolveVariable('param:eventsConsumerArn'),
    storageDeletionConsumerArn: await resolveVariable('param:storageDeletionConsumerArn'),
  },
)
