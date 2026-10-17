import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createModelApplier, isFreshSession, modelLabel } from '../src/models.mjs'

/** A session double carrying only what the applier reads. */
function session(selection = { lastUsed: null, pending: null }, header = undefined) {
  return { requestHeader: () => header, selection }
}

/**
 * Build an applier over recording doubles.
 * @param options - the live selection state, whether a controller entry point
 * exists, and the LLM resolution.
 * @returns the applier plus its recordings.
 */
function applier({ state = { lastUsed: null, pending: null }, withController = true, resolve } = {}) {
  const installed = []
  const warnings = []
  const agent = { session: session(state) }
  const model = createModelApplier({
    agents: { get: id => (id === 'session-a' ? agent : undefined) },
    controller: withController
      ? { agents: { selectForNextRequest: (target, selection) => installed.push({ target, selection }) } }
      : {},
    llm: { resolveCallConfig: resolve ?? (async config => config) },
    projections: { stateOf: () => state },
    log: message => { warnings.push(message) },
  })
  return { model, installed, warnings, agent }
}

const SPEC = { provider: 'paratera', model: 'Luna' }

test('modelLabel 拼出 provider/model 与可选 effort', () => {
  assert.equal(modelLabel(SPEC), 'paratera/Luna')
  assert.equal(modelLabel({ ...SPEC, reasoningEffort: 'high' }), 'paratera/Luna (high)')
})

test('只有既无请求头也无模型选择的会话算新会话', () => {
  const projections = { stateOf: () => ({ lastUsed: null, pending: null }) }
  assert.equal(isFreshSession(projections, session()), true)
  assert.equal(isFreshSession(projections, session(undefined, { config: {} })), false)
  assert.equal(isFreshSession({ stateOf: () => ({ lastUsed: { provider: 'p', model: 'm' }, pending: null }) }, session()), false)
  assert.equal(isFreshSession({ stateOf: () => ({ lastUsed: null, pending: { provider: 'p', model: 'm' } }) }, session()), false)
  assert.equal(isFreshSession({ stateOf: () => undefined }, session()), false, '投影缺席时不当作新会话')
})

test('新会话强制施加，即便 route 与当前相同也要记录成本会话的选择', async () => {
  const state = { lastUsed: null, pending: { provider: 'paratera', model: 'Luna' } }
  const { model, installed } = applier({ state })
  const outcome = await model.apply('session-a', SPEC, { force: true })
  assert.equal(outcome.status, 'applied')
  assert.deepEqual(installed.map(call => call.selection), [{ provider: 'paratera', model: 'Luna' }])
})

test('切换时同 route 视为已生效，不追加事件', async () => {
  const state = { lastUsed: null, pending: { provider: 'paratera', model: 'Luna' } }
  const { model, installed } = applier({ state })
  const outcome = await model.apply('session-a', SPEC)
  assert.equal(outcome.status, 'unchanged')
  assert.deepEqual(outcome.selection, { provider: 'paratera', model: 'Luna' })
  assert.deepEqual(installed, [])
})

test('预设指定 effort 时，当前 route 的 effort 不同仍算变化', async () => {
  const state = { lastUsed: { provider: 'paratera', model: 'Luna', reasoningEffort: 'low' }, pending: null }
  const { model, installed } = applier({ state })
  const outcome = await model.apply('session-a', { ...SPEC, reasoningEffort: 'high' })
  assert.equal(outcome.status, 'applied')
  assert.deepEqual(installed[0].selection, { provider: 'paratera', model: 'Luna', reasoningEffort: 'high' })
})

test('非普通会话、无活会话、控制器缺入口三条降级路径', async () => {
  const { model, installed, warnings } = applier()
  assert.equal((await model.apply('3f7c2a1e-8b4d-4c6e-9a10-2b3c4d5e6f70', SPEC)).status, 'not-an-ordinary-session')
  assert.equal((await model.apply('session-other', SPEC)).status, 'session-not-live')
  const missing = applier({ withController: false })
  assert.equal((await missing.model.apply('session-a', SPEC)).status, 'controller-unavailable')
  assert.deepEqual(missing.installed, [])
  assert.match(missing.warnings[0], /inert/u)
  assert.deepEqual(installed, [])
  assert.deepEqual(warnings, [])
})

test('注册表拒绝 route 时把错误抛给调用方，由调用点决定降级', async () => {
  const { model } = applier({ resolve: async () => { throw new Error('no model "gone"') } })
  await assert.rejects(model.apply('session-a', { provider: 'p', model: 'gone' }), /no model "gone"/u)
})
