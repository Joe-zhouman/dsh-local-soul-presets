import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SOUL_PRESET_ENTRY, SoulPresetSettings } from '../src/settings.mjs'
import { presetTemplate } from '../src/template.mjs'
import { parsePreset } from '../src/presets.mjs'

/** Resolve one section the way Loader does. */
const resolveSettings = value => SoulPresetSettings(value)

/** Replace the volatile reference with the plain value it holds. */
const plainActive = value => resolveSettings(value).active.get()

test('配置所在的 profile entry 名固定', () => {
  assert.equal(SOUL_PRESET_ENTRY, 'local-soul-presets')
})

test('active 是 volatile 字段，设置表单才投影得到它', () => {
  assert.equal(SoulPresetSettings.dict.active.meta.volatile, true)
})

test('空对象经 schema 解析出默认的 active 空串', () => {
  assert.equal(plainActive({}), '')
  assert.equal(plainActive({ active: 'translate' }), 'translate')
})

test('空串与合法 id 通过解析，非法 id 被 schema 拒绝', () => {
  assert.equal(plainActive({ active: '' }), '')
  assert.equal(plainActive({ active: 'translate' }), 'translate')
  assert.throws(() => { resolveSettings({ active: '../escape' }) })
  assert.throws(() => { resolveSettings({ active: 'Bad' }) })
  assert.throws(() => { resolveSettings({ active: 'has space' }) })
})

test('模板能被解析成合法预设', () => {
  const preset = parsePreset('draft', presetTemplate('draft'))
  assert.equal(preset.broken, undefined)
  assert.equal(preset.name, 'draft')
  assert.ok(preset.text.length > 0)
})
