import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createPresetStore } from '../src/presets.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'soul-presets-'))
  writeFileSync(join(root, 'translate.toml'), 'preset = "翻译"\n[Prompt]\nSystem = "T"\n')
  writeFileSync(join(root, 'review.toml'), 'preset = "审阅"\ndescription = "读代码"\nhint = "贴代码"\n[Prompt]\nSystem = "R"\n')
  writeFileSync(join(root, 'broken.toml'), 'preset = \n')
  return root
}

test('列出目录里的预设，坏预设带原因留在列表里', () => {
  const root = fixture()
  const store = createPresetStore(root)
  const { presets } = store.roster('translate')
  assert.deepEqual(presets.map(p => p.id), ['broken', 'review', 'translate'])
  assert.equal(presets.find(p => p.id === 'broken').broken.length > 0, true)
  assert.equal(presets.find(p => p.id === 'review').description, '读代码')
  rmSync(root, { recursive: true, force: true })
})

test('忽略非 .toml、非法 id 与子目录', () => {
  const root = fixture()
  writeFileSync(join(root, 'notes.md'), 'preset = "x"\n')
  writeFileSync(join(root, 'Bad.toml'), 'preset = "x"\n[Prompt]\nSystem = "S"\n')
  mkdirSync(join(root, 'sub.toml'))
  const { presets } = createPresetStore(root).roster(null)
  assert.deepEqual(presets.map(p => p.id), ['broken', 'review', 'translate'])
  rmSync(root, { recursive: true, force: true })
})

test('缺目录时按空列表处理，不抛错', () => {
  const { presets, active } = createPresetStore(join(tmpdir(), 'definitely-absent-soul-presets')).roster('translate')
  assert.deepEqual(presets, [])
  assert.equal(active, 'translate')
})

test('原地修改文件内容后，下一次读取看得见新内容', () => {
  const root = fixture()
  const store = createPresetStore(root)
  assert.equal(store.text('/tmp/none', 'translate'), 'T')
  const path = join(root, 'translate.toml')
  writeFileSync(path, 'preset = "翻译"\n[Prompt]\nSystem = "T2"\n')
  // 把 mtime 推到未来，排除同一时间片内的假阴性
  const future = new Date(Date.now() + 5000)
  utimesSync(path, future, future)
  assert.equal(store.text('/tmp/none', 'translate'), 'T2')
  rmSync(root, { recursive: true, force: true })
})

test('悬空 active 返回 null，坏预设也不注入', () => {
  const root = fixture()
  const store = createPresetStore(root)
  assert.equal(store.text('/tmp/none', 'gone'), null)
  assert.equal(store.text('/tmp/none', 'broken'), null)
  assert.equal(store.text('/tmp/none', null), null)
  rmSync(root, { recursive: true, force: true })
})

test('工作区 SOUL.md 追加在预设之后，空或缺或超限则跳过', () => {
  const root = fixture()
  const ws = mkdtempSync(join(tmpdir(), 'soul-ws-'))
  const store = createPresetStore(root)
  assert.equal(store.text(ws, 'translate'), 'T')
  writeFileSync(join(ws, 'SOUL.md'), '  Answer in Chinese.\n')
  assert.equal(store.text(ws, 'translate'), 'T\n\nAnswer in Chinese.')
  writeFileSync(join(ws, 'SOUL.md'), '   \n')
  assert.equal(store.text(ws, 'translate'), 'T')
  writeFileSync(join(ws, 'SOUL.md'), 'a'.repeat(70000))
  assert.equal(store.text(ws, 'translate'), 'T')
  rmSync(root, { recursive: true, force: true })
  rmSync(ws, { recursive: true, force: true })
})

test('没有可用预设时，SOUL.md 仍然单独生效', () => {
  const root = fixture()
  const ws = mkdtempSync(join(tmpdir(), 'soul-ws-'))
  writeFileSync(join(ws, 'SOUL.md'), 'ONLY SOUL')
  assert.equal(createPresetStore(root).text(ws, null), 'ONLY SOUL')
  rmSync(root, { recursive: true, force: true })
  rmSync(ws, { recursive: true, force: true })
})
