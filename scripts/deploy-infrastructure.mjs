import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import { InfrastructureConfigurationError, validateStage, readPushConfiguration, createAwsPushProvisioner } from './provision-push.mjs'

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const mongoSecretOutputKey = 'MongoConfigurationSecretArn'

const requiredSetting = (environment, name) => {
  const value = environment[name]?.trim()

  if (value === undefined || value === '') {
    throw new InfrastructureConfigurationError(`${name} is required`)
  }

  return value
}

const createMongoConfiguration = (environment) =>
  JSON.stringify({
    uri: requiredSetting(environment, 'MONGODB_URI'),
    databaseName: requiredSetting(environment, 'MONGODB_DATABASE_NAME'),
  })

const isMissingSecretValue = (error) =>
  typeof error === 'object' && error !== null && error.name === 'ResourceNotFoundException'

export const createInfrastructureDeployer = ({
  runServerless,
  getMongoSecretArn,
  getMongoSecretValue,
  putMongoSecretValue,
  readPushConfiguration: readPush,
  provisionPush,
  validateConsumers,
}) =>
  async ({ stage, region, serverlessArguments, environment }) => {
    validateStage(stage)
    const options = readDeploymentOptions(serverlessArguments)
    if (options.stage !== stage || options.region !== region) {
      throw new InfrastructureConfigurationError('Deployment stage or region does not match CLI options')
    }
    const secretString = createMongoConfiguration(environment)
    const configuration = readPush?.(stage, environment)
    if (Object.keys(options.consumers).length > 0) {
      if (validateConsumers === undefined) throw new InfrastructureConfigurationError('Consumer activation requires readiness validation')
      await validateConsumers({ stage, region, consumers: options.consumers, configuration })
    }

    await runServerless(serverlessArguments)

    const secretId = await getMongoSecretArn({ stage, region })

    if (secretId === undefined || secretId === '') {
      throw new Error('MongoConfigurationSecretArn is missing from the deployed stack')
    }

    let currentSecretString

    try {
      currentSecretString = await getMongoSecretValue({ region, secretId })
    } catch (error) {
      if (!isMissingSecretValue(error)) {
        throw error
      }
    }

    if (currentSecretString !== secretString) {
      await putMongoSecretValue({
        region,
        secretId,
        secretString,
        clientRequestToken: randomUUID(),
      })
    }
    await provisionPush?.({ stage, region, configuration })
  }

export const readDeploymentOptions = (argumentsList) => {
  const options = {}, consumers = {}
  for (let index = 0; index < argumentsList.length; index++) {
    const argument = argumentsList[index]
    const equals = argument.indexOf('=')
    const name = equals >= 0 ? argument.slice(0, equals) : argument
    if (!['--stage', '--region', '--param'].includes(name)) throw new InfrastructureConfigurationError('Unsupported deployment option')
    const value = equals >= 0 ? argument.slice(equals + 1) : argumentsList[++index]
    if (!value || value.startsWith('--')) throw new InfrastructureConfigurationError('Deployment option requires a value')
    if (name === '--param') {
      const split = value.indexOf('='), key = value.slice(0, split), consumer = value.slice(split + 1)
      const suffix = { eventsConsumerArn: 'events', storageDeletionConsumerArn: 'storage-deletion' }[key]
      if (split < 0 || suffix === undefined || consumers[key] !== undefined ||
        !/^arn:aws:lambda:[a-z0-9-]+:[0-9]{12}:function:travellier-api-(?:dev|prod)-(?:events|storage-deletion)(?::[a-zA-Z0-9_-]+)?$/.test(consumer)) {
        throw new InfrastructureConfigurationError('Invalid consumer option')
      }
      consumers[key] = consumer
    } else {
      if (options[name] !== undefined) throw new InfrastructureConfigurationError('Duplicate deployment option')
      options[name] = value
    }
  }
  if (!options['--stage']) throw new InfrastructureConfigurationError('--stage is required')
  const stage = options['--stage'], region = options['--region'] ?? 'sa-east-1'
  validateStage(stage)
  if (!/^[a-z]{2}-[a-z]+-[0-9]$/.test(region)) throw new InfrastructureConfigurationError('Invalid deployment region')
  for (const [key, consumer] of Object.entries(consumers)) {
    const suffix = key === 'eventsConsumerArn' ? 'events' : 'storage-deletion'
    if (consumer.split(':')[3] !== region || !consumer.split(':')[6]?.startsWith(`travellier-api-${stage}-${suffix}`)) {
      throw new InfrastructureConfigurationError('Consumer stage or region does not match deployment')
    }
  }
  return { stage, region, consumers, serverlessArguments: ['--stage', stage, '--region', region,
    ...Object.entries(consumers).map(([key, value]) => `--param=${key}=${value}`)] }
}

