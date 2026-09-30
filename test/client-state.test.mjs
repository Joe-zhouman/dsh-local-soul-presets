import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FOLLOW_DEFAULT, decodeRoster, presetLabels, activeRow } from '../src/client-state.mjs'

const ROSTER = {
  presets: [
    { id: 'translate', name: '翻译助手', description: '中英互译', hint: '贴段落' },
    { id: 'review', name: '审阅助手' },
    { id: 'broken', broken: 'preset must name the preset' },
  ],
  active: 'review',
  root: 'L:\\dsh\\.dsh-home\\soul-presets',
}

test('解码合法 roster，保留坏预设的原因', () => {
  const decoded = decodeRoster(ROSTER)
  assert.deepEqual(decoded.presets.map(p => p.id), ['translate', 'review', 'broken'])
  assert.equal(decoded.presets[2].broken, 'preset must name the preset')
  assert.equal(decoded.root, ROSTER.root)
})

test('overridden 只有在响应明确为 true 时才成立', () => {
  assert.equal(decodeRoster({ ...ROSTER, overridden: true }).overridden, true)
  assert.equal(decodeRoster(ROSTER).overridden, false)
  assert.equal(decodeRoster({ ...ROSTER, overridden: 'yes' }).overridden, false)
  assert.equal(decodeRoster({}).overridden, false)
})

test('FOLLOW_DEFAULT 不是合法预设 id 的形状，永不与 roster 行冲突', () => {
  assert.match(FOLLOW_DEFAULT, /^__/, '哨兵必须长得就不像预设 id')
})

test('畸形输入解码成空 roster 而不是抛错', () => {
  assert.deepEqual(decodeRoster(undefined).presets, [])
  assert.deepEqual(decodeRoster({}).presets, [])
  assert.deepEqual(decodeRoster({ presets: 'nope' }).presets, [])
  assert.deepEqual(decodeRoster({ presets: [null, 3, { noId: true }] }).presets, [])
})

test('名字回落到 id，缺失的简介与 hint 变空串', () => {
  assert.deepEqual(presetLabels({ id: 'x' }), { name: 'x', description: '', hint: '' })
  assert.deepEqual(presetLabels({ id: 'x', name: 'X', description: 'd', hint: 'h' }), { name: 'X', description: 'd', hint: 'h' })
})

test('悬空 active 被识别为失效，界面据此提示重选', () => {
  assert.equal(activeRow(decodeRoster(ROSTER)).id, 'review')
  assert.equal(activeRow(decodeRoster({ ...ROSTER, active: 'gone' })), null)
  assert.equal(activeRow(decodeRoster({ ...ROSTER, active: null })), null)
})

test('active 指向坏预设时同样算失效', () => {
  assert.equal(activeRow(decodeRoster({ ...ROSTER, active: 'broken' })), null)
})
