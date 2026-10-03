import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EXPANSION_SOURCE_KIND,
  buildExpansionMessage,
  expandableIds,
  expansionInjections,
  renderExpansion,
} from '../src/expand.mjs'

test('手势在词首命中，按首现序去重', () => {
  assert.deepEqual(expandableIds('$translate 你好'), ['translate'])
  assert.deepEqual(expandableIds('用 $a 和 $b 再用 $a'), ['a', 'b'])
  assert.deepEqual(expandableIds(' 开头空白 $translate'), ['translate'])
  assert.deepEqual(expandableIds('$commit-message 写提交信息'), ['commit-message'])
  // 紧跟的标点不算词边界，token 保持字面——与 /技能名 手势同一规则。
  assert.deepEqual(expandableIds('$translate，帮我'), [])
})

test('大写、数学与紧贴文字的 token 不命中；纯数字 id 形状合法、命中与否交给目录', () => {
  assert.deepEqual(expandableIds('环境变量 $PATH 备用'), [])
  assert.deepEqual(expandableIds('求 $x$ 的值'), [])
  assert.deepEqual(expandableIds('成本$lower 不算'), [])
  assert.deepEqual(expandableIds('注意 $$ 或 ${x}'), [])
  // id 允许纯数字（PRESET_ID 本就如此），词法层照收；是否展开由目录里
  // 有没有叫 100 的预设决定——没有就停在字面文本。
  assert.deepEqual(expandableIds('这要 $100 块'), ['100'])
})

test('renderExpansion 的确切字节', () => {
  assert.equal(
    renderExpansion('translate', 'S\n===\n<example>\nE\n</example>'),
    '<soul-preset id="translate">\nS\n===\n<example>\nE\n</example>\n</soul-preset>',
  )
})

test('buildExpansionMessage 造出冻结的用户消息', () => {
  const message = buildExpansionMessage('t', 'S')
  assert.equal(message.role, 'user')
  assert.deepEqual(message.content, [{ type: 'text', text: '<soul-preset id="t">\nS\n</soul-preset>' }])
  assert.deepEqual(message.source, { kind: EXPANSION_SOURCE_KIND, id: 't' })
  assert.match(message.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u)
  assert.ok(Object.isFrozen(message), '消息本体要冻结')
  assert.ok(Object.isFrozen(message.content), '内容数组要冻结')
  assert.ok(Object.isFrozen(message.source), '来源要冻结')
  assert.throws(() => { message.source.kind = 'x' }, '冻结后不可写')
})

/** One user-sourced message carrying one text block. */
const user = text => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })

test('expansionInjections 只扫用户来源、跨消息去重、未知或坏的 id 跳过', () => {
  const injections = expansionInjections([
    user('$a 帮我 $b'),
    { role: 'user', content: [{ type: 'text', text: '$c 外部注入' }], source: { kind: 'skill-invocation' } },
    { role: 'assistant', content: [{ type: 'text', text: '$d 模型说的' }], source: { kind: 'model' } },
    user('再说一次 $a'),
    { role: 'user', content: [{ type: 'image', url: 'x' }], source: { kind: 'user' } },
  ], id => (id === 'a' ? 'A' : id === 'c' ? 'C' : undefined))
  assert.deepEqual(injections.map(message => message.content[0].text), [
    '<soul-preset id="a">\nA\n</soul-preset>',
  ], '只有 a 可用：b 未注册、c/d 不是用户来源')
})

test('expansionInjections 在多文本块之间也能衔接', () => {
  const injections = expansionInjections([
    { role: 'user', source: { kind: 'user' }, content: [
      { type: 'text', text: '第一行说 $a' },
      { type: 'text', text: '第二行说 $b' },
    ] },
  ], id => (id === 'a' ? 'A' : id === 'b' ? 'B' : undefined))
  assert.deepEqual(injections.map(message => message.content[0].text), [
    '<soul-preset id="a">\nA\n</soul-preset>',
    '<soul-preset id="b">\nB\n</soul-preset>',
  ])
})
