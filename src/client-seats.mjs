/**
 * The React-free half of the browser bundle: the roster store, the seat object
 * the three surfaces read, the dictionary, and the slot registrations.
 *
 * Components arrive as arguments so this module is exercisable by `node --test`
 * without React resolvable — the package has no react dependency, while the
 * browser gets React from the loader's module table. Two registration contracts
 * matter here: `inject` must return a plain props object (returning a function
 * hands the component a function as its props), and `t` comes from the
 * registration's own `locale:` — putting a `t` in the seat would override the
 * synthesized one with undefined.
 * @module dsh-local-soul-presets/src/client-seats
 */
import { PRESETS_ROUTE, REVEAL_ROUTE, ROSTER_ROUTE, decodeRoster } from './client-state.mjs'

/** Bundle id, as the profile's cordis patch row names it. */
const ID = 'dsh-local-soul-presets'

/** The profile entry whose `active` field holds the selection; see the Host `Config`. */
export const SOUL_PRESET_ENTRY = 'local-soul-presets'

/** Locale namespace owned by this bundle's dictionary. */
export const NS = 'localSoulPreset'

/** Chinese copy. This is a single-user local deployment; see the spec. */
export const ZH = {
  nav: '预设提示词',
  chipEmpty: '选预设',
  chipStale: '预设已失效',
  switchTitle: '切换预设',
  currentLabel: '预设',
  stale: '当前选择指向的预设已不存在或已损坏，请重新选择。',
  brokenPrefix: '不可用',
  newPreset: '新建',
  newPrompt: '新预设的 id（小写字母、数字、连字符）',
  remove: '删除',
  confirmRemove: '确认删除',
  cancel: '取消',
  openFolder: '打开预设目录',
  rootLabel: '预设目录',
  reload: '重新载入',
  empty: '这个目录里还没有预设。新建一个，或手动放入 .toml 文件。',
}

/**
 * Services this browser half needs before it applies.
 *
 * `remote` is required even though the subscription below reads it with optional
 * chaining: cordis's service accessor THROWS on an undeclared service, so
 * `ctx.remote?.$on?.(...)` cannot protect against a missing declaration — it
 * only protects against a missing method.
 */
export const inject = ['slots', 'configForms', 'locale', 'remote']

/**
 * Read the roster from the Host.
 * @returns the decoded roster.
 */
async function loadRoster() {
  const response = await fetch(ROSTER_ROUTE, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`roster request failed with ${String(response.status)}`)
  return decodeRoster(await response.json())
}

/**
 * One error's message.
 * @param error - the thrown value.
 * @returns the message text.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The shared roster snapshot store both surfaces read.
 *
 * Two failure kinds are kept apart because they mean different things: `error` is
 * a failed roster read (the list on screen may be stale), `actionError` is a
 * failed user action (create, delete, reveal, switch). Keeping them separate is
 * what stops a successful mutation followed by a failed read from clearing the
 * read's message and presenting stale rows as success.
 *
 * Concurrent callers share one request — all three surfaces refresh on mount —
 * but a read that began before a mutation cannot answer for it, so a mutation
 * marks the running read stale and the loop repeats exactly once.
 * @returns a snapshot store over the roster, with an action-failure seat.
 */
