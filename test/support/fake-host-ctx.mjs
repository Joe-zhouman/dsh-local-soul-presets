/**
 * Shared test doubles for the Host half.
 *
 * Both the source test and the artifact test use these, so the built entry is
 * judged by the same expectations as the source rather than by export names
 * alone.
 * @module dsh-local-soul-presets/test/support/fake-host-ctx
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A Host context whose services are real enough to catch misuse: `provide`/`get`
 * behave like cordis, `webServer.register` refuses a duplicate route the way the
 * real one does, and `loader/volatile-update` reaches the listener the plugin
 * registered.
 * @param options - the value the Config reference starts from.
 * @returns the context, the Config argument, and the recorded routes and effects.
 */
export function fakeCtx({ settings = {} } = {}) {
  const services = new Map()
  const routes = []
  const effects = []
  const listeners = new Map()
  let current = { active: '', ...settings }
  const ctx = {
    logger: { info() {}, warn() {} },
    webServer: {
      register: route => {
        const key = `${route.kind} ${route.path}`
        if (routes.some(existing => `${existing.kind} ${existing.path}` === key)) {
          throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
        }
        routes.push(route)
        return () => {}
      },
    },
    provide: (name, value) => { services.set(name, value); return () => { services.delete(name) } },
    get: name => services.get(name),
    effect: factory => { effects.push(factory()) },
    on: (event, handler) => { listeners.set(event, handler); return () => {} },
  }
  // Loader commits the new value before it announces the update, so the
  // reference moves first and the listener follows.
  ctx.__set = next => {
    current = next
    listeners.get('loader/volatile-update')?.()
  }
  return { ctx, config: { active: { get: () => current.active } }, routes, effects }
}

/**
 * Run one test body against a temporary DSH_HOME holding one preset.
 * @param run - the test body.
 * @returns whatever the body returns.
 */
export function withPresetRoot(run) {
  const home = mkdtempSync(join(tmpdir(), 'soul-home-'))
  // apply() scans $DSH_HOME/soul-presets, so the fixture must sit one level
  // BELOW the DSH_HOME this test injects. Writing translate.toml at the top
  // level would make apply() scan an empty directory and the assertions would
  // read an empty roster.
  const root = join(home, 'soul-presets')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'translate.toml'), 'preset = "翻译"\n[Prompt]\nSystem = "T"\n')
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
}
