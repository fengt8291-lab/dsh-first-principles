import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { apply } from '../plugin/index.js'
import { buildAnchor, renderAnchor, anchorDigest } from '../plugin/src/anchor.js'

function projectDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fp-anchor-'))
  writeFileSync(path.join(dir, 'package.json'), '{\n  "name": "anchor-fixture",\n  "version": "1.0.0"\n}\n')
  return dir
}

function ledgerText({ question, reviewAfter = null, conclusion = '可以用名字定位项目', open = '是否需要别的字段' }) {
  const header = ['question: ' + question, 'mode: decision', 'scope: package.json']
  if (reviewAfter) header.push(`review_after: ${reviewAfter}`)
  return [
    `# 台账 · ${question}`,
    '',
    ...header,
    '',
    '## Facts',
    '',
    '- F1 · package.json:2 · `"name": "anchor-fixture",`',
    '',
    '## Assumptions',
    '',
    '- A1 · basis: inference · falsify: 若发现名字被别处引用则不成立',
    '  清单里的名字就是项目标识',
    '',
    '## Open',
    '',
    `- O1 · probe: ${open} · deferred(暂时不需要)`,
    '',
    '## Derivation',
    '',
    '- D1 · from F1,A1',
    '  名字字段足以标识这个项目',
    '',
    '## Conclusion',
    '',
    '- C1 · depends: D1',
    `  ${conclusion}`,
    '',
    '## Revisit',
    '',
    '- R1 · A1',
    '  一旦名字被复用，C1 需要重估',
    '',
  ].join('\n')
}

function writeLedger(dir, name, options) {
  const ledgerDir = path.join(dir, '.fp', 'ledgers')
  mkdirSync(ledgerDir, { recursive: true })
  const file = path.join(ledgerDir, name)
  writeFileSync(file, ledgerText(options), 'utf8')
  return file
}

