import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply, inject, name } from '../plugin/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.join(here, '..', 'plugin')
const good = readFileSync(path.join(here, 'fixtures', 'ledgers', 'good.md'), 'utf8')
const sample = path.join(here, 'fixtures', 'sample')
const goodFromSample = readFileSync(path.join(here, 'fixtures', 'ledgers', 'good.md'), 'utf8')

function fakeCtx() {
  const sections = []
  const tools = []
  const commands = []
  const disposers = []
  const ctx = {
    effect(fn) {
      const disposer = fn()
      assert.equal(typeof disposer, 'function', 'effect 必须返回 disposer')
      disposers.push(disposer)
    },
    get(key) {
      if (key === 'workingDirectory') return null
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
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {}
      },
    },
    tools: {
      register(definition) {
        tools.push(definition)
        return () => {}
      },
    },
  }
  return { ctx, sections, tools, commands, disposers }
}

const agentFor = (cwd) => ({ session: { header: { cwd } } })

test('插件声明与注册形状', () => {
  assert.equal(name, 'first-principles')
  assert.deepEqual(inject, ['systemPrompt', 'tools'])

  const { ctx, sections, tools, commands, disposers } = fakeCtx()
  apply(ctx, {})
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'first-principles')
  assert.equal(typeof sections[0].order, 'number')
  assert.match(sections[0].text, /first_principles_check/)
  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'first_principles_check')
  assert.equal(tools[0].parameters.type, 'object')
  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, 'fp')
  assert.equal(disposers.length, 3)
})

test('tool: 无参数返回骨架，骨架带真实引用', async () => {
  const { ctx, tools } = fakeCtx()
  apply(ctx, { dir: '.fp' })
  const value = await tools[0].execute({}, { agent: agentFor(pluginRoot) })
  assert.equal(value.verdict, 'template')
  assert.match(value.markdown, /## Facts/)
  assert.match(value.markdown, /package\.json:\d+ · `"name": "dsh-first-principles",`/)
  const rendered = tools[0].output.render({}, value)
  assert.equal(rendered[0].type, 'text')
  assert.match(rendered[0].text, /已生成台账骨架/)
})

test('tool: document 参数直接校验通过', async () => {
  const { ctx, tools } = fakeCtx()
  apply(ctx, {})
  const value = await tools[0].execute({ document: goodFromSample }, { agent: agentFor(sample) })
  assert.equal(value.verdict, 'pass')
  assert.equal(value.counts.factsVerified, 2)
  assert.match(tools[0].output.render({}, value)[0].text, /LEDGER PASS/)
})

test('tool: 不存在的 path 返回 E004', async () => {
  const { ctx, tools } = fakeCtx()
  apply(ctx, {})
  const value = await tools[0].execute({ path: '.fp/ledgers/nope.md' }, { agent: agentFor(sample) })
  assert.equal(value.verdict, 'fail')
  assert.equal(value.errors[0].code, 'E004')
})

test('tool: 写入后的台账能被自动发现并校验', async () => {
  const { ctx, tools } = fakeCtx()
  apply(ctx, { dir: '.fp' })
  const { mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const ledgerDir = path.join(sample, '.fp', 'ledgers')
  mkdirSync(ledgerDir, { recursive: true })
  const ledgerPath = path.join(ledgerDir, 'sample.md')
  writeFileSync(ledgerPath, good)
  try {
    const value = await tools[0].execute({}, { agent: agentFor(sample) })
    assert.equal(value.verdict, 'pass')
    assert.equal(value.ledgerPath, path.join('.fp', 'ledgers', 'sample.md'))

    const broken = await tools[0].execute({ path: ledgerPath }, { agent: agentFor(sample) })
    assert.equal(broken.verdict, 'pass')
  } finally {
    rmSync(path.join(sample, '.fp'), { recursive: true, force: true })
  }
})

test('command: /fp 给出用法，/fp status 汇总所有台账', async () => {
  const { ctx, commands } = fakeCtx()
  apply(ctx, {})
  const help = await commands[0].handler({ agent: agentFor(sample), rawInput: '' })
  assert.equal(help.kind, 'success')
  assert.match(help.text, /first_principles_check/)

  const status = await commands[0].handler({ agent: agentFor(sample), rawInput: 'status' })
  assert.equal(status.kind, 'success')
  assert.match(status.text, /台账|还没有台账/)
})

test('面板路由等 webServer 就绪后再注册（ctx.inject，不在 apply 里直接 get）', () => {
  const routes = []
  const pending = []
  let injected = false
  const webServer = {
    register(route) {
      routes.push(route)
      return () => {}
    },
  }
  const ctx = {
    effect(fn) {
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    get(key) {
      if (key === 'webServer') return injected ? webServer : null
      return null
    },
    inject(deps, callback) {
      pending.push({ deps, callback })
      return () => {}
    },
    systemPrompt: { section: () => () => {} },
    tools: { register: () => () => {} },
  }

  apply(ctx, {})

  assert.equal(routes.length, 0, 'apply 时 webServer 还没就绪，不应立刻注册')
  assert.ok(pending.length >= 1, '必须用 ctx.inject 等 webServer')
  const panelPending = pending.find((entry) => entry.deps[0] === 'webServer')
  assert.ok(panelPending, '面板路由要等 webServer')

  injected = true
  panelPending.callback(ctx)

  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/x-first-principles')
  assert.equal(typeof routes[0].handler, 'function')
})

test('/fp doctor 在面板没注册时说清楚原因', async () => {
  const commands = []
  const ctx = {
    effect(fn) {
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    get(key) {
      if (key === 'commands') return { register: (definition) => (commands.push(definition), () => {}) }
      return null
    },
    inject(deps, callback) {
      // 真实 Cordis：依赖已就绪时回调立即执行。这里让 commands 立刻可用。
      if (deps.every((dep) => ctx.get(dep))) callback(ctx)
      return () => {}
    },
    systemPrompt: { section: () => () => {} },
    tools: { register: () => () => {} },
  }

  apply(ctx, {})
  const command = commands[0]
  const result = await command.handler({ rawInput: 'doctor', agent: agentFor(pluginRoot) })

  assert.equal(result.kind, 'success')
  assert.match(result.text, /first-principles v\d+\.\d+\.\d+/)
  assert.match(result.text, /面板路由：未注册/)
  assert.match(result.text, /斜杠命令：已注册 \/fp/)
  assert.match(result.text, /闸门：关/)
})
