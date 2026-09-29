import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PRESET_ID, parsePreset } from '../src/presets.mjs'

const VALID = `
preset = "翻译助手"
description = "中英互译，保留术语与格式"
hint = "把要翻译的段落贴进来"

[Prompt]
System = '''
You are a translation engine.
'''
User = '''
Translate: hello world
'''
Assistant = '''
你好，世界
'''
`

test('合法文件解析出名字、简介、hint 与拼装后的文本', () => {
  const preset = parsePreset('translate', VALID)
  assert.equal(preset.id, 'translate')
  assert.equal(preset.name, '翻译助手')
  assert.equal(preset.description, '中英互译，保留术语与格式')
  assert.equal(preset.hint, '把要翻译的段落贴进来')
  assert.equal(preset.broken, undefined)
  assert.ok(preset.text.startsWith('You are a translation engine.'))
  assert.ok(preset.text.includes('\n===\n<example>\n<user>\nTranslate: hello world\n</user>'))
})

test('缺少 preset 字段即坏预设，且给出原因', () => {
  const preset = parsePreset('nameless', '[Prompt]\nSystem = "S"\n')
  assert.equal(preset.id, 'nameless')
  assert.match(preset.broken, /preset/)
  assert.equal(preset.text, undefined)
})

test('Prompt 三个块全空即坏预设', () => {
  const preset = parsePreset('empty', 'preset = "空"\n[Prompt]\n')
  assert.match(preset.broken, /Prompt/)
})

test('TOML 语法错误即坏预设，不抛出到调用方', () => {
  const preset = parsePreset('broken', 'preset = "坏"\n[Prompt]\nSystem = \n')
  assert.match(preset.broken, /.+/)
})

test('字段类型不对即坏预设', () => {
  const preset = parsePreset('typed', 'preset = "x"\nhint = 3\n[Prompt]\nSystem = "S"\n')
  assert.match(preset.broken, /hint/)
})

test('尺寸超限即坏预设', () => {
  const huge = `preset = "大"\n[Prompt]\nSystem = "${'a'.repeat(70000)}"\n`
  const preset = parsePreset('huge', huge)
  assert.match(preset.broken, /65536|上限|ceiling/i)
})

test('预设 id 必须匹配目录安全形态', () => {
  assert.equal(PRESET_ID.test('translate'), true)
  assert.equal(PRESET_ID.test('my-preset-2'), true)
  assert.equal(PRESET_ID.test('Bad'), false)
  assert.equal(PRESET_ID.test('../escape'), false)
  assert.equal(PRESET_ID.test('a_b'), false)
})