function fakeCtx() {
  const handlers = []
  const commands = []
  const ctx = {
    effect(fn) {
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    on(event, handler) {
      handlers.push({ event, handler })
      return () => {}
    },
    get(key) {
      if (key === 'commands') return { register(definition) { commands.push(definition); return () => {} } }
      return null
    },
    systemPrompt: { section: () => () => {} },
    tools: { register: () => () => {} },
  }
  return { ctx, handlers, commands }
}

const agentAt = (dir) => ({ session: { header: { cwd: dir } } })

test('buildAnchor 取最新的台账，并抽出问题、结论与未决项', () => {
  const dir = projectDir()
  writeLedger(dir, 'a.md', { question: '旧问题', conclusion: '旧结论' })
  // 让 a.md 明确更旧
  const later = new Date(Date.now() + 5000)
  const fileB = writeLedger(dir, 'b.md', { question: '新问题', conclusion: '新结论' })
  const files = [
    { name: 'b.md', path: fileB, mtime: later.getTime() },
    { name: 'a.md', path: path.join(dir, '.fp', 'ledgers', 'a.md'), mtime: later.getTime() - 5000 },
  ]
  const anchor = buildAnchor(dir, files, { limit: 2 })
  assert.equal(anchor.entries.length, 2)
  assert.equal(anchor.entries[0].question, '新问题')
  assert.deepEqual(anchor.entries[0].conclusions.map((item) => item.id), ['C1'])
  assert.equal(anchor.entries[0].open.length, 1)
  assert.equal(anchor.entries[1].question, '旧问题')
})

test('buildAnchor 带上复查日期与剩余天数', () => {
  const dir = projectDir()
  const today = new Date()
  const future = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate() + 3).padStart(2, '0')}`
  const file = writeLedger(dir, 'a.md', { question: '要不要上闸门', reviewAfter: future })
  const anchor = buildAnchor(dir, [{ name: 'a.md', path: file }])
  assert.equal(anchor.entries[0].reviewAfter, future)
  assert.equal(anchor.entries[0].daysLeft, 3)
  assert.equal(anchor.entries[0].expired, false)
  assert.match(renderAnchor(anchor, 'zh'), /还有 3 天/)
})

test('renderAnchor 带上前提警告：这是历史判断不是当前事实', () => {
  const dir = projectDir()
  const file = writeLedger(dir, 'a.md', { question: '要不要上闸门' })
  const text = renderAnchor(buildAnchor(dir, [{ name: 'a.md', path: file }]), 'zh')
  assert.match(text, /之前会话的判断，不是当前事实/)
  assert.match(text, /要不要上闸门/)
  assert.match(text, /C1/)
  assert.match(text, /还没定的事/)
})

test('没有台账时 renderAnchor 返回空串，digest 说清楚', () => {
  assert.equal(renderAnchor({ entries: [] }), '')
  assert.equal(anchorDigest({ entries: [] }), '还没有台账')
})

test('工具传 context: true 返回锚点，而不是去校验台账', async () => {
  const dir = projectDir()
  writeLedger(dir, 'a.md', { question: '上次的问题', conclusion: '上次的结论' })
  const { ctx } = fakeCtx()
  apply(ctx, {})
  const tools = []
  // 重新装配一次，拿到注册的工具定义
  const capture = {
    ...ctx,
    tools: { register: (definition) => { tools.push(definition); return () => {} } },
  }
  apply(capture, {})
  const tool = tools.find((definition) => definition.name === 'first_principles_check')
  const value = await tool.execute({ context: true }, { agent: agentAt(dir) })
  assert.equal(value.verdict, 'anchor')
  assert.equal(typeof value.ledgerPath, 'string')
  assert.match(value.anchor, /上次的问题/)
  assert.match(value.anchor, /上次的结论/)
  const rendered = tool.output.render({}, value)
  assert.equal(rendered[0].type, 'text')
  assert.match(rendered[0].text, /上次的结论/)
})

test('/fp context 打印锚点；没有台账时说明没有可继承的结论', async () => {
  const dir = projectDir()
  const { ctx, commands } = fakeCtx()
  apply(ctx, {})
  const command = commands.find((definition) => definition.name === 'fp')
  const empty = await command.handler({ agent: agentAt(dir), rawInput: 'context', attachments: [], signal: new AbortController().signal })
  assert.match(empty.text, /还没有台账/)

  writeLedger(dir, 'a.md', { question: '闸门要不要默认开' })
  const filled = await command.handler({ agent: agentAt(dir), rawInput: 'context', attachments: [], signal: new AbortController().signal })
  assert.match(filled.text, /闸门要不要默认开/)
})

test('W008：项目里还有问法不同的活台账时给提醒，同问法不提醒', async () => {
  const dir = projectDir()
  const { ctx, tools: _ignored } = fakeCtx()
  const tools = []
  const capture = { ...ctx, tools: { register: (definition) => { tools.push(definition); return () => {} } } }
  apply(capture, {})
  const tool = tools.find((definition) => definition.name === 'first_principles_check')
  const today = new Date()
  const future = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate() + 1).padStart(2, '0')}`

  writeLedger(dir, 'old.md', { question: '另一个完全不同的问题', reviewAfter: future })
  writeLedger(dir, 'new.md', { question: '这次的问题', reviewAfter: future })
  const value = await tool.execute({ path: '.fp/ledgers/new.md' }, { agent: agentAt(dir) })
  assert.equal(value.verdict, 'pass')
  assert.deepEqual(value.warnings.map((item) => item.code).filter((code) => code === 'W008'), ['W008'])

  // 同问法：把 old.md 改成同一个问题，W008 应该消失
  writeLedger(dir, 'old.md', { question: '这次的问题', reviewAfter: future })
  const same = await tool.execute({ path: '.fp/ledgers/new.md' }, { agent: agentAt(dir) })
  assert.equal(same.warnings.some((item) => item.code === 'W008'), false)
})
