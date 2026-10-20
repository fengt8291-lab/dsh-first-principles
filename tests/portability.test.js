// 可移植性：换一台电脑、换一种项目结构，这套东西还要能用。
// 这里的用例全部在临时目录里现搭项目，不依赖本仓库的形状。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { checkLedger } from '../plugin/src/ledger.js'
import { buildTemplate, probeProject } from '../plugin/src/template.js'
import { describeRoot, findProjectRoot } from '../plugin/src/root.js'
import { localDateKey } from '../plugin/src/meta.js'

function tempDir(prefix = 'fp-port-') {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

function write(root, relative, content) {
  const absolute = path.join(root, relative)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
  return absolute
}

function inDays(days) {
  return localDateKey(new Date(Date.now() + days * 86400000))
}

/** 一份最小可通过台账，只有事实那一条是可变的。 */
function ledger({ question, fact, scope = 'package.json', reviewAfter = inDays(30), kill = '出现反例就停下' }) {
  return [
    '# 第一性原理台账',
    `question: ${question}`,
    'mode: decision',
    `scope: ${scope}`,
    `review_after: ${reviewAfter}`,
    'confidence: 0.7',
    `kill: ${kill}`,
    '',
    '## Facts',
    fact,
    '',
    '## Assumptions',
    '- A1 · basis: inference · falsify: 看到相反的记录',
    '  这条假设撑住了后面所有推导',
    '',
    '## Open',
    '- O1 · probe: 读一次配置 · open',
    '',
    '## Derivation',
    '- D1 · from F1,A1',
    '  先确认事实，再谈结论',
    '',
    '## Conclusion',
    '- C1 · depends: D1',
    '  结论是可执行的一句话',
    '',
    '## Revisit',
    '- R1 · A1',
    '  一旦 A1 被推翻就重算',
    '',
  ].join('\n')
}

const check = (cwd, text) => checkLedger({ cwd, text, ledgerPath: path.join(cwd, '.fp', 'ledgers', 'x.md') })

test('Python 项目：从 pyproject.toml 定位根，骨架里的引用能逐字核对', () => {
  const root = tempDir()
  write(root, 'pyproject.toml', '[project]\nname = "smoke-py"\nversion = "0.1.0"\n')
  write(root, 'src/app/main.py', 'def main():\n    return 1\n')

  const found = findProjectRoot(path.join(root, 'src', 'app'))
  assert.equal(found.root, root)
  assert.equal(found.foundBy, 'marker')

  const facts = probeProject(root)
  assert.ok(facts.length >= 1)
  const factLine = `- F1 · ${facts[0].path}:${facts[0].line} · \`${facts[0].text}\``

  const template = buildTemplate({ cwd: root, facts })
  assert.match(template, /pyproject\.toml:\d+/)
  const report = check(root, ledger({ question: '这个 Python 项目要不要拆包', fact: factLine, scope: 'pyproject.toml' }))
  assert.equal(report.verdict, 'pass', JSON.stringify(report.errors, null, 2))
})

test('Go / Rust 项目：认 go.mod、Cargo.toml，不会因为没有 package.json 就放弃', () => {
  const goRoot = tempDir()
  write(goRoot, 'go.mod', 'module example.com/smoke\n\ngo 1.22\n')
  write(goRoot, 'main.go', 'package main\n\nfunc main() {}\n')
  assert.equal(findProjectRoot(path.join(goRoot, 'internal', 'x')).root, goRoot)
  const goFacts = probeProject(goRoot)
  assert.ok(goFacts.some((item) => item.path === 'go.mod'))

  const rustRoot = tempDir()
  write(rustRoot, 'Cargo.toml', '[package]\nname = "smoke-rs"\nversion = "0.1.0"\n')
  write(rustRoot, 'src/main.rs', 'fn main() {}\n')
  assert.equal(findProjectRoot(rustRoot).root, rustRoot)
  for (const item of probeProject(rustRoot)) {
    const report = check(rustRoot, ledger({ question: 'Rust 项目要不要引入异步运行时', fact: `- F1 · ${item.path}:${item.line} · \`${item.text}\``, scope: item.path }))
    assert.equal(report.verdict, 'pass', `${item.path}:${item.line} -> ${JSON.stringify(report.errors)}`)
  }
})

test('路径里有空格和中文：引用照样能落到真实文件', () => {
  const root = tempDir()
  write(root, 'package.json', JSON.stringify({ name: 'spaced-app' }, null, 2))
  write(root, '我的 模块/核心 逻辑.ts', 'const 上限 = 1800\n')
  write(root, '.fp/ledgers/x.md', '')

  const report = check(root, ledger({ question: '冷却窗口该设多长', fact: '- F1 · 我的 模块/核心 逻辑.ts:1 · `const 上限 = 1800`', scope: '我的 模块/核心 逻辑.ts' }))
  assert.equal(report.verdict, 'pass', JSON.stringify(report.errors, null, 2))
})

test('Windows 风格的反斜杠引用：归一成正斜杠后照样能校验', () => {
  const root = tempDir()
  write(root, 'src/auth/session.ts', 'export const TTL = 3600\n')
  const report = check(root, ledger({ question: 'TTL 该由谁决定', fact: '- F1 · src\\auth\\session.ts:1 · `export const TTL = 3600`', scope: 'src/auth/session.ts' }))
  assert.equal(report.verdict, 'pass', JSON.stringify(report.errors, null, 2))
})

test('没有任何项目标记的裸目录：回落到当前目录，不抛异常', () => {
  const root = tempDir()
  write(root, 'notes.txt', '随手记的一句话\n')
  const found = findProjectRoot(root)
  assert.equal(found.root, root)
  assert.equal(found.foundBy, 'cwd')
  assert.equal(describeRoot(found), '根目录＝当前目录')

  const facts = probeProject(root)
  const template = buildTemplate({ cwd: root, facts })
  assert.match(template, /## Facts/)
})

test('自定义台账目录名：dir=meta/fp 也能定位，不被 .fp 抢走', () => {
  const root = tempDir()
  mkdirSync(path.join(root, 'meta', 'fp'), { recursive: true })
  mkdirSync(path.join(root, 'pkg', 'sub'), { recursive: true })
  write(root, 'pkg/sub/file.ts', 'export const X = 1\n')

  const found = findProjectRoot(path.join(root, 'pkg', 'sub'), { dir: 'meta/fp' })
  assert.equal(found.root, root)
  assert.equal(found.foundBy, 'ledger-dir')
})

test('monorepo：子包自带 package.json 就近停下，台账写进子包而不是外层', () => {
  const root = tempDir()
  write(root, 'package.json', JSON.stringify({ name: 'outer-app' }, null, 2))
  write(root, 'packages/a/package.json', JSON.stringify({ name: 'inner-lib' }, null, 2))
  write(root, 'packages/a/src/index.ts', 'export const inner = true\n')

  const found = findProjectRoot(path.join(root, 'packages', 'a', 'src'))
  assert.equal(found.root, path.join(root, 'packages', 'a'))
  assert.equal(found.foundBy, 'marker')
})
