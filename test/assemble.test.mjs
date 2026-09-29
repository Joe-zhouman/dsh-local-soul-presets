import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_ASSEMBLED_BYTES, assemblePrompt, withinCap } from '../src/assemble.mjs'

test('系统提示词单独存在时不出现示例段', () => {
  assert.equal(assemblePrompt({ system: 'You are a translator.', user: '', assistant: '' }), 'You are a translator.')
})

test('User 与 Assistant 都有时按约定字节拼出示例段', () => {
  const text = assemblePrompt({
    system: 'You are a translator.',
    user: 'Translate: hello world',
    assistant: '你好，世界',
  })
  assert.equal(text, [
    'You are a translator.',
    '===',
    '<example>',
    '<user>',
    'Translate: hello world',
    '</user>',
    '<assistant>',
    '你好，世界',
    '</assistant>',
    '</example>',
  ].join('\n'))
})

test('只有 User 或只有 Assistant 时整段示例不出现', () => {
  assert.equal(assemblePrompt({ system: 'S', user: 'U', assistant: '' }), 'S')
  assert.equal(assemblePrompt({ system: 'S', user: '', assistant: 'A' }), 'S')
})

test('各段两侧空白被去掉，块内换行保留', () => {
  const text = assemblePrompt({ system: '  S\n', user: '  line1\nline2  ', assistant: '  A  ' })
  assert.equal(text, 'S\n===\n<example>\n<user>\nline1\nline2\n</user>\n<assistant>\nA\n</assistant>\n</example>')
})

test('没有系统提示词时只剩示例段，不产生前导空行', () => {
  const text = assemblePrompt({ system: '', user: 'U', assistant: 'A' })
  assert.ok(text.startsWith('===\n'), text)
})

test('含 {{ 的提示词按字面保留，不被当作模板处理', () => {
  const text = assemblePrompt({ system: 'Fill {{name}} literally.', user: '', assistant: '' })
  assert.equal(text, 'Fill {{name}} literally.')
})

test('尺寸上限按 UTF-8 字节计算', () => {
  assert.equal(withinCap('a'.repeat(MAX_ASSEMBLED_BYTES)), true)
  assert.equal(withinCap('a'.repeat(MAX_ASSEMBLED_BYTES + 1)), false)
  // 中文每字 3 字节，字符数远未到上限但字节数已超
  assert.equal(withinCap('中'.repeat(Math.ceil(MAX_ASSEMBLED_BYTES / 3))), false)
})
