import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply, resolvePresetRoot } from '../index.mjs'
import { fakeCtx, withPresetRoot } from './support/fake-host-ctx.mjs'

test('目录根解析到 $DSH_HOME/soul-presets', () => {
  assert.equal(resolvePresetRoot({ DSH_HOME: 'C:\\home' }, 'C:\\users\\x'), join('C:\\home', 'soul-presets'))
  assert.equal(resolvePresetRoot({}, 'C:\\users\\x'), join('C:\\users\\x', '.dsh', 'soul-presets'))
})

test('apply 提供预设服务与三条不重复的路由', () => {
  withPresetRoot(() => {
    const { ctx, config, routes } = fakeCtx()
    apply(ctx, config)
    assert.equal(typeof config.active.get(), 'string')
    assert.deepEqual(routes.map(r => r.path), [
      '/plugins/soul-preset/roster',
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
    assert.equal(service.promptText(join(tmpdir(), 'no-such-workspace')), null)
  })
})

test('配置写入后，服务按新选择返回文本', () => {
  withPresetRoot(() => {
    const { ctx, config } = fakeCtx()
    apply(ctx, config)
    const service = ctx.get('soulPresets')
    assert.equal(service.promptText(join(tmpdir(), 'no-such-workspace')), null)
    ctx.__set({ active: 'translate' })
    assert.equal(service.promptText(join(tmpdir(), 'no-such-workspace')), 'T')
    ctx.__set({ active: '' })
    assert.equal(service.promptText(join(tmpdir(), 'no-such-workspace')), null)
  })
})
