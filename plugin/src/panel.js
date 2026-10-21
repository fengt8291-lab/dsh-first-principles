import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { checkLedger } from './ledger.js'
import { readRuns, summarizeRuns } from './runs.js'
import { readGateEvents, summarizeGate } from './gate.js'
import { anchorDigest, buildAnchor } from './anchor.js'

/**
 * UI 面板的数据源：把 `.fp/` 下的台账、`runs.jsonl`、`gate.jsonl` 压成一份 JSON。
 *
 * 这里只做纯函数式的读取与归纳，HTTP 和渲染分别在 index.js 与 client.js。
 * 「每一轮对话修了哪些错」= 同一份台账连续两次校验的错误码差集，
 * 所以从 M4 起就在记 runs.jsonl（没有历史就写不出这段故事）。
 */

export const MAX_PANEL_LEDGERS = 100

/** 列出台账文件；读不到目录返回空数组，永不抛错。 */
export function listLedgerFiles(root, dirName = '.fp') {
  const dir = path.join(root, dirName, 'ledgers')
  let names
  try {
    names = readdirSync(dir).filter((entry) => entry.endsWith('.md'))
  } catch {
    return []
  }
  const found = []
  for (const entry of names.slice(0, MAX_PANEL_LEDGERS)) {
    const absolute = path.join(dir, entry)
    try {
      found.push({ name: entry, path: absolute, mtime: statSync(absolute).mtimeMs })
    } catch {
      /* 读不到就跳过 */
    }
  }
  return found.sort((left, right) => right.mtime - left.mtime)
}

function ledgerSummary(root, dirName, ledger, settings) {
  try {
    const text = readFileSync(ledger.path, 'utf8')
    const report = checkLedger({
      cwd: root,
      text,
      ledgerPath: ledger.path,
      options: { maxFileBytes: settings.maxFileBytes },
    })
    return {
      name: ledger.name,
      path: path.relative(root, ledger.path),
      verdict: report.verdict,
      errors: (report.errors ?? []).map((item) => item.code),
      warnings: (report.warnings ?? []).map((item) => item.code),
      counts: report.counts ?? {},
      meta: {
        reviewAfter: report.meta?.reviewAfter ?? null,
        expired: Boolean(report.meta?.expired),
        daysLeft: report.meta?.daysLeft ?? null,
        kill: report.meta?.kill ?? null,
      },
      mtime: ledger.mtime,
    }
  } catch {
    return { name: ledger.name, path: path.relative(root, ledger.path), verdict: 'unreadable', errors: [], warnings: [], counts: {}, meta: null, mtime: ledger.mtime }
  }
}

/**
 * 同台账相邻两次校验的错误码差集 → 「这一轮修了什么」。
 * 只有真正变化（修掉/新增）才产生一条，避免把「又跑了一遍」也算成一轮。
 */
export function deriveFixRounds(runs = [], limit = 12) {
  const byLedger = new Map()
  for (const run of runs) {
    const key = typeof run.ledger === 'string' && run.ledger ? run.ledger : '(inline)'
    const list = byLedger.get(key) ?? []
    list.push(run)
    byLedger.set(key, list)
  }
  const rounds = []
  for (const [ledger, list] of byLedger) {
    for (let index = 1; index < list.length; index += 1) {
      const previous = list[index - 1]
      const current = list[index]
      const before = new Set(Array.isArray(previous.errors) ? previous.errors : [])
      const after = new Set(Array.isArray(current.errors) ? current.errors : [])
      const fixed = [...before].filter((code) => !after.has(code))
      const added = [...after].filter((code) => !before.has(code))
      if (fixed.length === 0 && added.length === 0) continue
      rounds.push({
        ledger,
        ts: current.ts ?? null,
        before: [...before],
        after: [...after],
        fixed,
        added,
        verdict: current.verdict ?? null,
        facts: current.facts ?? null,
      })
    }
  }
  return rounds.sort((left, right) => String(right.ts ?? '').localeCompare(String(left.ts ?? ''))).slice(0, limit)
}

