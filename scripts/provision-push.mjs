import { createPrivateKey } from 'node:crypto'

export class InfrastructureConfigurationError extends Error {}
const required = (environment, name) => {
  const value = environment[name]?.trim()
  if (!value) throw new InfrastructureConfigurationError(`${name} is required`)
  return value
}
export const validateStage = (stage) => {
  if (!['dev', 'prod'].includes(stage)) throw new InfrastructureConfigurationError('Infrastructure stage must be dev or prod')
}
const privateKey = (value, name, type) => {
  try {
    const key = createPrivateKey(value)
    if (key.asymmetricKeyType !== type || (type === 'ec' && key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')) throw new Error()
  } catch { throw new InfrastructureConfigurationError(`${name} must contain a valid ${type} private key`) }
}

export const readPushConfiguration = (stage, environment) => {
  validateStage(stage)
  const fcmCredential = required(environment, 'PUSH_FCM_SERVICE_ACCOUNT_JSON')
  let fcm
  try { fcm = JSON.parse(fcmCredential) } catch { throw new InfrastructureConfigurationError('PUSH_FCM_SERVICE_ACCOUNT_JSON must be valid JSON') }
  if (fcm?.type !== 'service_account' || typeof fcm.project_id !== 'string' || !fcm.project_id ||
    typeof fcm.client_email !== 'string' || !fcm.client_email.endsWith('.iam.gserviceaccount.com') || typeof fcm.private_key !== 'string') {
    throw new InfrastructureConfigurationError('PUSH_FCM_SERVICE_ACCOUNT_JSON must be a Firebase service account')
  }
  privateKey(fcm.private_key, 'PUSH_FCM_SERVICE_ACCOUNT_JSON', 'rsa')
  const apns = {
    PlatformCredential: required(environment, 'PUSH_APNS_PRIVATE_KEY'),
    PlatformPrincipal: required(environment, 'PUSH_APNS_KEY_ID'),
    ApplePlatformTeamID: required(environment, 'PUSH_APNS_TEAM_ID'),
    ApplePlatformBundleID: required(environment, 'PUSH_APNS_BUNDLE_ID'),
  }
  privateKey(apns.PlatformCredential, 'PUSH_APNS_PRIVATE_KEY', 'ec')
  for (const [name, value] of [['PUSH_APNS_KEY_ID', apns.PlatformPrincipal], ['PUSH_APNS_TEAM_ID', apns.ApplePlatformTeamID]]) {
    if (!/^[A-Z0-9]{10}$/.test(value)) throw new InfrastructureConfigurationError(`${name} must be a 10 character identifier`)
  }
  if (!/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(apns.ApplePlatformBundleID)) throw new InfrastructureConfigurationError('PUSH_APNS_BUNDLE_ID is invalid')
  const iosPlatform = required(environment, 'PUSH_APNS_PLATFORM')
  if (!['APNS', 'APNS_SANDBOX'].includes(iosPlatform)) throw new InfrastructureConfigurationError('PUSH_APNS_PLATFORM must be APNS or APNS_SANDBOX')
  if (stage === 'prod' && iosPlatform === 'APNS_SANDBOX') throw new InfrastructureConfigurationError('Production cannot use APNs sandbox')
  return { fcmCredential, firebaseProjectId: fcm.project_id, apns, iosPlatform }
}

export const createPushProvisioner = ({
  getSecretValue, putSecretValue, getApplicationAttributes, createApplication, setApplicationAttributes,
}) => async ({ stage, region, accountId, secrets, configuration }) => {
  validateStage(stage)
  if (!/^[0-9]{12}$/.test(accountId) || !/^[a-z0-9-]+$/.test(region)) throw new InfrastructureConfigurationError('Invalid deployment account or region')
  for (const name of ['FcmCredentialsSecretArn', 'ApnsCredentialsSecretArn', 'PushApplicationsSecretArn']) {
    if (!secrets[name]) throw new InfrastructureConfigurationError('Push secret stack outputs are missing')
  }
  const applicationArn = (platform, name) => `arn:aws:sns:${region}:${accountId}:app/${platform}/${name}`
  const androidArn = applicationArn('GCM', `travellier-${stage}-android`)
  const iosArn = applicationArn(configuration.iosPlatform, `travellier-${stage}-ios`)
  const validIosArns = ['APNS', 'APNS_SANDBOX'].map((platform) => applicationArn(platform, `travellier-${stage}-ios`))
  try {
    const currentRegistry = await getSecretValue(secrets.PushApplicationsSecretArn)
    if (currentRegistry !== undefined) {
      let registry
      try { registry = JSON.parse(currentRegistry) } catch { throw new InfrastructureConfigurationError('Invalid push registry') }
      if (registry?.stage !== stage || registry.android !== androidArn || !validIosArns.includes(registry.ios)) {
        throw new InfrastructureConfigurationError('Push registry does not belong to this stage/account/region')
      }
    }
    for (const [platform, name, expectedArn, attributes, secretId, secretValue] of [
      ['GCM', `travellier-${stage}-android`, androidArn, { PlatformCredential: configuration.fcmCredential }, secrets.FcmCredentialsSecretArn, configuration.fcmCredential],
      [configuration.iosPlatform, `travellier-${stage}-ios`, iosArn, configuration.apns, secrets.ApnsCredentialsSecretArn, JSON.stringify({ platform: configuration.iosPlatform, ...configuration.apns })],
    ]) {
      const existing = await getApplicationAttributes(expectedArn)
      const currentSecret = await getSecretValue(secretId)
      if (existing === undefined) {
        const createdArn = await createApplication({ Name: name, Platform: platform, Attributes: attributes })
        if (createdArn !== expectedArn) throw new InfrastructureConfigurationError('Provider returned an unexpected application ARN')
      } else if (currentSecret !== secretValue || (existing.AuthenticationMethod !== undefined && existing.AuthenticationMethod !== 'Token') ||
        (platform !== 'GCM' && ['ApplePlatformTeamID', 'ApplePlatformBundleID'].some((key) => existing[key] !== attributes[key]))) {
        await setApplicationAttributes(expectedArn, attributes)
      }
      if (currentSecret !== secretValue) await putSecretValue(secretId, secretValue)
    }
    const registry = JSON.stringify({ stage, android: androidArn, ios: iosArn, firebaseProjectId: configuration.firebaseProjectId })
    if (currentRegistry !== registry) await putSecretValue(secrets.PushApplicationsSecretArn, registry)
  } catch (error) {
    if (error instanceof InfrastructureConfigurationError) throw error
    // Provider exceptions may reflect keys or JSON credentials. Do not attach a cause.
    throw new Error('Push provisioning failed; readiness was not confirmed')
  }
}

export const createAwsPushProvisioner = async (region) => {
  const { SNSClient, GetPlatformApplicationAttributesCommand, CreatePlatformApplicationCommand, SetPlatformApplicationAttributesCommand } = await import('@aws-sdk/client-sns')
  const { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } = await import('@aws-sdk/client-secrets-manager')
  const sns = new SNSClient({ region }), secrets = new SecretsManagerClient({ region })
  return createPushProvisioner({
    getSecretValue: async (id) => {
      try { return (await secrets.send(new GetSecretValueCommand({ SecretId: id, VersionStage: 'AWSCURRENT' }))).SecretString }
      catch (error) { if (error.name === 'ResourceNotFoundException') return undefined; throw error }
    },
    putSecretValue: async (id, value) => { await secrets.send(new PutSecretValueCommand({ SecretId: id, SecretString: value })) },
    getApplicationAttributes: async (id) => {
      try { return (await sns.send(new GetPlatformApplicationAttributesCommand({ PlatformApplicationArn: id }))).Attributes }
      catch (error) { if (error.name === 'NotFoundException') return undefined; throw error }
    },
    createApplication: async (input) => (await sns.send(new CreatePlatformApplicationCommand(input))).PlatformApplicationArn,
    setApplicationAttributes: async (id, attributes) => { await sns.send(new SetPlatformApplicationAttributesCommand({ PlatformApplicationArn: id, Attributes: attributes })) },
  })
}
