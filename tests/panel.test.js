import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildPanelState, deriveFixRounds, deriveTrend, panelHeadline, topErrorCodes } from '../plugin/src/panel.js'
import { createPanelHandler, PANEL_PREFIX } from '../plugin/src/panel-route.js'

test('deriveFixRounds 只把错误码的变化算成一轮', () => {
  const runs = [
    { ts: '2026-10-20T10:00:00.000Z', ledger: 'a.md', verdict: 'fail', errors: ['E006', 'E006', 'E012'] },
    { ts: '2026-10-20T10:05:00.000Z', ledger: 'a.md', verdict: 'pass', errors: [] },
    { ts: '2026-10-20T10:06:00.000Z', ledger: 'a.md', verdict: 'pass', errors: [] },
  ]
  const rounds = deriveFixRounds(runs)
  assert.equal(rounds.length, 1)
  assert.deepEqual(rounds[0].fixed.sort(), ['E006', 'E012'])
  assert.deepEqual(rounds[0].added, [])
  assert.equal(rounds[0].verdict, 'pass')
})

test('deriveFixRounds 记录新增的错误码，而不是只报好消息', () => {
  const runs = [
    { ts: '2026-10-20T10:00:00.000Z', ledger: 'a.md', verdict: 'pass', errors: [] },
    { ts: '2026-10-20T10:05:00.000Z', ledger: 'a.md', verdict: 'fail', errors: ['E017'] },
  ]
  const rounds = deriveFixRounds(runs)
  assert.equal(rounds.length, 1)
  assert.deepEqual(rounds[0].fixed, [])
  assert.deepEqual(rounds[0].added, ['E017'])
})

test('deriveFixRounds 把不同台账分开算，inline 文档有独立键', () => {
  const runs = [
    { ts: '2026-10-20T10:00:00.000Z', ledger: 'a.md', verdict: 'fail', errors: ['E006'] },
    { ts: '2026-10-20T10:01:00.000Z', ledger: 'b.md', verdict: 'fail', errors: ['E012'] },
    { ts: '2026-10-20T10:02:00.000Z', ledger: 'a.md', verdict: 'pass', errors: [] },
  ]
  const rounds = deriveFixRounds(runs)
  assert.equal(rounds.length, 1)
  assert.equal(rounds[0].ledger, 'a.md')
})

test('buildPanelState 读台账与运行记录，并按会话过滤', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fp-panel-'))
  mkdirSync(path.join(root, '.fp', 'ledgers'), { recursive: true })
  writeFileSync(path.join(root, '.fp', 'ledgers', 'x.md'), '# 台账\n\nconclusion: 先做最小闭环\n')
  const lines = [
    { ts: '2026-10-20T10:00:00.000Z', ledger: '.fp/ledgers/x.md', verdict: 'fail', errors: ['E013'], session: 's1' },
    { ts: '2026-10-20T10:05:00.000Z', ledger: '.fp/ledgers/x.md', verdict: 'pass', errors: [], session: 's1' },
    { ts: '2026-10-20T10:06:00.000Z', ledger: '.fp/ledgers/x.md', verdict: 'fail', errors: ['E012'], session: 's2' },
  ]
  writeFileSync(path.join(root, '.fp', 'runs.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  const state = buildPanelState({ root, settings: { dir: '.fp' }, gateEnabled: true, sessionId: 's1' })
  assert.equal(state.ledgers.length, 1)
  assert.equal(typeof state.ledgers[0].verdict, 'string')
  assert.equal(state.summary.total, 2)
  assert.equal(state.rounds.length, 1)
  assert.deepEqual(state.rounds[0].fixed, ['E013'])
  assert.equal(state.gate.enabled, true)
})

test('panelHeadline 中英文都给出次数与拦截数', () => {
  const state = { gate: { enabled: false }, ledgers: [1, 2], summary: { total: 7, failed: 3 } }
  assert.match(panelHeadline(state, 'zh'), /7 次校验/)
  assert.match(panelHeadline(state, 'zh'), /拦下 3/)
  assert.match(panelHeadline(state, 'en'), /7 checks/)
})

function fakeRequest(method, url, body) {
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(body, 'utf8')
    },
  }
}

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(value) {
      this.body = value
    },
  }
}

