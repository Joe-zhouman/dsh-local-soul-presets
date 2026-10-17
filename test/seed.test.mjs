import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fakeCtx } from './support/fake-host-ctx.mjs'
import { bundledPresetsDir, seedPresets } from '../src/seed.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** A temp directory, removed after the body settles. */
async function withDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'soul-seed-'))
  try {
    return await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('随包目录存在且只含 .toml：35 个示例预设，不含人设类', () => {
  const bundle = bundledPresetsDir()
  assert.equal(existsSync(bundle), true, '包须带 presets/ 数据目录（src 与 lib 都在其上一级）')
  const files = readdirSync(bundle)
  assert.equal(files.length, 35)
  assert.ok(files.every(name => name.endsWith('.toml')), '数据目录只收 .toml')
  assert.equal(files.includes('arvis-style.toml'), false, '人设类私人预设不随包')
})

test('空目录种入全部随包预设；已有 .toml 则一个都不写', async () => {
  await withDir(async dir => {
    const empty = join(dir, 'empty')
    mkdirSync(empty)
    assert.equal(seedPresets({ root: empty }), 35)
    assert.deepEqual(readdirSync(empty).length, 35)
  })
  await withDir(async dir => {
    const present = join(dir, 'present')
    mkdirSync(present)
    writeFileSync(join(present, 'mine.toml'), 'preset = "x"\n')
    assert.equal(seedPresets({ root: present }), 0, '已有 .toml 视为已初始化')
    assert.deepEqual(readdirSync(present), ['mine.toml'])
  })
})

test('根目录缺失与随包目录缺失都静默返回 0', async () => {
  await withDir(async dir => {
    assert.equal(seedPresets({ root: join(dir, 'no-such-root') }), 0)
    assert.equal(seedPresets({ root: join(dir, 'other'), bundle: join(dir, 'no-such-bundle') }), 0)
  })
})

test('单个文件拷贝失败被记日志，其余照种', async () => {
  await withDir(async dir => {
    const bundle = join(dir, 'bundle')
    mkdirSync(bundle)
    writeFileSync(join(bundle, 'a.toml'), 'preset = "a"\n')
    writeFileSync(join(bundle, 'b.toml'), 'preset = "b"\n')
    writeFileSync(join(bundle, 'notes.txt'), 'not a preset')
    const target = join(dir, 'root')
    mkdirSync(target)
    const logs = []
    const seeded = seedPresets({
      root: target,
      bundle,
      copy: (from, to) => {
        if (from.endsWith('a.toml')) throw new Error('disk full')
        copyFileSync(from, to)
      },
      log: message => { logs.push(message) },
    })
    assert.equal(seeded, 1)
    assert.deepEqual(readdirSync(target), ['b.toml'], '.txt 不种、失败的 a 不在')
    assert.ok(logs.some(message => message.includes('a.toml')), '失败要留日志')
  })
})

test('构建产物从 lib/../presets 解析：空目录的部署一启动就有示例预设', async () => {
  const build = spawnSync(process.execPath, [
    '../../node_modules/tsdown/dist/run.mjs',
    '--config', 'tsdown.config.mjs',
    '--config-loader', 'native',
  ], { cwd: root, encoding: 'utf8' })
  assert.equal(build.status, 0, `build exited ${String(build.status)}\n${build.stdout ?? ''}${build.stderr ?? ''}`)
  const host = await import(pathToFileURL(join(root, 'lib/index.js')).href)
  await withDir(async home => {
    mkdirSync(join(home, 'soul-presets'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const h = fakeCtx()
      host.apply(h.ctx, h.config)
      const roster = h.ctx.get('soulPresets').roster()
      assert.equal(roster.presets.length, 35, '种入后 roster 即 35 行')
      assert.ok(roster.presets.every(row => row.broken === undefined), '随包预设须全部可解析')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
