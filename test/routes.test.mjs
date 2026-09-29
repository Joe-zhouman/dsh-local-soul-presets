import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createPresetStore } from '../src/presets.mjs'
import { createRoutes } from '../src/routes.mjs'

function harness({ host = '127.0.0.1:3080', origin, unlink, write } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'soul-routes-'))
  writeFileSync(join(root, 'translate.toml'), 'preset = "翻译"\n[Prompt]\nSystem = "T"\n')
  const logged = []
  const routes = createRoutes({
    root,
    store: createPresetStore(root),
    active: () => 'translate',
    reveal: async () => ({ opened: false, path: root }),
    log: message => { logged.push(message) },
    ...unlink === undefined ? {} : { unlink },
    ...write === undefined ? {} : { write },
  })
  const call = async (id, { method = 'GET', body = '' } = {}) => {
    const route = routes.find(candidate => candidate.id === id)
    const req = {
      method,
      headers: { host, ...origin === undefined ? {} : { origin } },
      async *[Symbol.asyncIterator]() { yield Buffer.from(body) },
    }
    const res = {
      statusCode: undefined,
      headers: undefined,
      body: '',
      writeHead(code, headers) { this.statusCode = code; this.headers = headers },
      end(chunk) { this.body = chunk ?? '' },
    }
    await route.handler(req, res)
    return res
  }
  return { root, routes, call, logged, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('三条路由的 (kind,path) 互不重复——重复会在 webServer 注册时抛错并杀掉 host', () => {
  const h = harness()
  const keys = h.routes.map(route => `${route.kind} ${route.path}`)
  assert.equal(new Set(keys).size, keys.length, keys.join(', '))
  assert.deepEqual(h.routes.map(route => route.kind), ['exact', 'exact', 'exact'])
  h.cleanup()
})

test('roster 返回预设、active 与目录路径', async () => {
  const h = harness()
  const res = await h.call('roster')
  assert.equal(res.statusCode, 200)
  const payload = JSON.parse(res.body)
  assert.deepEqual(payload.presets.map(p => p.id), ['translate'])
  assert.equal(payload.active, 'translate')
  assert.equal(payload.root, h.root)
  h.cleanup()
})

test('POST 按模板建文件，已存在的 id 被拒', async () => {
  const h = harness()
  const created = await h.call('presets', { method: 'POST', body: JSON.stringify({ id: 'draft' }) })
  assert.equal(created.statusCode, 201)
  assert.deepEqual(readdirSync(h.root).sort(), ['draft.toml', 'translate.toml'])
  const again = await h.call('presets', { method: 'POST', body: JSON.stringify({ id: 'draft' }) })
  assert.equal(again.statusCode, 409)
  h.cleanup()
})

test('POST 拒绝非法 id 与超长 body，且不落盘', async () => {
  const h = harness()
  const bad = await h.call('presets', { method: 'POST', body: JSON.stringify({ id: '../escape' }) })
  assert.equal(bad.statusCode, 400)
  const huge = await h.call('presets', { method: 'POST', body: JSON.stringify({ id: 'draft', pad: 'a'.repeat(9000) }) })
  assert.equal(huge.statusCode, 413)
  assert.deepEqual(readdirSync(h.root), ['translate.toml'])
  h.cleanup()
})

test('合法但非对象的 JSON body 返回 400，而不是抛错', async () => {
  const h = harness()
  for (const body of ['null', '"draft"', '42', '[{"id":"draft"}]']) {
    const res = await h.call('presets', { method: 'POST', body })
    assert.equal(res.statusCode, 400, body)
  }
  assert.deepEqual(readdirSync(h.root), ['translate.toml'])
  h.cleanup()
})

test('DELETE 删除指定预设，非法 id 被拒且不动文件', async () => {
  const h = harness()
  const gone = await h.call('presets', { method: 'DELETE', body: JSON.stringify({ id: 'translate' }) })
  assert.equal(gone.statusCode, 200)
  assert.deepEqual(readdirSync(h.root), [])
  const bad = await h.call('presets', { method: 'DELETE', body: JSON.stringify({ id: '../escape' }) })
  assert.equal(bad.statusCode, 400)
  h.cleanup()
})

test('reveal 回显路径', async () => {
  const h = harness()
  const res = await h.call('reveal', { method: 'POST', body: '{}' })
  assert.equal(res.statusCode, 200)
  assert.equal(JSON.parse(res.body).path, h.root)
  h.cleanup()
})

test('非回环 Host 一律 403，且不写盘', async () => {
  const h = harness({ host: 'evil.example:3080', origin: 'http://evil.example:3080' })
  const res = await h.call('presets', { method: 'POST', body: JSON.stringify({ id: 'draft' }) })
  assert.equal(res.statusCode, 403)
  assert.deepEqual(readdirSync(h.root), ['translate.toml'])
  h.cleanup()
})

test('回环 Host 但 Origin 指向别处也 403', async () => {
  const h = harness({ host: '127.0.0.1:3080', origin: 'http://evil.example' })
  const res = await h.call('presets', { method: 'POST', body: JSON.stringify({ id: 'draft' }) })
  assert.equal(res.statusCode, 403)
  assert.deepEqual(readdirSync(h.root), ['translate.toml'])
  h.cleanup()
})

test('方法不匹配返回 405，响应带 no-store', async () => {
  const h = harness()
  const wrong = await h.call('roster', { method: 'POST', body: '{}' })
  assert.equal(wrong.statusCode, 405)
  const ok = await h.call('roster')
  assert.match(ok.headers['cache-control'], /no-store/)
  h.cleanup()
})

test('删除一个不存在的预设返回 404，且不记日志', async () => {
  const h = harness()
  const res = await h.call('presets', { method: 'DELETE', body: JSON.stringify({ id: 'gone' }) })
  assert.equal(res.statusCode, 404)
  assert.deepEqual(h.logged, [])
  h.cleanup()
})

test('删除遇到 ENOENT 以外的文件系统错误时返回 500 并记日志', async () => {
  const failure = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
  const h = harness({ unlink: () => { throw failure } })
  const res = await h.call('presets', { method: 'DELETE', body: JSON.stringify({ id: 'translate' }) })
  assert.equal(res.statusCode, 500)
  assert.equal(h.logged.length, 1)
  assert.match(h.logged[0], /EPERM/)
  assert.equal(readdirSync(h.root).length, 1, '被拒的删除不得改动目录')
  h.cleanup()
})

test('创建遇到 EEXIST 以外的写入失败时返回 500 并记日志', async () => {
  const failure = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
  const h = harness({ write: () => { throw failure } })
  const res = await h.call('presets', { method: 'POST', body: JSON.stringify({ id: 'draft' }) })
  assert.equal(res.statusCode, 500)
  assert.equal(JSON.parse(res.body).error, 'could not create the preset')
  assert.equal(h.logged.length, 1)
  assert.match(h.logged[0], /EACCES/)
  assert.deepEqual(readdirSync(h.root), ['translate.toml'])
  h.cleanup()
})

test('创建遇到 EEXIST 时返回 409，且不记日志', async () => {
  const failure = Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' })
  const h = harness({ write: () => { throw failure } })
  const res = await h.call('presets', { method: 'POST', body: JSON.stringify({ id: 'draft' }) })
  assert.equal(res.statusCode, 409)
  assert.deepEqual(h.logged, [])
  h.cleanup()
})
