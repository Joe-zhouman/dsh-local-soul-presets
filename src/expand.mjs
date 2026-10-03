/**
 * The `$id` gesture: name a preset in any mode's composer and its text enters
 * the step as one more prompt message.
 *
 * The pattern is dsh's own `/skill-name` gesture — the sender's bubble keeps
 * the literal token, and a Host-side `agent/pre-step` listener appends the
 * rendered body as an injected user message. This module is that mechanism with
 * the `$` prefix and the preset directory as the namespace; the listener in
 * `index.mjs` sits at app level, and `agent/pre-step` is an agent-loop event,
 * so the gesture works in every agent preset (qa, chat, any later mode) without
 * per-mode wiring.
 *
 * Only messages whose source kind is `user` are scanned — injected material
 * (our own included) and external text cannot forge the gesture — and an id
 * that names no usable preset stays ordinary prose.
 * @module dsh-local-soul-presets/src/expand
 */
import { randomUUID } from 'node:crypto'

/** The message source kind an expansion carries; unknown kinds fall through by design. */
export const EXPANSION_SOURCE_KIND = 'soul-preset-expansion'

/**
 * One `$id` token at a word start, closed by whitespace or the end of the
 * text. The same shape as the harness's skill gesture, so `$100`, `$PATH`, and
 * `$x$` (the closing `$` fails the lookahead) all stay literal.
 */
const PRESET_GESTURE = /(^|\s)\$([a-z0-9][a-z0-9-]*)(?=\s|$)/g

/**
 * The preset ids one text names.
 * @param text - one message's joined text blocks.
 * @returns the ids in first-occurrence order, without duplicates.
 */
export function expandableIds(text) {
  const ids = []
  for (const match of text.matchAll(PRESET_GESTURE)) {
    const id = match[2]
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * The text blocks of one message, the only content a gesture can hide in.
 * @param message - a conversation message.
 * @returns its text blocks joined by newlines.
 */
function textOf(message) {
  return Array.isArray(message.content)
    ? message.content.filter(block => block?.type === 'text').map(block => block.text).join('\n')
    : ''
}

/**
 * Frame one preset's assembled text for injection.
 * @param id - the preset id the gesture named.
 * @param text - the preset's assembled prompt text.
 * @returns the framed text.
 */
export function renderExpansion(id, text) {
  return `<soul-preset id="${id}">\n${text}\n</soul-preset>`
}

/**
 * Build one injected user message carrying a preset's text.
 *
 * The object mirrors `createUserMessage` from `@deepseek-ai/dsh-llm` — a fresh
 * random id, a deep freeze — without importing the harness package: this plugin
 * keeps zero dsh dependencies, and the branded id type is compile-time only.
 * @param id - the preset id the gesture named.
 * @param text - the preset's assembled prompt text.
 * @returns the frozen user message.
 */
export function buildExpansionMessage(id, text) {
  const message = {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: renderExpansion(id, text) }],
    source: { kind: EXPANSION_SOURCE_KIND, id },
  }
  Object.freeze(message.content[0])
  Object.freeze(message.content)
  Object.freeze(message.source)
  return Object.freeze(message)
}

/**
 * The injections one pre-step batch earns: every `$id` in user-sourced messages
 * that names a usable preset contributes one message, in first-mention order.
 * @param messages - the claimed messages entering the step.
 * @param textById - resolves a preset id to its usable text, or undefined.
 * @returns the injected messages to append after the claimed batch.
 */
export function expansionInjections(messages, textById) {
  const ids = []
  for (const message of messages) {
    if (message?.source?.kind !== 'user') continue
    for (const id of expandableIds(textOf(message))) {
      if (!ids.includes(id)) ids.push(id)
    }
  }
  const injections = []
  for (const id of ids) {
    const text = textById(id)
    if (text !== undefined) injections.push(buildExpansionMessage(id, text))
  }
  return injections
}