export function createRosterReader() {
  let state = {
    status: 'loading',
    roster: { presets: [], active: null, root: '' },
    error: null,
    actionError: null,
  }
  const listeners = new Set()
  // A subscriber that throws must not break the store: React's subscription
  // callback is a black box to us, and letting one bad listener escape would
  // skip the rest of the notification and — before the `finally` below — leave
  // the in-flight promise set forever, freezing every later read.
  const emit = () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // Isolated on purpose; see above.
      }
    }
  }
  let inFlight = null
  let repeat = false
  const set = next => { state = { ...state, ...next }; emit() }

  async function read() {
    try {
      set({ status: 'ready', roster: await loadRoster(), error: null })
    } catch (error) {
      // A failed read keeps the last rows on screen rather than blanking the
      // list, and records why.
      set({ status: 'error', error: messageOf(error) })
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /**
     * Read the roster, sharing the request with any concurrent caller.
     * @returns the settled request.
     */
    refresh() {
      if (inFlight === null) {
        inFlight = (async () => {
          try {
            do {
              repeat = false
              await read()
            } while (repeat)
          } finally {
            // The promise must always be released, even if a future change to
            // `read` throws: a stuck in-flight promise freezes the store.
            inFlight = null
          }
        })()
      }
      return inFlight
    },
    /**
     * Announce that the roster changed. A read already in flight predates the
     * change, so the running loop performs one more read; a caller arriving with
     * no read in flight simply starts a fresh one.
     */
    invalidate() {
      if (inFlight !== null) repeat = true
    },
    /** The user started an action; the previous action's message no longer applies. */
    beginAction() {
      if (state.actionError !== null) set({ actionError: null })
    },
    /**
     * Record a failed user action (create, delete, reveal, switch) so the UI can
     * show it. Actions never reject; they report here instead.
     * @param message - what went wrong.
     */
    reportFailure(message) {
      set({ actionError: message })
    },
  }
}

/**
 * Register the dictionary, resolve the entry's config form, build the shared
 * seat, and expose the surface registration the React half calls.
 * @param ctx - client root context, with `slots`, `configForms` and `locale` live.
 * @returns the seat and the registrar that pairs surfaces with components.
 */
export function createSeats(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh: ZH }), `${ID}: dictionaries`)
  const selection = ctx.configForms.get(SOUL_PRESET_ENTRY)
  const roster = createRosterReader()
  const refresh = () => roster.refresh()

  /**
   * Send one same-origin request, refusing to treat a failed status as success.
   * @param method - the HTTP method.
   * @param path - the route path.
   * @param body - the JSON body, when the method carries one.
   * @returns once the response was accepted.
   */
  const request = async (method, path, body) => {
    const response = await fetch(path, {
      method,
      ...body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    })
    if (!response.ok) {
      // A refusal without a JSON body falls back to the status text; the body is
      // read best-effort and its absence is not itself worth reporting.
      const detail = await response.json().catch(() => null)
      throw new Error(detail?.error ?? `request failed with ${String(response.status)}`)
    }
  }

  // User actions report into the shared state instead of rejecting: the UI fires
  // them without awaiting, so a rejected promise would surface as an unhandled
  // rejection and the failure would be invisible.
  const runAction = async action => {
    roster.beginAction()
    try {
      await action()
    } catch (error) {
      roster.reportFailure(messageOf(error))
    }
  }

  // A mutation must also invalidate the roster read: a read already in flight
  // began before the change, so without this the caller is handed the
  // pre-mutation snapshot and the list stays wrong.
  const runMutation = action => runAction(async () => {
    await action()
    roster.invalidate()
    await roster.refresh()
  })

  const select = id => runMutation(() => selection.set('active', id))
  const create = id => runMutation(() => request('POST', PRESETS_ROUTE, { id }))
  const remove = id => runMutation(() => request('DELETE', PRESETS_ROUTE, { id }))
  const reveal = () => runAction(() => request('POST', REVEAL_ROUTE))

  // One seat object shared by all three surfaces: the same roster reader and the
  // same config form, so a switch made from either surface moves all of them.
  const seat = { roster, selection, select, create, remove, reveal, refresh }

  ctx.effect(() => {
    const disposers = [
      ctx.remote?.$on?.('settings/document-updated', ns => {
        if (ns === SOUL_PRESET_ENTRY) void roster.refresh()
      }),
      ctx.on('connection/reset', () => { void roster.refresh() }),
    ].filter(Boolean)
    return () => { for (const dispose of disposers) dispose() }
  }, `${ID}: roster invalidations`)

  return {
    seat,
    /**
     * Register the three surfaces with their React faces.
     * @param components - one component per surface.
     */
    registerSurfaces(components) {
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left', id: 'soul-preset-chip', order: 20, locale: NS, inject: () => seat,
      }, components.chip))
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock', id: 'soul-preset-dock', order: 20, locale: NS, inject: () => seat,
      }, components.dock))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'soul-presets',
        order: 25,
        label: () => ctx.locale.bind(NS)('nav'),
        locale: NS,
        inject: () => seat,
      }, components.settings))
    },
  }
}
