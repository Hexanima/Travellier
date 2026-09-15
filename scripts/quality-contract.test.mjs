import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)))

const readJson = (relativePath) =>
  JSON.parse(readFileSync(join(rootDirectory, relativePath), 'utf8'))

const requiredCommands = ['lint', 'typecheck', 'test', 'build']
const workspaces = [
  { name: 'app-domain', manifest: 'domain/package.json' },
  { name: 'api', manifest: 'apps/api/package.json' },
  { name: 'web', manifest: 'apps/web/package.json' },
]

describe('quality contract', () => {
  it('exposes every quality command from the repository root', () => {
    const rootManifest = readJson('package.json')

    for (const command of requiredCommands) {
      assert.ok(rootManifest.scripts[command], `missing root ${command} script`)
      assert.match(rootManifest.scripts[command], /workspaces foreach/)
      assert.match(rootManifest.scripts[command], new RegExp(`run ${command}`))
    }
  })

  it('makes every workspace implement the quality command contract', () => {
    for (const workspace of workspaces) {
      const manifest = readJson(workspace.manifest)

      for (const command of requiredCommands) {
        assert.ok(
          manifest.scripts[command],
          `${workspace.name} is missing its ${command} script`,
        )
      }
    }
  })

  it('defines a mandatory CI quality gate', () => {
    const workflowPath = join(rootDirectory, '.github/workflows/ci.yml')

    assert.ok(existsSync(workflowPath), 'missing CI workflow')

    const workflow = readFileSync(workflowPath, 'utf8')
    assert.match(workflow, /actions\/setup-node@v5/)
    assert.doesNotMatch(workflow, /cache:\s*yarn/)
    assert.match(workflow, /corepack enable/)
    assert.match(workflow, /corepack yarn install --immutable/)

    for (const command of requiredCommands) {
      assert.match(workflow, new RegExp(`corepack yarn ${command}`))
    }
  })
})
