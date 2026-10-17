/**
 * Host half of the local soul-presets bundle.
 *
 * It owns six things and nothing else: the preset directory as a synchronous
 * snapshot (`soulPresets`), the `active` Config field holding the global
 * default, the per-session selection store (`.selections.json`), the
 * same-origin routes that read the roster, write per-session selections, and
 * create, delete, and reveal preset files, the service the preset-scoped
 * prompt row reads, and the `$id` gesture listener that expands named presets
 * in any mode's composer.
 *
 * The active id is cached in a plain variable rather than read from the Config
 * reference on demand because the prompt row's text provider is a SYNCHRONOUS
 * contract (system-prompt calls it and interpolates the result as a string),
 * while a write settles through Loader asynchronously. The
 * `loader/volatile-update` listener refreshes the cache; the text provider only
 * reads memory.
 * @module dsh-local-soul-presets
 */
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expansionInjections } from './src/expand.mjs'
import { createPresetStore } from './src/presets.mjs'
import { PRESET_ID } from './src/presets.mjs'
import { revealDirectory } from './src/reveal.mjs'
import { createRoutes } from './src/routes.mjs'
import { createSelectionStore } from './src/selection.mjs'
import { SoulPresetSettings } from './src/settings.mjs'

/** Bundle id, as the profile's cordis patch row names it. */
export const name = 'dsh-local-soul-presets'

/** The active-preset selection, projected into the settings form for this entry. */
export const Config = SoulPresetSettings

/** Services this Host half needs before it applies. */
export const inject = ['webServer']

/**
 * Resolve the preset directory.
 * @param env - the process environment.
 * @param home - the user's home directory.
 * @returns the absolute preset directory.
 */
export function resolvePresetRoot(env = process.env, home = homedir()) {
  const dshHome = env.DSH_HOME !== undefined && env.DSH_HOME !== '' ? env.DSH_HOME : join(home, '.dsh')
  return join(dshHome, 'soul-presets')
}

/**
 * Serve the routes and provide the preset service.
 * @param ctx - the plugin context, with `webServer` live.
 * @param config - the resolved Config, whose `active` reference follows writes.
 */
export function apply(ctx, config) {
  const root = resolvePresetRoot()
  const store = createPresetStore(root)
  const log = message => { ctx.logger.warn(message) }
  const selection = createSelectionStore({
    file: join(root, '.selections.json'),
    presetId: id => PRESET_ID.test(id),
    log,
  })
  const selectionDep = config.active
  let active = selectionDep.get() === '' ? null : selectionDep.get()
  const expandDep = config.expand
  let expand = expandDep.get() !== false

  // Loader commits a new value into the reference before it announces the update,
  // and the prompt row's text provider is synchronous: refresh the cache here
  // so the provider never awaits anything. The gesture flag rides the same
  // event, so one config write moves both on the next turn.
  ctx.on('loader/volatile-update', () => {
    const next = selectionDep.get()
    active = next === '' ? null : next
    expand = expandDep.get() !== false
  })

  // The id one assembly runs under: the session's own override when it names a
  // usable preset, otherwise the global default. A stale override degrades to
  // the default — never to "no selection".
  const effective = sessionId => {
    const override = selection.get(sessionId)
    return override !== undefined && store.has(override) ? override : active
  }

  ctx.provide('soulPresets', {
    /**
     * The roster, resolved for one session when asked: its `active` echo is the
     * session's effective preset and `overridden` says whether that comes from
     * the session's own choice or the global default. Stale override rows are
     * pruned here, where the live preset ids are already in hand.
     * @param sessionId - the session id, when resolving for one.
     * @returns the rows, the effective selection, and the override flag.
     */
    roster(sessionId) {
      const base = store.roster(active)
      const validIds = new Set(base.presets.filter(row => row.broken === undefined).map(row => row.id))
      selection.pruneWith(validIds)
      return {
        ...base,
        active: effective(sessionId),
        overridden: sessionId !== undefined && selection.has(sessionId),
      }
    },
    /**
     * The composed prompt text for one session directory.
     * @param cwd - the session's working directory.
     * @param sessionId - the session whose preset resolves, when known.
     * @returns the text, or null when nothing is selected and the workspace file
     * carries nothing either.
     */
    promptText: (cwd, sessionId) => store.text(cwd, effective(sessionId)),
  })

  // The `$id` gesture: presets named in a user message enter the step as
  // injected prompt messages. `agent/pre-step` is an agent-loop event an
  // app-level listener hears for every agent preset, so this covers every mode
  // without per-mode wiring. The gate reads the cached flag, so a config write
  // takes effect on the next turn without remounting the plugin.
  ctx.effect(() => ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || !expand) return decision
    const injections = expansionInjections(payload.messages, id => store.textById(id))
    return injections.length === 0 ? decision : { ...decision, messages: [...decision.messages, ...injections] }
  }), `${name}: $ gesture`)

  for (const route of createRoutes({
    root,
    store,
    active: () => active,
    selection,
    effective,
    reveal: revealDirectory,
    log,
  })) {
    ctx.effect(
      () => ctx.webServer.register({ kind: route.kind, path: route.path, handler: route.handler }),
      `${name}: ${route.id}`,
    )
  }

  // The directory is created on apply: the create route needs it to exist, and
  // an unusable root degrades to an empty roster rather than failing the fiber.
  ctx.effect(() => {
    try {
      mkdirSync(root, { recursive: true })
    } catch {
      // A read-only or missing parent leaves an empty roster; a write attempt
      // reports the failure through its own route.
    }
  }, `${name}: preset root`)
}
