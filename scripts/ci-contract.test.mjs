import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import yaml from 'js-yaml'

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)))

const read = (relativePath) => readFileSync(join(rootDirectory, relativePath), 'utf8')
const readJson = (relativePath) => JSON.parse(read(relativePath))

const workflow = yaml.load(read('.github/workflows/ci.yml'))
const jobs = workflow.jobs
const integration = jobs['web-integration']
const android = jobs['android-native']
const emulatorSteps = android.steps.filter((step) =>
  String(step.uses ?? '').startsWith('reactivecircus/android-emulator-runner'),
)

const cacheStep = integration.steps.find((step) => String(step.uses ?? '').startsWith('actions/cache'))
const downloadDir = integration.env?.MONGOMS_DOWNLOAD_DIR
// GitHub solo admite estos contextos al evaluar jobs.<job_id>.env; usar otro (por ejemplo
// runner) invalida el workflow entero y ningun job llega a ejecutarse.
const contextsAllowedInJobEnv = ['github', 'needs', 'strategy', 'matrix', 'vars', 'secrets', 'inputs']

describe('integration test job', () => {
  it('runs the web integration suite in its own job', () => {
    assert.ok(integration, 'missing web-integration job')
    assert.equal(integration['runs-on'], 'ubuntu-latest')
    assert.ok(
      integration.steps.some((step) => /corepack yarn test:integration/.test(String(step.run ?? ''))),
      'web-integration must run the integration script',
    )
    assert.ok(
      integration.steps.some((step) =>
        /corepack yarn workspace web typecheck:integration/.test(String(step.run ?? '')),
      ),
      'web-integration must typecheck the integration suite',
    )
  })

  it('runs the integration job on a matrix of time zones', () => {
    const zones = integration.strategy?.matrix?.tz
    assert.ok(Array.isArray(zones), 'web-integration must run a matrix of time zones')
    for (const zone of ['UTC', 'America/Argentina/Buenos_Aires']) {
      assert.ok(zones.includes(zone), `the time zone matrix must include ${zone}`)
    }
    assert.equal(integration.env?.TZ, '${{ matrix.tz }}')
    assert.equal(
      integration.strategy['fail-fast'],
      false,
      'one failing time zone must not cancel the others',
    )
  })

  it('caches the mongodb binaries where the package downloads them', () => {
    assert.ok(cacheStep, 'missing the mongodb binaries cache step')
    assert.ok(downloadDir, 'missing MONGOMS_DOWNLOAD_DIR in the job env')
    assert.doesNotMatch(
      String(downloadDir),
      /~/,
      'mongodb-memory-server does not expand "~": use an absolute path',
    )
    assert.equal(
      String(cacheStep.with.path).trim(),
      String(downloadDir).trim(),
      'the cached path must be the download path',
    )
  })

  it('builds the download path with a context valid in jobs.<job_id>.env', () => {
    const value = String(downloadDir)
    const used = Array.from(value.matchAll(/\$\{\{\s*([A-Za-z_][\w-]*)/g)).map((match) => match[1])

    for (const context of used) {
      assert.ok(
        contextsAllowedInJobEnv.includes(context),
        `the "${context}" context is not available in jobs.<job_id>.env: use one of ${contextsAllowedInJobEnv.join(', ')}`,
      )
    }

    if (used.length === 0) {
      assert.match(value, /^\//, 'without a context the download path must be an absolute path')
    }
  })

  it('restores the cache before the step that downloads the binaries', () => {
    const installIndex = integration.steps.findIndex((step) =>
      /corepack yarn install/.test(String(step.run ?? '')),
    )

    assert.notEqual(installIndex, -1, 'missing the install step')

    // El postinstall de mongodb-memory-server descarga el binario durante el install:
    // o la cache se restaura antes, o el postinstall queda desactivado y descarga el globalSetup.
    if (String(integration.env?.MONGOMS_DISABLE_POSTINSTALL ?? '') === 'true') return

    assert.ok(
      integration.steps.indexOf(cacheStep) < installIndex,
      'the cache must be restored before "corepack yarn install" (its postinstall downloads the binary) or the postinstall must be disabled with MONGOMS_DISABLE_POSTINSTALL',
    )
  })

  it('keeps the integration suite out of the quality job', () => {
    for (const step of jobs.quality.steps) {
      assert.doesNotMatch(String(step.run ?? ''), /test:integration/)
    }
  })

  it('exposes the integration script from the repository root', () => {
    const rootManifest = readJson('package.json')

    assert.match(rootManifest.scripts['test:integration'] ?? '', /workspace web test:integration/)
    assert.doesNotMatch(rootManifest.scripts.test, /test:integration/)
    assert.match(rootManifest.scripts.test, /scripts\/ci-contract\.test\.mjs/)
  })

  it('runs the integration suite with a single worker', () => {
    const webManifest = readJson('apps/web/package.json')
    const config = read('apps/web/vitest.integration.config.ts')

    assert.match(webManifest.scripts['test:integration'] ?? '', /--maxWorkers=1/)
    assert.match(config, /maxWorkers:\s*1/)
    assert.match(config, /fileParallelism:\s*false/)
  })
})

// Minutos reservados para checkout, install, cap:sync:android, cap:smoke:bundle y sdkmanager.
const preparationMarginMinutes = 10

const failureCondition = (stepId) =>
  new RegExp(`steps\\.${stepId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.outcome\\s*==\\s*'failure'`)

describe('android emulator job', () => {
  it('boots a cold, freshly created emulator', () => {
    for (const step of emulatorSteps) {
      assert.match(String(step.with['emulator-options']), /-no-snapshot/)
      assert.equal(step.with['force-avd-creation'], true)
      assert.ok(step.with['emulator-boot-timeout'], 'missing emulator-boot-timeout')
      assert.match(String(step.with['pre-emulator-launch-script']), /adb start-server/)
    }
  })

  it('retries the emulator exactly once', () => {
    assert.equal(emulatorSteps.length, 2)

    const [attempt, retry] = emulatorSteps
    assert.ok(attempt.id, 'the first emulator attempt needs an id')
    assert.equal(attempt['continue-on-error'], true)
    assert.match(String(retry.if), failureCondition(attempt.id))
    assert.doesNotMatch(String(retry['continue-on-error'] ?? ''), /true/)
  })

  it('kills a stale emulator between both attempts', () => {
    const [attempt, retry] = emulatorSteps
    const attemptIndex = android.steps.indexOf(attempt)
    const retryIndex = android.steps.indexOf(retry)
    const cleanupIndex = android.steps.findIndex((step) => /emu kill/.test(String(step.run ?? '')))

    assert.notEqual(cleanupIndex, -1, 'missing the stale emulator cleanup step')
    assert.ok(
      attemptIndex < cleanupIndex && cleanupIndex < retryIndex,
      'the cleanup step must sit between both attempts',
    )
    assert.match(String(android.steps[cleanupIndex].if), failureCondition(attempt.id))

    // El paso corre fuera de android-emulator-runner: sin su PATH no hay "adb" y los
    // "|| true" dejarian la limpieza en silencio.
    const cleanup = String(android.steps[cleanupIndex].run ?? '')

    for (const line of cleanup.split('\n')) {
      assert.doesNotMatch(
        line,
        /(^|[|&;(] *| )adb /,
        'invoke adb as "$ANDROID_HOME/platform-tools/adb": the cleanup step has no emulator PATH',
      )
    }

    assert.match(cleanup, /\$ANDROID_HOME\/platform-tools\/adb/)
  })

  it('bounds every attempt inside the job timeout', () => {
    const total = emulatorSteps.reduce((sum, step) => {
      assert.ok(step['timeout-minutes'], 'every emulator attempt needs a timeout')
      return sum + step['timeout-minutes']
    }, 0)

    assert.ok(
      android['timeout-minutes'] >= total + preparationMarginMinutes,
      `the job timeout must fit both attempts plus ${preparationMarginMinutes} minutes of preparation`,
    )
  })

  it('waits for the boot and dismisses system dialogs before instrumenting', () => {
    const script = read('apps/web/test/run-android-native-smoke.sh')

    assert.match(script, /wait-for-device/)
    assert.match(script, /sys\.boot_completed/)
    assert.match(script, /deadline/)
    assert.match(script, /hide_error_dialogs/)
    assert.match(script, /immersive_mode_confirmations/)
    assert.match(script, /dismiss-keyguard/)
    assert.match(script, /CLOSE_SYSTEM_DIALOGS/)
  })
})

describe('documentation', () => {
  it('documents the integration commands', () => {
    assert.match(read('README.md'), /corepack yarn test:integration/)
  })
})
