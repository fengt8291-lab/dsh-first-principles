import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkLedger, classifySelfReference, selfRefRules } from '../plugin/src/ledger.js'
import { createReader, extractCitation, extractQuote, globToRegExp, verifyFact } from '../plugin/src/evidence.js'
import { buildTemplate, probeProject, probeScope } from '../plugin/src/template.js'
import { renderReport } from '../plugin/src/report.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const sample = path.join(here, 'fixtures', 'sample')
const pluginRoot = path.join(here, '..', 'plugin')

const good = readFileSync(path.join(here, 'fixtures', 'ledgers', 'good.md'), 'utf8')
const codes = (report) => report.errors.map((item) => item.code)
const warnCodes = (report) => report.warnings.map((item) => item.code)

function check(text) {
  return checkLedger({ cwd: sample, text })
}

function expectCode(code, mutate) {
  const report = check(mutate(good))
  assert.ok(codes(report).includes(code), `期望 ${code}，实际得到 ${codes(report).join(',') || '无'}`)
  return report
}

test('evidence: 引用与引文抽取', () => {
  assert.deepEqual(extractCitation(['src/a.ts:42']), { path: 'src/a.ts', start: 42, end: 42 })
  assert.deepEqual(extractCitation(['src/a.ts:10-12', '`x`']), { path: 'src/a.ts', start: 10, end: 12 })
  assert.equal(extractCitation(['没有引用']), null)
  assert.equal(extractQuote(['src/a.ts:42', '`const x = 1`']), 'const x = 1')
  assert.equal(extractQuote(['src/a.ts:42']), null)
  assert.equal(extractCitation(['会议 12:30 开始']), null, '时间戳不应被当成引用')
})

test('evidence: glob 语义', () => {
  assert.ok(globToRegExp('src/auth/**').test('src/auth/session.ts'))
  assert.ok(globToRegExp('src/**').test('src/a/b/c.ts'))
  assert.ok(globToRegExp('*.md').test('README.md'))
  assert.ok(!globToRegExp('*.md').test('docs/README.md'))
  assert.ok(globToRegExp('src/*.ts').test('src/index.ts'))
  assert.ok(!globToRegExp('src/*.ts').test('src/auth/session.ts'))
})

test('evidence: 逐字比对引文', () => {
  const reader = createReader(sample)
  const ok = verifyFact({ id: 'F1', citation: { path: 'src/auth/session.ts', start: 2, end: 2 }, quote: 'const    ttl   = 60 * 60 * 1000' }, reader)
  assert.equal(ok.ok, true, '空白差异应该被归一化掉')
  const mismatch = verifyFact({ id: 'F2', citation: { path: 'src/auth/session.ts', start: 2, end: 2 }, quote: 'const ttl = 1' }, reader)
  assert.equal(mismatch.code, 'E006')
  const outside = verifyFact({ id: 'F3', citation: { path: '../outside.ts', start: 1, end: 1 }, quote: 'x' }, reader)
  assert.equal(outside.code, 'E015')
})

test('合格台账应当通过', () => {
  const report = check(good)
  assert.deepEqual(codes(report), [])
  assert.equal(report.verdict, 'pass')
  assert.equal(report.counts.factsVerified, 2)
  assert.equal(report.counts.conclusions, 1)
})

test('E001 头部缺字段 / mode 非法', () => {
  expectCode('E001', (text) => text.replace('question: 会话过期时间该由哪一侧决定？\n', ''))
  expectCode('E001', (text) => text.replace('mode: decision', 'mode: 随便'))
})

test('E002 scope 匹配不到文件', () => {
  expectCode('E002', (text) => text.replace('scope: package.json, src/auth/**', 'scope: nothing/**'))
})

test('E003 事实缺反引号原文', () => {
  expectCode('E003', (text) => text.replace('`const ttl = 60 * 60 * 1000`', 'const ttl = 60 * 60 * 1000'))
})

test('E004 引用文件不存在', () => {
  expectCode('E004', (text) => text.replace('src/auth/session.ts:2', 'src/auth/missing.ts:2'))
})

test('E005 行号越界', () => {
  expectCode('E005', (text) => text.replace('src/auth/session.ts:2', 'src/auth/session.ts:99'))
})

