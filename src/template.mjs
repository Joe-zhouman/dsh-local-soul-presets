/**
 * The template a new preset is created from. Its prompt bodies use TOML's
 * multi-line literal form, so whatever is written inside — quotes, braces,
 * JSON, `{{` — needs no escaping and cannot collide with the file's syntax.
 * @module dsh-local-soul-presets/src/template
 */

/**
 * Render the starting text for a new preset.
 * @param id - the preset id, used as the starting display name.
 * @returns TOML text that parses and validates.
 */
export function presetTemplate(id) {
  return `preset = ${JSON.stringify(id)}
description = "一句话说明这套预设是做什么的"
hint = "给用户的提示：这套预设该问什么"

[Prompt]
System = '''
你是……
'''
User = '''
示例提问（与下面一段必须同时填写，示例块才会生效）
'''
Assistant = '''
示例回答
'''
`
}
