import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createPresetStore } from '../src/presets.mjs'
import { createRoutes } from '../src/routes.mjs'

function harness({ host = '127.0.0.1:3080', origin, unlink, write, presetToml, applyModel } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'soul-routes-'))
  writeFileSync(join(root, 'translate.toml'), presetToml ?? 'preset = "翻译"\n[Prompt]\nSystem = "T"\n')
  const logged = []
  const applied = []
  const store = createPresetStore(root)
  // The per-session override map the select route writes and the roster echoes.
  const overrides = new Map()
  const selection = {
    get: sessionId => overrides.get(sessionId),
    has: sessionId => overrides.has(sessionId),
    set: (sessionId, preset) => {
      if (preset === null) overrides.delete(sessionId)
      else overrides.set(sessionId, preset)
      return true
    },
  }
  const active = () => 'translate'
  const effective = sessionId => {
    const override = selection.get(sessionId)
    return override !== undefined && store.has(override) ? override : active()
  }
  const routes = createRoutes({
    root,
    store,
    active,
    selection,
    effective,
    applyModel: applyModel ?? (async (sessionId, spec) => {
      applied.push({ sessionId, spec })
      return { status: 'applied', selection: { provider: spec.provider, model: spec.model } }
    }),
    reveal: async () => ({ opened: false, path: root }),
    log: message => { logged.push(message) },
    ...unlink === undefined ? {} : { unlink },
    ...write === undefined ? {} : { write },
  })
  const call = async (id, { method = 'GET', body = '', url } = {}) => {
    const route = routes.find(candidate => candidate.id === id)
    const req = {
      method,
      url: url ?? route.path,
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
  return { root, routes, call, logged, overrides, applied, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('四条路由的 (kind,path) 互不重复——重复会在 webServer 注册时抛错并杀掉 host', () => {
  const h = harness()
  const keys = h.routes.map(route => `${route.kind} ${route.path}`)
  assert.equal(new Set(keys).size, keys.length, keys.join(', '))
  assert.deepEqual(h.routes.map(route => route.kind), ['exact', 'exact', 'exact', 'exact'])
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
  assert.equal(payload.overridden, false, '无 session 参数就是默认视图')
  h.cleanup()
})

test('roster 带 ?session= 回显该会话的生效预设与覆盖标记', async () => {
  const h = harness()
  h.overrides.set('session-a', 'translate')
  const res = await h.call('roster', { url: '/plugins/soul-preset/roster?session=session-a' })
  const payload = JSON.parse(res.body)
  assert.equal(payload.active, 'translate')
  assert.equal(payload.overridden, true)
  const plain = await h.call('roster', { url: '/plugins/soul-preset/roster?session=session-b' })
  assert.equal(JSON.parse(plain.body).overridden, false)
  h.cleanup()
})

test('roster 的 session 参数非法时按默认视图回答，而不是报错', async () => {
  const h = harness()
  for (const bad of ['not-a-session', '../escape', 'sess_../../x']) {
    const res = await h.call('roster', { url: `/plugins/soul-preset/roster?session=${encodeURIComponent(bad)}` })
    assert.equal(res.statusCode, 200, bad)
    assert.equal(JSON.parse(res.body).overridden, false, bad)
  }
  h.cleanup()
})

test('select 写入会话覆盖并回显生效值，重置后回落默认', async () => {
  const h = harness()
  const set = await h.call('select', { method: 'POST', body: JSON.stringify({ session: 'session-a', id: 'translate' }) })
  assert.equal(set.statusCode, 200)
  assert.deepEqual(JSON.parse(set.body), { active: 'translate', overridden: true })
  assert.equal(h.overrides.has('session-a'), true)
  const reset = await h.call('select', { method: 'POST', body: JSON.stringify({ session: 'session-a' }) })
  assert.equal(reset.statusCode, 200)
  assert.equal(JSON.parse(reset.body).overridden, false)
  assert.equal(h.overrides.has('session-a'), false)
  h.cleanup()
})

test('select 在预设带 [Model] 时把模型装到该会话，重置（跟随默认）也装默认预设的模型', async () => {
  const h = harness({ presetToml: 'preset = "翻译"\n[Model]\nprovider = "p"\nmodel = "m"\n[Prompt]\nSystem = "T"\n' })
  const set = await h.call('select', { method: 'POST', body: JSON.stringify({ session: 'session-a', id: 'translate' }) })
  assert.equal(set.statusCode, 200)
  assert.deepEqual(JSON.parse(set.body), {
    active: 'translate',
    overridden: true,
    model: { provider: 'p', model: 'm' },
  })
  assert.deepEqual(h.applied, [{ sessionId: 'session-a', spec: { provider: 'p', model: 'm' } }])
  const reset = await h.call('select', { method: 'POST', body: JSON.stringify({ session: 'session-a' }) })
  assert.equal(JSON.parse(reset.body).model.provider, 'p', '跟随默认也是切到默认预设，装它的模型')
  assert.equal(h.applied.length, 2)
  h.cleanup()
})

test('模型不可路由时预设切换仍然成功，原因放在响应里并记日志', async () => {
  const h = harness({
    presetToml: 'preset = "翻译"\n[Model]\nprovider = "p"\nmodel = "gone"\n[Prompt]\nSystem = "T"\n',
    applyModel: async () => { throw new Error('provider "p" has no model "gone"') },
  })
  const res = await h.call('select', { method: 'POST', body: JSON.stringify({ session: 'session-a', id: 'translate' }) })
  assert.equal(res.statusCode, 200, '提示词已经切过去了，不能把整次切换报成失败')
  const payload = JSON.parse(res.body)
  assert.equal(payload.active, 'translate')
  assert.equal(payload.overridden, true)
  assert.match(payload.modelError, /no model "gone"/u)
  assert.equal(payload.model, undefined)
  assert.equal(h.logged.length, 1)
  assert.match(h.logged[0], /p\/gone.*unusable/u)
  h.cleanup()
})

test('select 拒绝坏 session、坏 id、非对象 JSON 与超长 body，且不写覆盖', async () => {
  const h = harness()
  for (const body of [
    JSON.stringify({ session: 'not-a-session', id: 'translate' }),
    JSON.stringify({ session: 'session-a', id: '../escape' }),
    JSON.stringify({ session: 'session-a', id: 42 }),
    'null', '"text"', '42',
  ]) {
    const res = await h.call('select', { method: 'POST', body })
    assert.equal(res.statusCode, 400, body)
  }
  const huge = await h.call('select', { method: 'POST', body: JSON.stringify({ session: 'session-a', id: 'translate', pad: 'a'.repeat(9000) }) })
  assert.equal(huge.statusCode, 413)
  assert.equal(h.overrides.size, 0)
  h.cleanup()
})

test('select 非 POST 返回 405，非回环 Host 一律 403', async () => {
  const h = harness()
  const wrong = await h.call('select', { method: 'GET' })
  assert.equal(wrong.statusCode, 405)
  h.cleanup()
  const evil = harness({ host: 'evil.example:3080', origin: 'http://evil.example:3080' })
  const refused = await evil.call('select', { method: 'POST', body: JSON.stringify({ session: 'session-a', id: 'translate' }) })
  assert.equal(refused.statusCode, 403)
  assert.equal(evil.overrides.size, 0)
  evil.cleanup()
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
