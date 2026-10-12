import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { describe, it } from 'node:test'

const module = await import('./provision-push.mjs').catch(() => ({}))
const readConfiguration = module.readPushConfiguration ?? (() => undefined)
const createProvisioner = module.createPushProvisioner ?? (() => async () => undefined)
const key = (type, options) => generateKeyPairSync(type, options).privateKey.export({ type: 'pkcs8', format: 'pem' })
const fcm = JSON.stringify({ type: 'service_account', project_id: 'travellier-dev', client_email: 'push@travellier-dev.iam.gserviceaccount.com', private_key: key('rsa', { modulusLength: 2048 }) })
const environment = {
  PUSH_FCM_SERVICE_ACCOUNT_JSON: fcm, PUSH_APNS_PRIVATE_KEY: key('ec', { namedCurve: 'prime256v1' }),
  PUSH_APNS_KEY_ID: 'ABC1234567', PUSH_APNS_TEAM_ID: 'DEF1234567', PUSH_APNS_BUNDLE_ID: 'com.travellier.app.dev',
  PUSH_APNS_PLATFORM: 'APNS_SANDBOX',
}
const appArn = (platform, name) => `arn:aws:sns:sa-east-1:123456789012:app/${platform}/${name}`
const secrets = {
  FcmCredentialsSecretArn: 'fcm-secret', ApnsCredentialsSecretArn: 'apns-secret', PushApplicationsSecretArn: 'registry-secret',
}
const fixture = (existing = {}) => {
  const calls = []
  const stored = new Map(Object.entries(existing))
  const attributes = new Map()
  const provision = createProvisioner({
    getSecretValue: async (id) => stored.get(id),
    putSecretValue: async (id, value) => { calls.push(['secret', id]); stored.set(id, value) },
    getApplicationAttributes: async (id) => attributes.get(id),
    createApplication: async (input) => {
      calls.push(['create', input]); const id = appArn(input.Platform, input.Name); attributes.set(id, input.Attributes); return id
    },
    setApplicationAttributes: async (id, value) => { calls.push(['update', id]); attributes.set(id, value) },
  })
  return { calls, stored, attributes, provision }
}

describe('SNS push provisioning', () => {
  it('validates credentials without reflecting their contents', () => {
    assert.ok(readConfiguration('dev', environment))
    for (const name of Object.keys(environment)) {
      assert.throws(() => readConfiguration('dev', { ...environment, [name]: '' }), new RegExp(name))
    }
    assert.throws(() => readConfiguration('staging', environment), /stage/)
    assert.throws(() => readConfiguration('prod', environment), /sandbox/i)
    assert.throws(() => readConfiguration('dev', { ...environment, PUSH_FCM_SERVICE_ACCOUNT_JSON: 'private-canary' }), (error) => !error.message.includes('private-canary'))
    assert.throws(() => readConfiguration('dev', { ...environment, PUSH_APNS_PRIVATE_KEY: fcm }), /PUSH_APNS_PRIVATE_KEY/)
  })

  it('provisions FCM token auth and APNs, storing only the resulting stage registry', async () => {
    const f = fixture()
    await f.provision({ stage: 'dev', region: 'sa-east-1', accountId: '123456789012', secrets, configuration: readConfiguration('dev', environment) })
    const creates = f.calls.filter(([name]) => name === 'create').map(([, value]) => value)
    assert.deepEqual(creates.map((a) => [a.Name, a.Platform]), [['travellier-dev-android', 'GCM'], ['travellier-dev-ios', 'APNS_SANDBOX']])
    assert.equal(creates[0].Attributes.PlatformCredential, fcm)
    assert.equal(creates[1].Attributes.PlatformPrincipal, 'ABC1234567')
    const registry = JSON.parse(f.stored.get('registry-secret'))
    assert.equal(registry.stage, 'dev')
    assert.equal(registry.android, appArn('GCM', 'travellier-dev-android'))
    assert.equal(registry.ios, appArn('APNS_SANDBOX', 'travellier-dev-ios'))
    assert.equal(JSON.stringify(registry).includes('PRIVATE KEY'), false)
    assert.equal(f.calls.at(-1)[1], 'registry-secret')
  })

  it('reconciles without duplicating applications or secret versions and rotates changed credentials', async () => {
    const f = fixture()
    const input = { stage: 'dev', region: 'sa-east-1', accountId: '123456789012', secrets, configuration: readConfiguration('dev', environment) }
    await f.provision(input)
    f.calls.length = 0
    await f.provision(input)
    assert.deepEqual(f.calls, [])
    await f.provision({ ...input, configuration: readConfiguration('dev', { ...environment, PUSH_APNS_KEY_ID: 'XYZ1234567' }) })
    assert.equal(f.calls.filter(([name]) => name === 'create').length, 0)
    assert.ok(f.calls.some(([name]) => name === 'update'))
  })

  it('is idempotent when SNS returns only its documented public APNs attributes', async () => {
    const f = fixture()
    const input = { stage: 'dev', region: 'sa-east-1', accountId: '123456789012', secrets, configuration: readConfiguration('dev', environment) }
    await f.provision(input)
    f.attributes.set(appArn('APNS_SANDBOX', 'travellier-dev-ios'), {
      AuthenticationMethod: 'Token', ApplePlatformTeamID: 'DEF1234567', ApplePlatformBundleID: 'com.travellier.app.dev',
    })
    f.calls.length = 0
    await f.provision(input)
    assert.deepEqual(f.calls, [])
  })

  it('recovers an application created before the registry could be saved', async () => {
    const f = fixture()
    const input = { stage: 'dev', region: 'sa-east-1', accountId: '123456789012', secrets, configuration: readConfiguration('dev', environment) }
    await f.provision(input)
    f.stored.delete('registry-secret')
    f.calls.length = 0
    await f.provision(input)
    assert.equal(f.calls.filter(([name]) => name === 'create').length, 0)
    assert.ok(f.stored.has('registry-secret'))
  })

  it('rejects a registry from another stage/account before changing provider resources', async () => {
    for (const registry of [{ stage: 'prod', android: appArn('GCM', 'travellier-prod-android') },
      { stage: 'dev', android: appArn('GCM', 'travellier-dev-android').replace('123456789012', '999999999999') }]) {
      const f = fixture({ 'registry-secret': JSON.stringify(registry) })
      await assert.rejects(f.provision({ stage: 'dev', region: 'sa-east-1', accountId: '123456789012', secrets, configuration: readConfiguration('dev', environment) }), /registry/)
      assert.deepEqual(f.calls, [])
    }
  })

  it('does not persist readiness or leak provider error messages after a failure', async () => {
    let registryWritten = false
    const provision = createProvisioner({
      getSecretValue: async () => undefined, getApplicationAttributes: async () => undefined,
      putSecretValue: async (id) => { if (id === 'registry-secret') registryWritten = true },
      createApplication: async () => { throw new Error(`provider exposed ${fcm}`) },
    })
    await assert.rejects(provision({ stage: 'dev', region: 'sa-east-1', accountId: '123456789012', secrets,
      configuration: readConfiguration('dev', environment) }), (error) => !error.message.includes(fcm))
    assert.equal(registryWritten, false)
  })
})