export const serverlessEnvironment = (environment) => {
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA',
    'USERPROFILE', 'HOME', 'CI', 'LANG', 'LC_ALL', 'TERM', 'NO_COLOR',
    'AWS_PROFILE', 'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_SDK_LOAD_CONFIG', 'AWS_SHARED_CREDENTIALS_FILE',
    'AWS_CONFIG_FILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
    'AWS_WEB_IDENTITY_TOKEN_FILE', 'AWS_ROLE_ARN', 'AWS_ROLE_SESSION_NAME',
    'SERVERLESS_ACCESS_KEY', 'SERVERLESS_LICENSE_KEY'])
  return Object.fromEntries(Object.entries(environment).filter(([name]) => allowed.has(name.toUpperCase())))
}
export const safeDeploymentError = (error) => error instanceof InfrastructureConfigurationError
  ? error.message : 'Infrastructure deployment failed; inspect resource status without logging credentials'

export const validateConsumerConfiguration = ({ consumerArn, accountId, roleArn, configuration }) => {
  const requested = consumerArn.split(':')
  const returned = configuration.FunctionArn?.split(':') ?? []
  const qualifier = requested[7]
  // GetFunctionConfiguration resolves aliases to versions. Compare the same
  // function identity on both sides without changing the ARN used by SQS.
  const qualifierMismatch = qualifier !== undefined && (/^\d+$/.test(qualifier)
    ? configuration.Version !== qualifier || (returned[7] !== undefined && returned[7] !== qualifier)
    : !/^[1-9]\d*$/.test(configuration.Version ?? '') ||
      (returned[7] !== undefined && returned[7] !== qualifier && returned[7] !== configuration.Version))
  if (requested[4] !== accountId || !roleArn || returned.length > 8 ||
    returned.slice(0, 7).join(':') !== requested.slice(0, 7).join(':') || qualifierMismatch ||
    configuration.Role !== roleArn || configuration.Runtime !== 'nodejs22.x' || !Number.isInteger(configuration.Timeout) || configuration.Timeout <= 0 || configuration.Timeout > 60 ||
    configuration.State !== 'Active' || configuration.LastUpdateStatus !== 'Successful') {
    throw new InfrastructureConfigurationError('Consumer must be active, use its stage worker role and Node.js 22, with timeout at most 60 seconds')
  }
}

const runServerless = async (serverlessArguments) => {
  const require = createRequire(import.meta.url)
  const result = spawnSync(process.execPath, [require.resolve('serverless/run.js'), 'deploy', ...serverlessArguments], {
    cwd: rootDirectory,
    env: serverlessEnvironment(process.env),
    stdio: 'inherit',
  })

  if (result.error !== undefined) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`Serverless deployment failed with exit code ${result.status}`)
  }
}

const getMongoSecretArn = async ({ stage, region }) => {
  const stack = await describeStack({ stage, region })
  return stack?.Outputs?.find((output) => output.OutputKey === mongoSecretOutputKey)?.OutputValue
}

const describeStack = async ({ stage, region }) => {
  const { CloudFormationClient, DescribeStacksCommand } = await import(
    '@aws-sdk/client-cloudformation'
  )
  const client = new CloudFormationClient({ region })
  const response = await client.send(
    new DescribeStacksCommand({ StackName: `travellier-api-${stage}` }),
  )

  return response.Stacks?.[0]
}