test('E006 引文与目标行不符', () => {
  expectCode('E006', (text) => text.replace('const ttl = 60 * 60 * 1000', 'const ttl = 60 * 60 * 1001'))
})

test('E007 / E008 假设的 basis 与 falsify', () => {
  expectCode('E007', (text) => text.replace('basis: inference', 'basis: 直觉'))
  expectCode('E008', (text) => text.replace(' · falsify: 若客户端已存在本地强制刷新逻辑，则本假设失效', ''))
})

test('E009 / E010 / E011 推导图的完整性', () => {
  expectCode('E009', (text) => text.replace('from F1,F2,A1', 'from F1,F9,A1'))
  expectCode('E010', (text) =>
    text.replace('- C1 · depends: D1\n  过期时间应随登录响应一并下发，而不是让客户端猜', '- C1 · depends: C2\n  循环一\n- C2 · depends: C1\n  循环二'),
  )
  expectCode('E011', (text) => text.replace('- C1 · depends: D1', '- C1'))
})

test('E012 Open 项没有终态', () => {
  expectCode('E012', (text) => text.replace('deferred(等 auth 模块重构后再查)', '不知道'))
})

test('E013 缺 Revisit 段', () => {
  expectCode('E013', (text) => text.replace(/\n## Revisit\n[\s\S]*$/, '\n'))
})

test('E014 结论依赖的假设没有失效条件', () => {
  const report = expectCode('E014', (text) => text.replace('- R1 · A1', '- R1 ·（这里写失效条件但没写假设编号）'))
  assert.equal(report.verdict, 'fail')
})

test('W001 事实没有被使用 / W002 引文重复', () => {
  const unused = check(good.replace('## Assumptions', '- F3 · package.json:3 · `"version": "1.2.3",`\n\n## Assumptions'))
  assert.ok(warnCodes(unused).includes('W001'))
  assert.equal(unused.verdict, 'pass', 'warning 不影响通过')

  const duplicated = check(good.replace('## Assumptions', '- F4 · src/auth/session.ts:1 · `export function`\n\n## Assumptions'))
  assert.ok(warnCodes(duplicated).includes('W002'))
})

test('W003 有结论但没有假设', () => {
  const text = [
    '# 台账',
    'question: 要不要加缓存？',
    'mode: decision',
    'scope: package.json',
    '',
    '## Facts',
    '- F1 · package.json:2 · `"name": "sample-app",`',
    '',
    '## Derivation',
    '- D1 · from F1',
    '  推导一步',
    '',
    '## Conclusion',
    '- C1 · depends: D1',
    '  结论一句',
    '',
    '## Revisit',
    '- R1',
    '  改名时重估',
    '',
  ].join('\n')
  const report = check(text)
  assert.ok(warnCodes(report).includes('W003'))
})

test('W004 结论只建立在假设上', () => {
  const text = [
    '# 台账',
    'question: 该不该改？',
    'mode: decision',
    'scope: package.json',
    '',
    '## Assumptions',
    '- A1 · basis: convention · falsify: 一旦有人写出反例',
    '  团队默认这样',
    '',
    '## Derivation',
    '- D1 · from A1',
    '  由假设推出',
    '',
    '## Conclusion',
    '- C1 · depends: D1',
    '  结论',
    '',
    '## Revisit',
    '- R1 · A1',
    '  出现反例时重估',
    '',
  ].join('\n')
  assert.ok(warnCodes(check(text)).includes('W004'))
})

test('模板应当开箱即可通过校验', () => {
  const facts = probeProject(pluginRoot)
  assert.ok(facts.length >= 1, '应当从 package.json 里探到至少一条可引用的事实')
  const markdown = buildTemplate({ cwd: pluginRoot, facts, scope: probeScope(pluginRoot) })
  const report = checkLedger({ cwd: pluginRoot, text: markdown })
  assert.deepEqual(codes(report), [], '刚生成的骨架不应该被自己的校验器打回')
  assert.equal(report.verdict, 'pass')
})

test('报告渲染包含判定与错误码', () => {
  const failed = check(good.replace('const ttl = 60 * 60 * 1000', 'const ttl = 60 * 60 * 1001'))
  const text = renderReport({ ...failed, ledgerPath: '.fp/ledgers/x.md' })
  assert.match(text, /LEDGER FAIL/)
  assert.match(text, /E006/)
  assert.match(text, /再调一次/)
  assert.match(renderReport({ verdict: 'template', path: '/tmp/x.md', markdown: '# 台账', notes: ['说明'] }), /已生成台账骨架/)
})

const F1 = '- F1 · package.json:2 · `"name": "sample-app",`'
const withF1 = (line) => good.replace(F1, line)

test('E017：事实不能引用台账目录', () => {
  const report = check(withF1('- F1 · .fp/ledgers/other.md:3 · `随便一句`'))
  assert.ok(codes(report).includes('E017'), `实际错误：${codes(report).join(',')}`)
  const hit = report.errors.find((item) => item.code === 'E017')
  assert.match(hit.message, /台账目录/)
  assert.match(hit.hint, /\[policy\]/, '提示里要教用户怎么豁免')
})

test('E017：事实不能引用决策文档', () => {
  const report = check(withF1('- F1 · docs/DIRECTION.md:12 · `随便一句`'))
  assert.ok(codes(report).includes('E017'))
  assert.match(report.errors.find((item) => item.code === 'E017').message, /决策文档/)
})

test('E017：事实不能引用本次台账自身', () => {
  const report = checkLedger({ cwd: sample, text: withF1('- F1 · docs/ledgers/me.md:12 · `随便一句`'), ledgerPath: 'docs/ledgers/me.md' })
  assert.ok(codes(report).includes('E017'))
  assert.match(report.errors.find((item) => item.code === 'E017').message, /本次台账自身/)
})

test('W006：标了 [policy] 的自引降级为警告', () => {
  const report = check(withF1('- F1 · .fp/ledgers/other.md:3 · `随便一句` [policy]'))
  assert.ok(!codes(report).includes('E017'), '[policy] 不应再报 E017')
  assert.ok(warnCodes(report).includes('W006'))
})

test('self_ref_deny: - 可以关掉自引禁区', () => {
  const text = withF1('- F1 · .fp/ledgers/other.md:3 · `随便一句`').replace('scope: package.json, src/auth/**', 'scope: package.json, src/auth/**\nself_ref_deny: -')
  const report = check(text)
  assert.ok(!codes(report).includes('E017'), '显式关闭后不应再报 E017')
  assert.ok(codes(report).includes('E004'), '关掉自引后回到常规校验：文件不存在')
})

test('自引判定：默认禁区与边界', () => {
  const rules = selfRefRules({})
  assert.equal(classifySelfReference('.fp/ledgers/a.md', null, rules)?.kind, 'ledger')
  assert.equal(classifySelfReference('docs/DIRECTION.md', null, rules)?.kind, 'decision')
  assert.equal(classifySelfReference('docs/adr/0001.md', null, rules)?.kind, 'decision')
  assert.equal(classifySelfReference('plugin/src/ledger.js', null, rules), null, '普通代码不是自引')
  assert.equal(classifySelfReference('README.md', null, rules), null, 'README 仍可当事实来源')
  assert.equal(classifySelfReference('a.md', 'a.md', rules)?.kind, 'self')
})


test('示例台账 examples/trial-length.md 开箱通过（业务决策，非本插件自身）', () => {
  const root = path.join(here, '..')
  const ledgerPath = path.join(root, 'examples', 'trial-length.md')
  const report = checkLedger({ cwd: root, text: readFileSync(ledgerPath, 'utf8'), ledgerPath })
  assert.equal(report.verdict, 'pass', JSON.stringify(report.errors))
  assert.equal(report.errors.length, 0)
  assert.equal(report.warnings.length, 0, JSON.stringify(report.warnings))
  assert.equal(report.counts.facts, report.counts.factsVerified, '每条事实都应逐字核对通过')
})

test('示例台账被改一个数字就报 E006（业务场景同样生效）', () => {
  const root = path.join(here, '..')
  const ledgerPath = path.join(root, 'examples', 'trial-length.md')
  const text = readFileSync(ledgerPath, 'utf8').replace('"trial_to_paid_pct": 18,', '"trial_to_paid_pct": 41,')
  const report = checkLedger({ cwd: root, text, ledgerPath })
  assert.equal(report.verdict, 'fail')
  assert.ok(codes(report).includes('E006'))
})
