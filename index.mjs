/**
 * Host half of the local soul-presets bundle.
 *
 * It owns four things and nothing else: the preset directory as a synchronous
 * snapshot (`soulPresets`), the `active` Config field holding which preset is
 * in force, the same-origin routes that create, delete, and reveal preset
 * files, and the service the preset-scoped prompt row reads.
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
import { createPresetStore } from './src/presets.mjs'
import { revealDirectory } from './src/reveal.mjs'
import { createRoutes } from './src/routes.mjs'
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
  const selection = config.active
  let active = selection.get() === '' ? null : selection.get()

  // Loader commits a new id into the reference before it announces the update,
  // and the prompt row's text provider is synchronous: refresh the cache here
  // so the provider never awaits anything.
  ctx.on('loader/volatile-update', () => {
    const next = selection.get()
    active = next === '' ? null : next
  })

  ctx.provide('soulPresets', {
    /**
     * The roster plus the active id, for the browser half.
     * @returns the rows and the active selection.
     */
    roster: () => store.roster(active),
    /**
     * The composed prompt text for one session directory.
     * @param cwd - the session's working directory.
     * @returns the text, or null when nothing is selected and the workspace file
     * carries nothing either.
     */
    promptText: cwd => store.text(cwd, active),
  })

  for (const route of createRoutes({
    root,
    store,
    active: () => active,
    reveal: revealDirectory,
    log: message => { ctx.logger.warn(message) },
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