const putMongoSecretValue = async ({ region, secretId, secretString, clientRequestToken }) => {
  const { PutSecretValueCommand, SecretsManagerClient } = await import(
    '@aws-sdk/client-secrets-manager'
  )
  const client = new SecretsManagerClient({ region })

  await client.send(
    new PutSecretValueCommand({
      SecretId: secretId,
      SecretString: secretString,
      ClientRequestToken: clientRequestToken,
    }),
  )
}

const getMongoSecretValue = async ({ region, secretId }) => {
  const { GetSecretValueCommand, SecretsManagerClient } = await import(
    '@aws-sdk/client-secrets-manager'
  )
  const client = new SecretsManagerClient({ region })
  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: secretId,
      VersionStage: 'AWSCURRENT',
    }),
  )

  return response.SecretString
}

const main = async () => {
  const { stage, region, serverlessArguments, consumers } = readDeploymentOptions(process.argv.slice(2))

  await createInfrastructureDeployer({
    runServerless,
    getMongoSecretArn,
    getMongoSecretValue,
    putMongoSecretValue,
    readPushConfiguration,
    validateConsumers: async ({ configuration }) => {
      // Activation is a second deploy: the disabled infrastructure must already exist.
      const stack = await describeStack({ stage, region })
      const accountId = stack?.StackId?.split(':')[4]
      const outputs = Object.fromEntries((stack?.Outputs ?? []).map((output) => [output.OutputKey, output.OutputValue]))
      for (const consumerArn of Object.values(consumers)) {
        if (consumerArn.split(':')[4] !== accountId) throw new InfrastructureConfigurationError('Consumer account does not match deployment')
      }
      const registry = JSON.stringify({ stage,
        android: `arn:aws:sns:${region}:${accountId}:app/GCM/travellier-${stage}-android`,
        ios: `arn:aws:sns:${region}:${accountId}:app/${configuration.iosPlatform}/travellier-${stage}-ios`,
        firebaseProjectId: configuration.firebaseProjectId })
      for (const [outputKey, expected] of [
        ['PushApplicationsSecretArn', registry], ['FcmCredentialsSecretArn', configuration.fcmCredential],
        ['ApnsCredentialsSecretArn', JSON.stringify({ platform: configuration.iosPlatform, ...configuration.apns })],
      ]) {
        if (!outputs[outputKey] || await getMongoSecretValue({ region, secretId: outputs[outputKey] }) !== expected) {
          throw new InfrastructureConfigurationError('Configure push in a disabled deployment before activating consumers')
        }
      }
      const { LambdaClient, GetFunctionConfigurationCommand } = await import('@aws-sdk/client-lambda')
      const client = new LambdaClient({ region })
      for (const [name, consumerArn] of Object.entries(consumers)) {
        const worker = name === 'eventsConsumerArn' ? 'Events' : 'StorageDeletion'
        const consumerConfiguration = await client.send(new GetFunctionConfigurationCommand({ FunctionName: consumerArn }))
        validateConsumerConfiguration({ consumerArn, accountId, roleArn: outputs[`${worker}WorkerRoleArn`], configuration: consumerConfiguration })
      }
    },
    provisionPush: async ({ configuration }) => {
      const stack = await describeStack({ stage, region })
      const accountId = stack?.StackId?.split(':')[4]
      const secrets = Object.fromEntries((stack?.Outputs ?? []).map((output) => [output.OutputKey, output.OutputValue]))
      if (Object.values(consumers).some((consumer) => consumer.split(':')[4] !== accountId)) {
        throw new InfrastructureConfigurationError('Consumer account does not match deployment')
      }
      const provision = await createAwsPushProvisioner(region)
      await provision({ stage, region, accountId, secrets, configuration })
    },
  })({
    stage,
    region,
    serverlessArguments,
    environment: process.env,
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(safeDeploymentError(error))
    process.exitCode = 1
  })
}
