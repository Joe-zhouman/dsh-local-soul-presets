import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply, resolvePresetRoot } from '../index.mjs'
import { fakeCtx, withPresetRoot } from './support/fake-host-ctx.mjs'

/** A workspace carrying no SOUL.md, so preset text is the only variable. */
const noWorkspace = () => join(tmpdir(), 'no-such-workspace')

test('目录根解析到 $DSH_HOME/soul-presets', () => {
  assert.equal(resolvePresetRoot({ DSH_HOME: 'C:\\home' }, 'C:\\users\\x'), join('C:\\home', 'soul-presets'))
  assert.equal(resolvePresetRoot({}, 'C:\\users\\x'), join('C:\\users\\x', '.dsh', 'soul-presets'))
})

test('apply 提供预设服务与四条不重复的路由', () => {
  withPresetRoot(() => {
    const { ctx, config, routes } = fakeCtx()
    apply(ctx, config)
    assert.equal(typeof config.active.get(), 'string')
    assert.deepEqual(routes.map(r => r.path), [
      '/plugins/soul-preset/roster',
      '/plugins/soul-preset/select',
      '/plugins/soul-preset/presets',
      '/plugins/soul-preset/reveal',
    ])
  })
})

test('服务暴露 roster 与 promptText，未选中时返回 null', () => {
  withPresetRoot(() => {
    const { ctx, config } = fakeCtx()
    apply(ctx, config)
    const service = ctx.get('soulPresets')
    assert.deepEqual(service.roster().presets.map(p => p.id), ['translate'])
    assert.equal(service.roster().overridden, false)
    assert.equal(service.promptText(noWorkspace()), null)
    assert.equal(service.promptText(noWorkspace(), 'session-none'), null)
  })
})

test('配置写入后，服务按新默认返回文本', () => {
  withPresetRoot(() => {
    const { ctx, config } = fakeCtx()
    apply(ctx, config)
    const service = ctx.get('soulPresets')
    assert.equal(service.promptText(noWorkspace()), null)
    ctx.__set({ active: 'translate' })
    assert.equal(service.promptText(noWorkspace()), 'T')
    ctx.__set({ active: '' })
    assert.equal(service.promptText(noWorkspace()), null)
  })
})

test('解析链：会话覆盖 > 全局默认 > 无——改默认不动已覆盖的会话', () => {
  withPresetRoot(() => {
    writeFileSync(join(process.env.DSH_HOME, 'soul-presets', '.selections.json'), '{"session-a":"translate"}')
    const { ctx, config } = fakeCtx()
    apply(ctx, config)
    const service = ctx.get('soulPresets')
    // 覆盖在、默认为空：覆盖会话拿到文本，其他会话没有。
    assert.equal(service.promptText(noWorkspace(), 'session-a'), 'T')
    assert.equal(service.promptText(noWorkspace(), 'session-b'), null)
    ctx.__set({ active: 'translate' })
    // 默认出现后未覆盖会话跟上，覆盖会话不受影响（同值）；默认换走也不动覆盖。
    assert.equal(service.promptText(noWorkspace(), 'session-b'), 'T')
    ctx.__set({ active: '' })
    assert.equal(service.promptText(noWorkspace(), 'session-a'), 'T', '覆盖不受全局默认变化影响')
    assert.equal(service.promptText(noWorkspace(), 'session-b'), null)
  })
})

test('指向已消失预设的覆盖在 roster 读取时被剪掉并回落默认', () => {
  withPresetRoot(() => {
    const root = join(process.env.DSH_HOME, 'soul-presets')
    writeFileSync(join(root, '.selections.json'), '{"session-a":"gone-preset","session-b":"translate"}')
    const { ctx, config } = fakeCtx()
    apply(ctx, config)
    const service = ctx.get('soulPresets')
    ctx.__set({ active: 'translate' })
    assert.equal(service.promptText(noWorkspace(), 'session-a'), 'T', '死覆盖回落到默认而不是无选择')
    assert.equal(service.roster('session-a').overridden, false)
    assert.equal(service.roster('session-b').overridden, true)
    const persisted = JSON.parse(readFileSync(join(root, '.selections.json'), 'utf8'))
    assert.equal(persisted['session-a'], undefined, '死条目已从持久化文件剪掉')
    assert.equal(persisted['session-b'], 'translate')
  })
})

test('roster(session) 回显生效选择与覆盖标记，roster() 是默认视图', () => {
  withPresetRoot(() => {
    writeFileSync(join(process.env.DSH_HOME, 'soul-presets', '.selections.json'), '{"session-a":"translate"}')
    const { ctx, config } = fakeCtx()
    apply(ctx, config)
    const service = ctx.get('soulPresets')
    const forSession = service.roster('session-a')
    assert.equal(forSession.active, 'translate')
    assert.equal(forSession.overridden, true)
    const defaults = service.roster()
    assert.equal(defaults.overridden, false)
  })
})
