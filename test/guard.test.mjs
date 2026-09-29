import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isTrustedLocalRequest } from '../src/guard.mjs'

test('回环 Host 无 Origin 时放行', () => {
  assert.equal(isTrustedLocalRequest({ host: '127.0.0.1:3080' }), true)
  assert.equal(isTrustedLocalRequest({ host: '127.0.0.1' }), true)
  assert.equal(isTrustedLocalRequest({ host: 'localhost:3080' }), true)
  assert.equal(isTrustedLocalRequest({ host: '[::1]:3080' }), true)
  assert.equal(isTrustedLocalRequest({ host: '127.0.0.43:3080' }), true)
})

test('Origin 与 Host 一致时放行', () => {
  assert.equal(isTrustedLocalRequest({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }), true)
  assert.equal(isTrustedLocalRequest({ host: '127.0.0.1:3080', origin: 'https://127.0.0.1:3080' }), true)
})

test('Origin 与 Host 不一致时拒绝', () => {
  assert.equal(isTrustedLocalRequest({ host: '127.0.0.1:3080', origin: 'http://evil.example' }), false)
})

test('端口不同即不一致', () => {
  assert.equal(isTrustedLocalRequest({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:9999' }), false)
})

test('非回环 Host 一律拒绝——DNS rebinding 场景下 Origin 与 Host 会一致', () => {
  assert.equal(isTrustedLocalRequest({ host: 'evil.example:3080', origin: 'http://evil.example:3080' }), false)
  assert.equal(isTrustedLocalRequest({ host: '10.0.0.5:3080' }), false)
  assert.equal(isTrustedLocalRequest({ host: '10.0.0.5:3080', origin: 'http://10.0.0.5:3080' }), false)
})

test('缺失或畸形的 Host 拒绝，畸形的 Origin 拒绝', () => {
  assert.equal(isTrustedLocalRequest({}), false)
  assert.equal(isTrustedLocalRequest({ host: '' }), false)
  assert.equal(isTrustedLocalRequest({ host: '127.0.0.1:3080', origin: 'null' }), false)
  assert.equal(isTrustedLocalRequest({ host: '127.0.0.1:3080', origin: 'not a url' }), false)
})

test('点分四段的回环 Host 必须每段在 0–255 内', () => {
  assert.equal(isTrustedLocalRequest({ host: '127.255.255.255:3080' }), true)
  assert.equal(isTrustedLocalRequest({ host: '127.0.0.1:3080' }), true)
  assert.equal(isTrustedLocalRequest({ host: '127.999.999.999:3080' }), false)
  assert.equal(isTrustedLocalRequest({ host: '127.0.0.256' }), false)
})
