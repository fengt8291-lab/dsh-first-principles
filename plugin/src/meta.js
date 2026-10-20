/**
 * 复查字段：`review_after` / `confidence` / `kill`。
 *
 * 为什么需要它们：
 *  - 一条没有「什么时候必须重看」的结论，等于宣布自己永远正确（W007 在到期时提醒）；
 *  - 一条说不清自己有多确定的结论，会被人当成 100% 确定（confidence 允许写 0.6）；
 *  - 一条没有 kill criteria 的投入，最后会用「再坚持一下」替代判断（kill 只记录、不阻拦）。
 *
 * 时间只按「本地日历日」比较，不碰时区：账台上写 2026-11-20，就按使用者本地的这一天算。
 */

export const DEFAULT_REVIEW_KEY = 'review_after'

/** 本地日历日 YYYY-MM-DD（不用 toISOString，避免 UTC 偏移把日期推前/推后一天）。 */
export function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 只接受 YYYY-MM-DD，且必须是真实存在的日期（2026-02-30 不算）。 */
export function parseDateKey(value) {
  const matched = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value ?? '').trim())
  if (!matched) return null
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const probe = new Date(year, month - 1, day)
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null
  return {
    key: `${matched[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    time: probe.getTime(),
  }
}

/** 正数表示还剩几天，负数表示已经过期几天。 */
export function daysUntil(targetKey, today = new Date()) {
  const parsed = typeof targetKey === 'string' ? parseDateKey(targetKey) : targetKey
  if (!parsed) return null
  const todayParsed = parseDateKey(localDateKey(today))
  return Math.round((parsed.time - todayParsed.time) / 86400000)
}

/** 接受 0.7 / .7 / 1 / 85% ；返回 0–1 的数字，非法返回 null。 */
export function parseConfidence(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const percent = /^(\d{1,3}(?:\.\d+)?)\s*%$/.exec(raw)
  if (percent) {
    const number = Number(percent[1])
    return number >= 0 && number <= 100 ? Math.round((number / 100) * 1000) / 1000 : null
  }
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?|\.\d+)$/.test(raw)) return null
  const number = Number(raw)
  return number >= 0 && number <= 1 ? number : null
}

/** 从条目正文里取 `confidence: 0.7`，没有就返回 undefined。 */
export function extractConfidence(full) {
  const matched = /confidence\s*[:：]\s*([\w.%]+)/i.exec(String(full ?? ''))
  return matched ? matched[1] : undefined
}

/** 从条目正文里取 `review_after: 2026-11-20`。 */
export function extractReviewAfter(full) {
  const matched = /review[_-]?after\s*[:：]\s*([0-9-]+)/i.exec(String(full ?? ''))
  return matched ? matched[1] : undefined
}

/** 头部字段名容错：`review_after` / `review-after` / `复查日期`。 */
export function reviewKeyFromHeader(extra = {}) {
  const candidates = ['review_after', 'review-after', 'reviewafter', '复查日期', '复查', 'revisit_after']
  for (const key of candidates) {
    const value = extra[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export function killFromHeader(extra = {}) {
  const candidates = ['kill', 'kill_criteria', 'kill-criteria', '止损条件', '中止条件']
  for (const key of candidates) {
    const value = extra[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export function confidenceFromHeader(extra = {}) {
  const candidates = ['confidence', '置信度', '把握']
  for (const key of candidates) {
    const value = extra[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}
