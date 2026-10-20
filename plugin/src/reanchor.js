import { createReader, normalize } from './evidence.js'
import { parseLedger } from './ledger.js'

/**
 * 重新锚定（reanchor）：台账里最脆的东西是行号。
 *
 * 代码一改，`F3 · src/a.ts:42` 就指到别的地方去了，但引文本身往往还在。
 * 这个模块只按引文原文去文件里找唯一的一行，再把行号改对；
 * 找不到、或者找到多处（说明引文不够具体）就报出来，让人手动处理——它不会猜。
 */

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function planReanchor({ cwd, text, maxBytes }) {
  const reader = createReader(cwd, { maxFileBytes: maxBytes })
  const parsed = parseLedger(text)
  const changes = []
  const unresolved = []
  for (const fact of parsed.facts) {
    if (!fact.id) continue
    if (!fact.citation || !fact.quote) {
      unresolved.push({ id: fact.id, reason: '缺少 路径:行 或引文，无法重锚' })
      continue
    }
    const { path: relative, start, end } = fact.citation
    const read = reader.lines(relative)
    if (read.error) {
      unresolved.push({ id: fact.id, path: relative, reason: read.message })
      continue
    }
    const needle = normalize(fact.quote)
    if (!needle) {
      unresolved.push({ id: fact.id, path: relative, reason: '引文为空' })
      continue
    }
    const hits = []
    const lines = read.normalized ?? read.lines.map((line) => normalize(line))
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].includes(needle)) hits.push(index + 1)
    }
    if (hits.length === 0) {
      unresolved.push({ id: fact.id, path: relative, reason: `引文在 ${relative} 里已经找不到了（文件可能改过）` })
      continue
    }
    if (hits.length > 1) {
      unresolved.push({ id: fact.id, path: relative, reason: `引文在 ${hits.length} 行都出现，无法唯一定位`, lines: hits.slice(0, 5) })
      continue
    }
    if (hits[0] !== start) {
      changes.push({ id: fact.id, path: relative, from: start, to: hits[0], span: Math.max(1, end - start + 1), quote: fact.quote })
    }
  }
  return { changes, unresolved, facts: parsed.facts.filter((fact) => fact.id).length }
}

/** 只改 `- <id> · path:old` 里的那一处行号，其余字节原样保留。 */
export function applyReanchor(text, changes) {
  if (!changes || changes.length === 0) return { text, applied: 0 }
  const byId = new Map(changes.map((change) => [change.id, change]))
  const lines = String(text ?? '').split('\n')
  let applied = 0
  const next = lines.map((line) => {
    const matched = /^(\s*[-*]\s+)([A-Za-z]\d{1,3})(?![0-9])(.*)$/.exec(line)
    if (!matched) return line
    const change = byId.get(matched[2].toUpperCase())
    if (!change) return line
    const oldToken = `${change.path}:${change.from}`
    const newToken = `${change.path}:${change.to}`
    if (!matched[3].includes(oldToken)) return line
    applied += 1
    return `${matched[1]}${matched[2]}${matched[3].replace(oldToken, newToken)}`
  })
  return { text: next.join('\n'), applied }
}

/** `/fp review 2026-11-20` 用：改写头部的 review_after，没有就插一行。 */
export function setReviewAfter(text, dateKey) {
  const lines = String(text ?? '').split('\n')
  let firstSection = lines.findIndex((line) => /^#{2,3}\s+/.test(line))
  if (firstSection < 0) firstSection = lines.length
  const reviewPattern = /^\s*(review[_-]?after|复查日期)\s*[:：]/
  for (let index = 0; index < firstSection; index += 1) {
    if (reviewPattern.test(lines[index])) {
      lines[index] = `review_after: ${dateKey}`
      return { text: lines.join('\n'), replaced: true }
    }
  }
  let insertAt = 0
  for (let index = 0; index < firstSection; index += 1) {
    if (/^\s*(scope|mode|question)\s*[:：]/.test(lines[index])) insertAt = index + 1
  }
  lines.splice(insertAt, 0, `review_after: ${dateKey}`)
  return { text: lines.join('\n'), replaced: false }
}
