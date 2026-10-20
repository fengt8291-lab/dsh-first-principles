import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 运行记录（`.fp/runs.jsonl`）：每次真实校验追加一行。
 *
 * 这是「纠错统计」可视化唯一的数据源，所以从 M4 就开始记，
 * 免得以后做前端时发现没有历史数据。一条一行、只追加、坏行跳过。
 */
export const RUNS_FILE = 'runs.jsonl'
export const MAX_RUNS = 20000
export const MAX_RUNS_BYTES = 4 * 1024 * 1024

export function runsPath(cwd, dirName = '.fp') {
  return path.join(cwd, dirName, RUNS_FILE)
}

function tailLines(text, keep) {
  const lines = text.split('\n').filter(Boolean)
  return lines.slice(Math.max(0, lines.length - keep)).join('\n') + (lines.length ? '\n' : '')
}

/** 追加一条运行记录；任何失败都静默——统计不能影响校验本身。 */
export function appendRun(cwd, dirName, record) {
  const file = runsPath(cwd, dirName)
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8')
    if (statSync(file).size > MAX_RUNS_BYTES) {
      const text = readFileSync(file, 'utf8')
      writeFileSync(file, tailLines(text, MAX_RUNS), 'utf8')
    }
    return true
  } catch {
    return false
  }
}

/** 读全部运行记录；坏行跳过，不抛错。 */
export function readRuns(cwd, dirName = '.fp') {
  const file = runsPath(cwd, dirName)
  if (!existsSync(file)) return []
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const runs = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed === 'object') runs.push(parsed)
    } catch {
      /* 坏行跳过 */
    }
  }
  return runs
}

function dayKey(timestamp) {
  const date = timestamp ? new Date(timestamp) : null
  if (!date || Number.isNaN(date.getTime())) return null
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 汇总：总次数、通过率、错误码分布、按天分布。 */
export function summarizeRuns(runs = []) {
  const total = runs.length
  const passed = runs.filter((run) => run.verdict === 'pass').length
  const codeCounts = new Map()
  const byDay = new Map()
  let firstSeen = null
  let lastSeen = null
  for (const run of runs) {
    for (const code of Array.isArray(run.errors) ? run.errors : []) {
      codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1)
    }
    const day = dayKey(run.ts)
    if (day) {
      const bucket = byDay.get(day) ?? { day, total: 0, pass: 0 }
      bucket.total += 1
      if (run.verdict === 'pass') bucket.pass += 1
      byDay.set(day, bucket)
    }
    if (run.ts) {
      if (!firstSeen || run.ts < firstSeen) firstSeen = run.ts
      if (!lastSeen || run.ts > lastSeen) lastSeen = run.ts
    }
  }
  const topCodes = [...codeCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([code, count]) => ({ code, count }))
  return {
    total,
    passed,
    failed: total - passed,
    passRate: total ? Math.round((passed / total) * 1000) / 1000 : 0,
    topCodes,
    byDay: [...byDay.values()].sort((left, right) => left.day.localeCompare(right.day)).slice(-14),
    firstSeen,
    lastSeen,
  }
}

/** `/fp stats` 的纯文本版本；以后的可视化面板读同一份 summarizeRuns 结果。 */
export function renderStats(summary, { ledgers = 0, expired = 0, dirName = '.fp' } = {}) {
  if (!summary || summary.total === 0) {
    return `还没有运行记录（${dirName}/runs.jsonl 为空）。跑一次 first_principles_check 就会开始记。`
  }
  const lines = [
    `运行记录：${summary.total} 次 · 通过 ${summary.passed} · 未通过 ${summary.failed} · 通过率 ${Math.round(summary.passRate * 100)}%`,
    `台账：${ledgers} 份${expired ? ` · 其中 ${expired} 份已到期未复查` : ''}`,
  ]
  if (summary.topCodes.length) lines.push(`被拦下的错误码：${summary.topCodes.map((item) => `${item.code}×${item.count}`).join(' · ')}`)
  const days = summary.byDay
  if (days.length) {
    lines.push('最近几天：')
    for (const day of days) lines.push(`- ${day.day}: ${day.total} 次（通过 ${day.pass}）`)
  }
  return lines.join('\n')
}
