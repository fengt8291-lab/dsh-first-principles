import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkLedger } from '../plugin/src/ledger.js'
import { daysUntil, localDateKey, parseConfidence, parseDateKey } from '../plugin/src/meta.js'
import { buildTemplate, defaultReviewDate, probeProject, probeScope } from '../plugin/src/template.js'
import { findProjectRoot } from '../plugin/src/root.js'
import { applyReanchor, planReanchor, setReviewAfter } from '../plugin/src/reanchor.js'
import { appendRun, readRuns, renderStats, summarizeRuns } from '../plugin/src/runs.js'
import { apply } from '../plugin/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const sample = path.join(here, 'fixtures', 'sample')

function tempDir(prefix = 'fp-m4-') {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

function inThirtyDays() {
  return localDateKey(new Date(Date.now() + 30 * 86400000))
}

/** 在真实 fixture 上拼一份能通过的台账，再按用例改头部/条目。 */
function ledgerText({ header = [], facts = ['- F1 · package.json:2 · `"name": "sample-app",`'], conclusionExtra = ' 过期时间应随登录响应一并下发' } = {}) {
  return [
    '# 第一性原理台账 · sample-app',
    'question: 会话过期时间该由哪一侧决定？',
    'mode: decision',
    'scope: package.json, src/auth/**',
    ...header,
    '',
    '## Facts',
    ...facts,
    '',
    '## Assumptions',
    '- A1 · basis: inference · falsify: 若客户端已有本地刷新逻辑，则本假设失效',
    '  TTL 完全由服务端单方面决定',
    '',
    '## Open',
    '- O1 · probe: 检查是否存在 refresh 端点 · deferred(等 auth 重构)',
    '',
    '## Derivation',
    '- D1 · from F1,A1',
    '  TTL 硬编码在服务端，客户端只能靠 401 反推',
    '',
    '## Conclusion',
    '- C1 · depends: D1',
    conclusionExtra,
    '',
    '## Revisit',
    '- R1 · A1',
    '  一旦客户端出现主动刷新逻辑，C1 需要重估',
    '',
  ].join('\n')
}

const run = (text, options = {}) => checkLedger({ cwd: sample, text, ledgerPath: path.join(sample, '.fp', 'ledgers', 'x.md'), options })

test('review_after：未来日期通过并带出天数', () => {
  const report = run(ledgerText({ header: [`review_after: ${inThirtyDays()}`] }))
  assert.equal(report.verdict, 'pass')
  assert.equal(report.meta.reviewAfter, inThirtyDays())
  assert.ok(report.meta.daysLeft >= 29 && report.meta.daysLeft <= 31)
  assert.equal(report.meta.expired, false)
  assert.equal(report.warnings.some((item) => item.code === 'W007'), false)
})

test('review_after：过期报 W007，但不影响 verdict', () => {
  const report = run(ledgerText({ header: ['review_after: 2020-01-01'] }))
  assert.equal(report.verdict, 'pass')
  assert.equal(report.meta.expired, true)
  const warning = report.warnings.find((item) => item.code === 'W007')
  assert.ok(warning, '过期应当有 W007')
  assert.match(warning.message, /过期/)
})

test('review_after：非法日期报 E019（2026-02-30 也不是合法日期）', () => {
  for (const bad of ['2026-13-01', '2026-02-30', '2026/11/20', 'tomorrow']) {
    const report = run(ledgerText({ header: [`review_after: ${bad}`] }))
    assert.equal(report.verdict, 'fail', bad)
    assert.ok(report.errors.some((item) => item.code === 'E019'), `${bad} 应当报 E019`)
  }
})

test('confidence：0.7 与 70% 等价，非法值报 E018', () => {
  assert.equal(parseConfidence('0.7'), 0.7)
  assert.equal(parseConfidence('70%'), 0.7)
  assert.equal(parseConfidence('1'), 1)
  assert.equal(parseConfidence('0'), 0)
  assert.equal(parseConfidence('1.5'), null)
  assert.equal(parseConfidence('abc'), null)

  const ok = run(ledgerText({ header: ['confidence: 70%'] }))
  assert.equal(ok.verdict, 'pass')
  assert.equal(ok.meta.confidence, 0.7)

  const bad = run(ledgerText({ header: ['confidence: 1.4'] }))
  assert.equal(bad.verdict, 'fail')
  assert.ok(bad.errors.some((item) => item.code === 'E018'))

  const perConclusion = run(ledgerText({ conclusionExtra: ' 结论 · confidence: huge' }))
  assert.equal(perConclusion.verdict, 'fail')
  assert.ok(perConclusion.errors.some((item) => item.code === 'E018' && item.at === 'C1'))
})

test('kill：头部写了就带出来，没写也不拦', () => {
  const withKill = run(ledgerText({ header: ['kill: 上线两周后 401 率没有下降就回滚'] }))
  assert.equal(withKill.verdict, 'pass')
  assert.match(withKill.meta.kill, /401/)
  const without = run(ledgerText())
  assert.equal(without.verdict, 'pass')
  assert.equal(without.meta.kill, null)
})

test('E020：台账超过体积上限 / 条目超过上限', () => {
  const huge = run(ledgerText(), { maxLedgerBytes: 100 })
  assert.equal(huge.verdict, 'fail')
  assert.equal(huge.errors[0].code, 'E020')
  assert.match(huge.errors[0].message, /超过可校验上限/)

  const manyItems = run(ledgerText(), { maxItems: 1 })
  assert.equal(manyItems.verdict, 'fail')
  assert.equal(manyItems.errors[0].code, 'E020')
})

test('CRLF 与 BOM：Windows 上复制来的台账照样能校验', () => {
  const crlf = ledgerText({ header: ['confidence: 0.9'] }).replace(/\n/g, '\r\n')
  const report = run(crlf)
  assert.equal(report.verdict, 'pass')
  assert.equal(report.counts.facts, 1)
})

test('evidence：BOM 文件、二进制文件、Windows 风格路径', () => {
  const dir = tempDir()
  mkdirSync(path.join(dir, 'src'), { recursive: true })
  writeFileSync(path.join(dir, 'src', 'a.ts'), '\uFEFFexport const answer = 42\n', 'utf8')
  writeFileSync(path.join(dir, 'src', 'bin.dat'), Buffer.from([0, 1, 2, 3]))

  const bome = checkLedger({
    cwd: dir,
    text: ['# t', 'question: q', 'mode: decision', 'scope: src/a.ts', '', '## Facts', '- F1 · src\\a.ts:1 · `export const answer = 42`', '', '## Assumptions', '- A1 · basis: inference · falsify: 出现反例就说明这条假设错了', '', '## Open', '- O1 · probe: 读文件 · deferred(稍后)', '', '## Derivation', '- D1 · from F1,A1', '', '## Conclusion', '- C1 · depends: D1', '  ok', '', '## Revisit', '- R1 · A1', '  x', ''].join('\n'),
  })
  assert.equal(bome.verdict, 'pass', JSON.stringify(bome.errors))

  const binary = checkLedger({
    cwd: dir,
    text: ['# t', 'question: q', 'mode: decision', 'scope: src/bin.dat', '', '## Facts', '- F1 · src/bin.dat:1 · `abc`', '', '## Assumptions', '- A1 · basis: inference · falsify: 出现反例就说明这条假设错了', '', '## Open', '- O1 · probe: 读文件 · deferred(稍后)', '', '## Derivation', '- D1 · from F1,A1', '', '## Conclusion', '- C1 · depends: D1', '  ok', '', '## Revisit', '- R1 · A1', '  x', ''].join('\n'),
  })
  assert.equal(binary.verdict, 'fail')
  assert.ok(binary.errors.some((item) => /二进制/.test(item.message)))
})

test('evidence：文件超过 maxFileBytes 时报 E004 并说明上限', () => {
  const dir = tempDir()
  writeFileSync(path.join(dir, 'big.ts'), 'x'.repeat(4000), 'utf8')
  const report = checkLedger({
    cwd: dir,
    text: ['# t', 'question: q', 'mode: decision', 'scope: big.ts', '', '## Facts', '- F1 · big.ts:1 · `xxx`', '', '## Assumptions', '- A1 · basis: inference · falsify: 出现反例就说明这条假设错了', '', '## Open', '- O1 · probe: 读文件 · deferred(稍后)', '', '## Derivation', '- D1 · from F1,A1', '', '## Conclusion', '- C1 · depends: D1', '  ok', '', '## Revisit', '- R1 · A1', '  x', ''].join('\n'),
    options: { maxFileBytes: 1000 },
  })
  assert.equal(report.verdict, 'fail')
  assert.ok(report.errors.some((item) => item.code === 'E004' && /超过/.test(item.message)))
})

test('root：自带 package.json 的子目录不会跳到外层项目', () => {
  const outer = tempDir()
  mkdirSync(path.join(outer, '.fp'), { recursive: true })
  const inner = path.join(outer, 'packages', 'web')
  mkdirSync(inner, { recursive: true })
  writeFileSync(path.join(inner, 'package.json'), '{}\n')

  assert.equal(findProjectRoot(inner).root, inner)
  assert.equal(findProjectRoot(path.join(outer, 'packages')).root, outer)
  assert.equal(findProjectRoot(inner).foundBy, 'marker')

  const mono = tempDir()
  const deep = path.join(mono, 'src', 'a', 'b')
  mkdirSync(path.join(mono, '.git'), { recursive: true })
  mkdirSync(deep, { recursive: true })
  assert.equal(findProjectRoot(deep).root, mono)
})

test('template：没有 package.json 的项目也能从源码取到真实引用', () => {
  const dir = tempDir()
  writeFileSync(path.join(dir, 'solver.py'), 'CONVERGENCE = 0.01\n\ndef solve(x):\n    return x\n', 'utf8')
  const facts = probeProject(dir)
  assert.ok(facts.length >= 1, '应当从 .py 里取到可引用的行')
  assert.equal(facts[0].path, 'solver.py')
  assert.equal(probeScope(dir), 'solver.py')

  const markdown = buildTemplate({ cwd: dir, facts, scope: probeScope(dir) })
  assert.match(markdown, /solver\.py:1 · `CONVERGENCE = 0.01`/)
  assert.match(markdown, /review_after: \d{4}-\d{2}-\d{2}/)
  assert.match(markdown, /confidence: 0\.7/)

  const report = checkLedger({ cwd: dir, text: markdown })
  assert.equal(report.verdict, 'pass', JSON.stringify(report.errors))
  assert.equal(report.meta.reviewAfter, defaultReviewDate())
})

test('reanchor：代码改过之后按引文把行号改回来', () => {
  const dir = tempDir()
  mkdirSync(path.join(dir, 'src'), { recursive: true })
  const file = path.join(dir, 'src', 'a.ts')
  writeFileSync(file, '// header\n\nexport const answer = 42\n', 'utf8')
  const text = ['# t', 'question: q', 'mode: decision', 'scope: src/a.ts', '', '## Facts', '- F1 · src/a.ts:1 · `export const answer = 42`', '', '## Assumptions', '- A1 · basis: inference · falsify: 出现反例就说明这条假设错了', '', '## Open', '- O1 · probe: 读文件 · deferred(稍后)', '', '## Derivation', '- D1 · from F1,A1', '', '## Conclusion', '- C1 · depends: D1', '  ok', '', '## Revisit', '- R1 · A1', '  x', ''].join('\n')

  const before = checkLedger({ cwd: dir, text })
  assert.equal(before.verdict, 'fail')
  assert.ok(before.errors.some((item) => item.code === 'E006'))

  const plan = planReanchor({ cwd: dir, text })
  assert.equal(plan.changes.length, 1)
  assert.equal(plan.changes[0].from, 1)
  assert.equal(plan.changes[0].to, 3)

  const applied = applyReanchor(text, plan.changes)
  assert.equal(applied.applied, 1)
  assert.match(applied.text, /- F1 · src\/a\.ts:3 · `export const answer = 42`/)

  const after = checkLedger({ cwd: dir, text: applied.text })
  assert.equal(after.verdict, 'pass')
})

test('reanchor：找不到引文时不猜，只报告', () => {
  const dir = tempDir()
  writeFileSync(path.join(dir, 'a.ts'), 'nothing useful here\n', 'utf8')
  const text = ['# t', 'question: q', 'mode: decision', 'scope: a.ts', '', '## Facts', '- F1 · a.ts:1 · `export const answer = 42`', '', '## Assumptions', '- A1 · basis: inference · falsify: 出现反例就说明这条假设错了', '', '## Open', '- O1 · probe: 读文件 · deferred(稍后)', '', '## Derivation', '- D1 · from F1,A1', '', '## Conclusion', '- C1 · depends: D1', '  ok', '', '## Revisit', '- R1 · A1', '  x', ''].join('\n')
  const plan = planReanchor({ cwd: dir, text })
  assert.equal(plan.changes.length, 0)
  assert.equal(plan.unresolved.length, 1)
  assert.match(plan.unresolved[0].reason, /找不到/)
})

test('setReviewAfter：没有就插入，有就替换', () => {
  const text = ledgerText()
  const inserted = setReviewAfter(text, '2026-12-01')
  assert.equal(inserted.replaced, false)
  assert.match(inserted.text, /scope: package\.json, src\/auth\/\*\*\nreview_after: 2026-12-01/)
  const replaced = setReviewAfter(inserted.text, '2027-01-01')
  assert.equal(replaced.replaced, true)
  assert.match(replaced.text, /review_after: 2027-01-01/)
  assert.equal((replaced.text.match(/review_after:/g) ?? []).length, 1)
})

test('runs：追加、读取、汇总、渲染', () => {
  const dir = tempDir()
  const now = new Date().toISOString()
  assert.equal(appendRun(dir, '.fp', { ts: now, ledger: 'a.md', verdict: 'pass', errors: [], warnings: [] }), true)
  assert.equal(appendRun(dir, '.fp', { ts: now, ledger: 'b.md', verdict: 'fail', errors: ['E005', 'E005', 'E006'], warnings: [] }), true)
  writeFileSync(path.join(dir, '.fp', 'runs.jsonl'), `${readFileSync(path.join(dir, '.fp', 'runs.jsonl'), 'utf8')}坏行\n`, 'utf8')

  const runs = readRuns(dir, '.fp')
  assert.equal(runs.length, 2, '坏行应被跳过')

  const summary = summarizeRuns(runs)
  assert.equal(summary.total, 2)
  assert.equal(summary.passed, 1)
  assert.equal(Math.round(summary.passRate * 100), 50)
  assert.equal(summary.topCodes[0].code, 'E005')
  assert.equal(summary.topCodes[0].count, 2)

  const text = renderStats(summary, { ledgers: 2, expired: 1 })
  assert.match(text, /通过率 50%/)
  assert.match(text, /已到期未复查/)
  assert.match(text, /E005×2/)
})

test('/fp status、/fp stats、/fp reanchor、/fp review 都能跑通', async () => {
  const dir = tempDir()
  writeFileSync(path.join(dir, 'package.json'), '{"name":"fp-cli","version":"0.0.1"}\n', 'utf8')
  mkdirSync(path.join(dir, '.fp', 'ledgers'), { recursive: true })
  const ledgerPath = path.join(dir, '.fp', 'ledgers', 'cli.md')
  writeFileSync(ledgerPath, ledgerText({ header: ['review_after: 2020-01-01'] }), 'utf8')

  const commands = []
  const ctx = {
    effect(fn) {
      fn()
    },
    get(key) {
      if (key === 'commands') return { register: (definition) => { commands.push(definition); return () => {} } }
      return null
    },
    systemPrompt: { section: () => () => {} },
    tools: { register: () => () => {} },
  }
  apply(ctx, { rootDir: dir, dir: '.fp' })
  const command = commands[0]
  const agent = { session: { header: { cwd: dir } } }
  const call = (rawInput) => command.handler({ rawInput, agent }).then((value) => value.text)

  const status = await call('status')
  assert.match(status, /台账 1 份/)
  assert.match(status, /⚠ 过期/)

  const stats = await call('stats')
  assert.match(stats, /运行记录|还没有运行记录/)

  const reviewed = await call('review 2027-03-01')
  assert.match(reviewed, /review_after: 2027-03-01/)
  assert.match(readFileSync(ledgerPath, 'utf8'), /review_after: 2027-03-01/)

  const reanchor = await call('reanchor')
  assert.match(reanchor, /重锚|行号都是对的/)

  const help = await call('')
  assert.match(help, /\/fp stats/)
})

test('日期工具：本地日历日，不受时区推日影响', () => {
  const parsed = parseDateKey('2026-11-20')
  assert.ok(parsed)
  assert.equal(daysUntil('2026-11-20', new Date(2026, 10, 10)), 10)
  assert.equal(daysUntil('2026-11-20', new Date(2026, 10, 25)), -5)
  assert.equal(localDateKey(new Date(2026, 0, 2)), '2026-01-02')
  assert.equal(parseDateKey('2026-1-2').key, '2026-01-02')
})
