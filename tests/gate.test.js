import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { apply } from '../plugin/index.js'
import { classifyExecution, summarizeGate, renderGateStatus } from '../plugin/src/gate.js'

function fakeCtx() {
  const disposers = []
  const handlers = []
  const commands = []
  const ctx = {
    effect(fn) {
      const disposer = fn()
      assert.equal(typeof disposer, 'function', 'effect 必须返回 disposer')
      disposers.push(disposer)
    },
    on(event, handler) {
      handlers.push({ event, handler })
      return () => {}
    },
    get(key) {
      if (key === 'commands') {
        return {
          register(definition) {
            commands.push(definition)
            return () => {}
          },
        }
      }
      return null
    },
    systemPrompt: { section: () => () => {} },
    tools: { register: () => () => {} },
  }
  return { ctx, disposers, handlers, commands }
}

function projectDir(pkgName = 'gate-fixture') {
  const dir = mkdtempSync(path.join(tmpdir(), 'fp-gate-'))
  writeFileSync(path.join(dir, 'package.json'), `{\n  "name": "${pkgName}",\n  "version": "1.0.0"\n}\n`)
  return dir
}

function writeLedger(dir, text = null) {
  const ledgerDir = path.join(dir, '.fp', 'ledgers')
  mkdirSync(ledgerDir, { recursive: true })
  const body =
    text ??
    [
      '# 台账 · gate',
      '',
      'question: 闸门该不该拦这一步？',
      'mode: decision',
      'scope: package.json',
      '',
      '## Facts',
      '',
      '- F1 · package.json:2 · `"name": "gate-fixture",`',
      '',
      '## Assumptions',
      '',
      '- A1 · basis: inference · falsify: 若发现 package.json 被别处引用则不成立',
      '  清单里的名字就是项目标识',
      '',
      '## Open',
      '',
      '- O1 · probe: 是否需要别的字段 · deferred(暂时不需要)',
      '',
      '## Derivation',
      '',
      '- D1 · from F1,A1',
      '  名字字段足以标识这个项目',
      '',
      '## Conclusion',
      '',
      '- C1 · depends: D1',
      '  可以直接用名字定位项目',
      '',
      '## Revisit',
      '',
      '- R1 · A1',
      '  一旦名字被复用，C1 需要重估',
      '',
    ].join('\n')
  writeFileSync(path.join(ledgerDir, 'gate.md'), body, 'utf8')
}

const exec = (name, args) => ({ name, arguments: args, callId: 'c1' })
const next = async () => ({ kind: 'allow', via: 'next' })

test('classifyExecution：只认不可逆', () => {
  assert.equal(classifyExecution(exec('bash', { command: 'rm -rf build' }))?.rule, 'rm')
  assert.equal(classifyExecution(exec('bash', { command: 'git push --force origin main' }))?.rule, 'git-push-force')
  assert.equal(classifyExecution(exec('bash', { command: 'npm publish' }))?.rule, 'publish')
  assert.equal(classifyExecution(exec('bash', { command: 'ls -la && cat a.txt' })), null)
  assert.equal(classifyExecution(exec('read', { path: 'a.txt' })), null)
  assert.equal(classifyExecution(exec('delete_file', { path: 'a.txt' }))?.rule, 'tool:delete_file')
  assert.equal(classifyExecution(exec('ssh_exec', { command: 'kubectl delete pod x' }))?.rule, 'cluster-delete')
})

test('闸门关着时零打扰，也不写日志', async () => {
  const dir = projectDir()
  const { ctx, handlers } = fakeCtx()
  apply(ctx, {})
  assert.equal(handlers.length, 1)
  assert.equal(handlers[0].event, 'tools/pre-execute')
  const decision = await handlers[0].handler(exec('bash', { command: 'rm -rf build' }), next)
  assert.equal(decision.via, 'next')
  assert.equal(existsSync(path.join(dir, '.fp', 'gate.jsonl')), false)
})

test('闸门打开 + 无台账 + 不可逆 → ask，并留一条日志', async () => {
  const dir = projectDir()
  const { ctx, handlers } = fakeCtx()
  apply(ctx, { gate: true })
  const decision = await handlers[0].handler({ ...exec('bash', { command: 'rm -rf build' }), agent: { session: { header: { cwd: dir } } } }, next)
  assert.equal(decision.kind, 'ask')
  assert.match(decision.reason, /不可逆操作（rm）/)
  const log = readFileSync(path.join(dir, '.fp', 'gate.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(log.length, 1)
  assert.equal(log[0].decision, 'ask')
  assert.equal(log[0].rule, 'rm')
})

test('闸门打开 + 通过且未过期的台账 → 放行', async () => {
  const dir = projectDir()
  writeLedger(dir)
  const { ctx, handlers } = fakeCtx()
  apply(ctx, { gate: true })
  const decision = await handlers[0].handler({ ...exec('bash', { command: 'rm -rf build' }), agent: { session: { header: { cwd: dir } } } }, next)
  assert.equal(decision.via, 'next')
  const log = readFileSync(path.join(dir, '.fp', 'gate.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(log.at(-1).decision, 'allow')
  assert.match(log.at(-1).ledger, /\.fp\/ledgers\/gate\.md$/)
})

test('闸门打开 + 普通命令 → 零打扰', async () => {
  const dir = projectDir()
  const { ctx, handlers } = fakeCtx()
  apply(ctx, { gate: true })
  const decision = await handlers[0].handler({ ...exec('bash', { command: 'git status' }), agent: { session: { header: { cwd: dir } } } }, next)
  assert.equal(decision.via, 'next')
  assert.equal(existsSync(path.join(dir, '.fp', 'gate.jsonl')), false)
})

test('/fp gate on|off 切换运行期开关，/fp gate 给状态', async () => {
  const dir = projectDir()
  const { ctx, commands } = fakeCtx()
  apply(ctx, {})
  const agent = { session: { header: { cwd: dir } } }
  const on = await commands[0].handler({ agent, rawInput: 'gate on' })
  assert.equal(on.kind, 'success')
  assert.match(on.text, /闸门已打开/)
  const status = await commands[0].handler({ agent, rawInput: 'gate' })
  assert.match(status.text, /闸门：开/)
  assert.match(status.text, /还没有记录/)
  const off = await commands[0].handler({ agent, rawInput: 'gate off' })
  assert.match(off.text, /闸门已关闭/)
})

test('日志坏了也不影响闸门判断', () => {
  const dir = projectDir()
  mkdirSync(path.join(dir, '.fp'), { recursive: true })
  writeFileSync(path.join(dir, '.fp', 'gate.jsonl'), 'not json\n{"decision":"ask","rule":"rm"}\n')
  assert.equal(summarizeGate([]).total, 0)
  assert.match(renderGateStatus({ enabled: false, events: [], dirName: '.fp' }), /闸门：关/)
})

test('tool: document 模式的 ledgerPath 必须是字符串（宿主按 schema 校验）', async () => {
  const dir = projectDir()
  writeLedger(dir)
  const { ctx, handlers: _handlers } = fakeCtx()
  const tools = []
  ctx.tools = { register: (definition) => (tools.push(definition), () => {}) }
  apply(ctx, {})
  const value = await tools[0].execute({ document: readFileSync(path.join(dir, '.fp', 'ledgers', 'gate.md'), 'utf8') }, { agent: { session: { header: { cwd: dir } } } })
  assert.equal(typeof value.ledgerPath, 'string')
  assert.equal(value.verdict, 'pass')
  const runs = readFileSync(path.join(dir, '.fp', 'runs.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(runs.at(-1).ledger, '(inline)')
  rmSync(dir, { recursive: true, force: true })
})