function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 最近 N 天的校验量/失败量/修掉数，喂给面板底部那条趋势。 */
export function deriveTrend(runs = [], { days = 14, now = new Date() } = {}) {
  const buckets = new Map()
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now)
    date.setDate(date.getDate() - index)
    const key = dayKey(date)
    buckets.set(key, { date: key, total: 0, failed: 0, fixed: 0 })
  }
  const codesByDay = new Map()
  for (const run of runs) {
    const key = dayKey(run?.ts)
    const bucket = buckets.get(key)
    if (!bucket) continue
    bucket.total += 1
    if (run?.verdict !== 'pass') bucket.failed += 1
    for (const code of Array.isArray(run?.errors) ? run.errors : []) {
      const counts = codesByDay.get(key) ?? new Map()
      counts.set(code, (counts.get(code) ?? 0) + 1)
      codesByDay.set(key, counts)
    }
  }
  for (const round of deriveFixRounds(runs, 1000)) {
    const bucket = buckets.get(dayKey(round?.ts))
    if (bucket) bucket.fixed += round.fixed.length
  }
  for (const day of buckets.values()) {
    const counts = codesByDay.get(day.date)
    day.codes = counts
      ? [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5).map(([code, count]) => ({ code, count }))
      : []
  }
  return [...buckets.values()]
}

/** 历史上最常被拦下的错误码：用来回答「这东西到底帮我抓到了什么」。 */
export function topErrorCodes(runs = [], limit = 6) {
  const counts = new Map()
  for (const run of runs) {
    for (const code of Array.isArray(run?.errors) ? run.errors : []) {
      counts.set(code, (counts.get(code) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([code, count]) => ({ code, count }))
}

/** 面板一次要的全部数据；sessionId 给了就只看这个会话的校验记录。 */
export const PANEL_VERSION = '0.5.0'

export function buildPanelState({ root, settings, gateEnabled, sessionId = null, roundsLimit = 12, runsLimit = 30 }) {
  const dirName = settings?.dir ?? '.fp'
  const allRuns = readRuns(root, dirName)
  const runs = sessionId ? allRuns.filter((run) => !run.session || run.session === sessionId) : allRuns
  const ledgers = listLedgerFiles(root, dirName).map((ledger) => ledgerSummary(root, dirName, ledger, settings ?? {}))
  const expired = ledgers.filter((ledger) => ledger.meta?.expired).length
  const gateEvents = readGateEvents(root, dirName, 8)
  const files = listLedgerFiles(root, dirName)
  const anchor = anchorDigest(buildAnchor(root, files, { limit: 1 }), 'zh')
  return {
    version: PANEL_VERSION,
    project: root,
    dir: dirName,
    gate: { enabled: Boolean(gateEnabled), summary: summarizeGate(gateEvents) },
    ledgers,
    summary: { ...summarizeRuns(runs), ledgers: ledgers.length, expired },
    rounds: deriveFixRounds(runs, roundsLimit),
    trend: deriveTrend(runs),
    topCodes: topErrorCodes(runs),
    anchor,
    anchorEntries: files.length,
    recent: runs.slice(-runsLimit).reverse(),
    gateEvents,
    generatedAt: new Date().toISOString(),
  }
}

/** 面板顶上那行字：短到能塞进 composer 下方，不抢对话区。 */
export function panelHeadline(state, language = 'zh') {
  const summary = state?.summary ?? {}
  const failed = summary.failed ?? 0
  const total = summary.total ?? 0
  const gate = state?.gate?.enabled ? (language === 'en' ? 'gate on' : '闸门开') : language === 'en' ? 'gate off' : '闸门关'
  if (language === 'en') {
    return `first principles · ${gate} · ${total} checks · ${failed} blocked · ${(state?.ledgers ?? []).length} ledgers`
  }
  return `第一性原理 · ${gate} · ${total} 次校验 · 拦下 ${failed} · ${(state?.ledgers ?? []).length} 份台账`
}
