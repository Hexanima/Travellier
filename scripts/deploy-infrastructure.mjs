import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const mongoSecretOutputKey = 'MongoConfigurationSecretArn'

const requiredSetting = (environment, name) => {
  const value = environment[name]?.trim()

  if (value === undefined || value === '') {
    throw new Error(`${name} is required`)
  }

  return value
}

const createMongoConfiguration = (environment) =>
  JSON.stringify({
    uri: requiredSetting(environment, 'MONGODB_URI'),
    databaseName: requiredSetting(environment, 'MONGODB_DATABASE_NAME'),
  })

export const createInfrastructureDeployer = ({
  runServerless,
  getMongoSecretArn,
  getMongoSecretValue,
  putMongoSecretValue,
}) =>
  async ({ stage, region, serverlessArguments, environment }) => {
    const secretString = createMongoConfiguration(environment)

    await runServerless(serverlessArguments)

    const secretId = await getMongoSecretArn({ stage, region })

    if (secretId === undefined || secretId === '') {
      throw new Error('MongoConfigurationSecretArn is missing from the deployed stack')
    }

    const currentSecretString = await getMongoSecretValue({ region, secretId })

    if (currentSecretString !== secretString) {
      await putMongoSecretValue({
        region,
        secretId,
        secretString,
        clientRequestToken: randomUUID(),
      })
    }
  }

const readOption = (argumentsList, name, fallback) => {
  const assignedArgument = argumentsList.find((argument) => argument.startsWith(`${name}=`))

  if (assignedArgument !== undefined) {
    return assignedArgument.slice(name.length + 1)
  }

  const optionIndex = argumentsList.indexOf(name)

  if (optionIndex >= 0 && argumentsList[optionIndex + 1] !== undefined) {
    return argumentsList[optionIndex + 1]
  }

  return fallback
}

const runServerless = async (serverlessArguments) => {
  const command = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
  const result = spawnSync(command, ['yarn', 'serverless', 'deploy', ...serverlessArguments], {
    cwd: rootDirectory,
    env: process.env,
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
  const { CloudFormationClient, DescribeStacksCommand } = await import(
    '@aws-sdk/client-cloudformation'
  )
  const client = new CloudFormationClient({ region })
  const response = await client.send(
    new DescribeStacksCommand({ StackName: `travellier-api-${stage}` }),
  )

  return response.Stacks?.[0]?.Outputs?.find(
    (output) => output.OutputKey === mongoSecretOutputKey,
  )?.OutputValue
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
  const serverlessArguments = process.argv.slice(2)
  const stage = readOption(serverlessArguments, '--stage')

  if (stage === undefined || stage === '') {
    throw new Error('--stage is required')
  }

  await createInfrastructureDeployer({
    runServerless,
    getMongoSecretArn,
    getMongoSecretValue,
    putMongoSecretValue,
  })({
    stage,
    region: readOption(serverlessArguments, '--region', 'sa-east-1'),
    serverlessArguments,
    environment: process.env,
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
