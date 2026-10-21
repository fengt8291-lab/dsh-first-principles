import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseLedger } from './ledger.js'
import { daysUntil, parseDateKey, reviewKeyFromHeader } from './meta.js'

/**
 * 跨会话锚点：把最近几份台账的「问题 / 结论 / 未决 / 复查」抽出来，
 * 让新会话在动手前先看到上一次到底判了什么。
 *
 * 平台限制（实测这份 DSH 构建）：Agent 的公开接口只有 `{ id }`，
 * 没有 per-agent 注入 prompt 的口子；`systemPrompt.context()` 的 AssembleContext
 * 也只有 `{ scope, signal }`，拿不到会话 cwd。所以锚点做成
 * 「工具参数 + 斜杠命令 + prompt 提示」三件套，而不是自动塞进系统提示。
 */

const MAX_TEXT = 160

function clip(text, max = MAX_TEXT) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function reviewOf(parsed, now) {
  const raw = reviewKeyFromHeader(parsed.header.extra)
  const date = parseDateKey(String(raw ?? ''))
  if (!date) return { reviewAfter: null, daysLeft: null, expired: false }
  const daysLeft = daysUntil(date, now)
  return { reviewAfter: String(raw).trim(), daysLeft, expired: daysLeft < 0 }
}

/** 从若干台账文件里抽出锚点条目，最新的在前。 */
export function buildAnchor(root, files, { limit = 3, conclusions = 5, open = 4, now = new Date() } = {}) {
  const entries = []
  for (const file of files.slice(0, limit)) {
    let parsed
    try {
      parsed = parseLedger(readFileSync(file.path, 'utf8'))
    } catch {
      continue
    }
    const review = reviewOf(parsed, now)
    entries.push({
      ledger: path.relative(root, file.path).split(path.sep).join('/'),
      name: file.name,
      question: clip(parsed.header.question, 200),
      mode: parsed.header.mode || null,
      conclusions: parsed.conclusion.filter((item) => item.id).slice(0, conclusions).map((item) => ({ id: item.id, text: clip(item.full) })),
      open: parsed.open.filter((item) => item.id).slice(0, open).map((item) => ({ id: item.id, text: clip(item.full) })),
      ...review,
    })
  }
  return { entries, generatedAt: new Date().toISOString() }
}

const CAVEAT = {
  zh: '下面这些是之前会话的判断，不是当前事实。要么接着用它，要么明确说明为什么换题——别假装没看见。',
  en: 'These are judgements from earlier sessions, not current facts. Either build on them or say explicitly why you are changing the question.',
}

/** 给模型/人看的一段文字。没有台账时返回空串。 */
export function renderAnchor(anchor, language = 'zh') {
  const entries = anchor?.entries ?? []
  if (entries.length === 0) return ''
  const en = language === 'en'
  const lines = [en ? CAVEAT.en : CAVEAT.zh]
  for (const entry of entries) {
    lines.push('')
    lines.push(en ? `Last judgement (${entry.ledger}):` : `上次的判断（${entry.ledger}）：`)
    if (entry.question) lines.push(`${en ? 'question' : '问题'}：${entry.question}`)
    if (entry.conclusions.length) {
      lines.push(en ? 'Conclusions:' : '结论：')
      for (const item of entry.conclusions) lines.push(`- ${item.id} ${item.text}`)
    }
    if (entry.open.length) {
      lines.push(en ? 'Still open:' : '还没定的事：')
      for (const item of entry.open) lines.push(`- ${item.id} ${item.text}`)
    }
    if (entry.reviewAfter) {
      const when = entry.expired
        ? en ? `expired ${Math.abs(entry.daysLeft)}d ago` : `已过期 ${Math.abs(entry.daysLeft)} 天`
        : en ? `${entry.daysLeft}d left` : `还有 ${entry.daysLeft} 天`
      lines.push(`${en ? 'review' : '复查'}：${entry.reviewAfter}（${when}）`)
    }
  }
  return lines.join('\n')
}

/** 面板/doctor 用的一行摘要。 */
export function anchorDigest(anchor, language = 'zh') {
  const first = anchor?.entries?.[0]
  if (!first) return language === 'en' ? 'no ledger yet' : '还没有台账'
  const head = first.question || first.ledger
  const count = first.conclusions.length
  return language === 'en'
    ? `${count} conclusion(s) from ${first.ledger}: ${clip(head, 60)}`
    : `${count} 条结论，来自 ${first.ledger}：${clip(head, 60)}`
}
