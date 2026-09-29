/**
 * The workspace prompt file as the agent's system prompt.
 *
 * Zero imports of harness packages on purpose: a plugin file under DSH_HOME
 * cannot resolve them, so this module uses only the `ctx` object it is handed
 * (node builtins are fine).
 *
 * mode 'replace' — the workspace file IS the complete system prompt, unless
 *                  `presets` is on: then the active 预设提示词 (soul preset)
 *                  comes first and the workspace file is appended after it.
 *                  Re-read at every assembly (hot reload): each request of
 *                  this mode stands alone, so nothing is cached to preserve.
 * mode 'append'  — the configured persona comes first, the workspace file
 *                  follows it. Snapshotted ONCE per agent, at its first
 *                  assembly: this mode runs long conversations, and a
 *                  mid-session system prompt change would invalidate the
 *                  provider's KV prompt cache for every following request.
 *                  Edits apply to sessions created afterwards.
 *
 * A missing, oversized, or unreadable workspace file is silent in both modes:
 * replace falls back to `defaultPrompt`, append runs on the persona alone.
 *
 * The section is registered ONCE in the composition's own scope layer with a
 * text function resolved per assembly, so every agent composed under this
 * preset — created under it or switched onto it while blank — gets the prompt
 * with no per-agent bookkeeping, and an agent that switches away simply
 * leaves this layer behind. The loop builds assembly contexts with the agent
 * set on them (`assembleContextFor` in dsh-agent sets `{ agent, scope: agent }`),
 * which the text function reads for the session's working directory; an
 * agent-less cold read (transcript inspection) runs on the fallback prompt.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'soul-prompt'
export const inject = ['systemPrompt']

// A row without a `config:` block reaches apply() with `undefined`, not `{}`.
export function apply(ctx, config = {}) {
  const mode = config.mode ?? 'replace'
  const file = config.file ?? 'SOUL.md'
  const defaultPrompt = config.defaultPrompt ?? 'You are a helpful assistant.'
  const persona = config.persona ?? ''
  const maxBytes = config.maxBytes ?? 65536
  const presets = config.presets ?? false

  const fallback = mode === 'append' ? persona : defaultPrompt

  function textFor(cwd) {
    try {
      const raw = readFileSync(join(cwd, file), 'utf8')
      if (Buffer.byteLength(raw, 'utf8') <= maxBytes && raw.trim() !== '') {
        return mode === 'append' ? `${persona}\n\n${raw.trim()}` : raw.trim()
      }
    } catch {
      // Silent by requirement: a workspace without the file runs on the
      // fallback prompt, and any read error degrades the same way.
    }
    return fallback
  }

  // Presets are offered only to rows that ask for them. The switch is explicit
  // rather than inferred from `mode`, because the same module serves the chat
  // row (mode 'append', persona + CHAT.md) and that row must not change.
  function presetText(cwd) {
    if (!presets) return undefined
    const service = ctx.get('soulPresets')
    if (service === undefined) return undefined
    const text = service.promptText(cwd)
    return text === null ? undefined : text
  }

  // agent -> that agent's session working directory.
  const cwdByAgent = new WeakMap()
  // append mode: agent -> the snapshot from its first assembly. An agent that
  // switches away and back keeps its snapshot: same conversation, same prefix.
  const snapshotByAgent = new WeakMap()

  ctx.systemPrompt.section({
    name: 'soul-prompt:complete',
    order: 0,
    complete: true,
    // Prompt text is user prose, never a template: system-prompt interpolates
    // section text by default and THROWS on an unknown {{name}}, so a prompt
    // that legitimately contains {{...}} would fail the whole turn's assembly.
    interpolate: false,
    text: assembleContext => {
      const agent = assembleContext?.agent
      if (agent === undefined) return fallback
      let cwd = cwdByAgent.get(agent)
      if (cwd === undefined) {
        cwd = agent.session?.header?.cwd ?? process.cwd()
        cwdByAgent.set(agent, cwd)
      }
      const fromPreset = presetText(cwd)
      if (fromPreset !== undefined) return fromPreset
      if (mode === 'append') {
        let snapshot = snapshotByAgent.get(agent)
        if (snapshot === undefined) {
          snapshot = textFor(cwd)
          snapshotByAgent.set(agent, snapshot)
        }
        return snapshot
      }
      return textFor(cwd)
    },
  })
  ctx.systemPrompt.suppressRuntimeContext()
}