test('面板路由：GET /state 返回 JSON，POST /gate 真的切换闸门', async () => {
  let enabled = false
  const handler = createPanelHandler({
    stateFor: async () => ({ gate: { enabled }, summary: { total: 0, failed: 0 }, ledgers: [], rounds: [], recent: [], gateEvents: [] }),
    setGate: (next) => {
      enabled = next
    },
  })

  const read = fakeResponse()
  await handler(fakeRequest('GET', `${PANEL_PREFIX}/state?session=abc`), read)
  assert.equal(read.statusCode, 200)
  assert.equal(JSON.parse(read.body).gate.enabled, false)

  const write = fakeResponse()
  await handler(fakeRequest('POST', `${PANEL_PREFIX}/gate`, JSON.stringify({ enabled: true, session: 'abc' })), write)
  assert.equal(write.statusCode, 200)
  assert.equal(enabled, true)
  assert.equal(JSON.parse(write.body).state.gate.enabled, true)
})

test('面板路由：坏请求有明确状态码，不会把异常抛进宿主', async () => {
  const handler = createPanelHandler({ stateFor: async () => ({}), setGate: () => {} })
  const badBody = fakeResponse()
  await handler(fakeRequest('POST', `${PANEL_PREFIX}/gate`, '{"enabled":"yes"}'), badBody)
  assert.equal(badBody.statusCode, 400)

  const unknown = fakeResponse()
  await handler(fakeRequest('GET', `${PANEL_PREFIX}/nope`), unknown)
  assert.equal(unknown.statusCode, 404)

  const failing = createPanelHandler({
    stateFor: async () => {
      throw new Error('boom')
    },
    setGate: () => {},
  })
  const big = fakeResponse()
  await failing(fakeRequest('GET', `${PANEL_PREFIX}/state`), big)
  assert.equal(big.statusCode, 500)
  assert.match(JSON.parse(big.body).error, /boom/)
})

test('deriveTrend 按本地日期归桶：校验数、拦下数、修掉数各归各位', () => {
  const now = new Date(2026, 9, 21, 12, 0, 0)
  const runs = [
    { ts: new Date(2026, 9, 20, 9, 0, 0).toISOString(), ledger: 'a.md', verdict: 'fail', errors: ['E006'] },
    { ts: new Date(2026, 9, 20, 9, 30, 0).toISOString(), ledger: 'a.md', verdict: 'pass', errors: [] },
    { ts: new Date(2026, 9, 21, 8, 0, 0).toISOString(), ledger: 'a.md', verdict: 'fail', errors: ['E012'] },
  ]
  const trend = deriveTrend(runs, { days: 3, now })
  assert.equal(trend.length, 3)
  assert.deepEqual(trend.map((day) => day.total), [0, 2, 1])
  assert.deepEqual(trend.map((day) => day.failed), [0, 1, 1])
  assert.deepEqual(trend.map((day) => day.fixed), [0, 1, 0])
  assert.match(trend[2].date, /^2026-10-21$/)
})

test('deriveTrend 忽略窗口外的记录', () => {
  const now = new Date(2026, 9, 21, 12, 0, 0)
  const trend = deriveTrend([{ ts: new Date(2026, 8, 1, 9, 0, 0).toISOString(), verdict: 'fail', errors: ['E005'] }], { days: 7, now })
  assert.equal(trend.reduce((sum, day) => sum + day.total, 0), 0)
})

test('topErrorCodes 按出现次数排序并截断', () => {
  const runs = [
    { errors: ['E006', 'E006'] },
    { errors: ['E006', 'E012'] },
    { errors: ['E012', 'E012', 'E005'] },
    { errors: [] },
  ]
  const top = topErrorCodes(runs, 2)
  assert.deepEqual(top.map((entry) => entry.count), [3, 3])
  assert.deepEqual(top.map((entry) => entry.code).sort(), ['E006', 'E012'])
  assert.equal(topErrorCodes(runs, 1).length, 1)
  assert.deepEqual(topErrorCodes([], 6), [])
})
