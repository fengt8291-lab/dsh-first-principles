import { summarize } from './ledger.js'

function bullet(item) {
  const head = `- ${item.code}${item.at && item.at !== 'ledger' ? ` ${item.at}` : ''}: ${item.message}`
  return item.hint ? `${head}\n  ↳ ${item.hint}` : head
}

/** 「复查」这一行：让过期这件事在报告里就看得见，而不是等谁想起来去看。 */
export function describeMeta(value) {
  const meta = value?.meta
  if (!meta) return null
  const parts = []
  if (meta.reviewAfter) {
    if (meta.expired) parts.push(`已过期 ${Math.abs(meta.daysLeft)} 天（review_after: ${meta.reviewAfter}）`)
    else if (meta.daysLeft !== null) parts.push(`复查日期 ${meta.reviewAfter}（还有 ${meta.daysLeft} 天）`)
    else parts.push(`复查日期 ${meta.reviewAfter}`)
  }
  if (typeof meta.confidence === 'number') parts.push(`置信度 ${Math.round(meta.confidence * 100)}%`)
  if (meta.kill) parts.push(`止损：${meta.kill}`)
  return parts.length ? parts.join(' · ') : null
}

function renderCheck(value) {
  const lines = []
  const counts = value.counts ?? {}
  const verdict = String(value.verdict ?? '').toUpperCase()
  const where = value.ledgerPath ? ` · ${value.ledgerPath}` : ''
  lines.push(`LEDGER ${verdict} · ${value.errors?.length ?? 0} error(s), ${value.warnings?.length ?? 0} warning(s)${where}`)
  lines.push(summarize({ counts }))
  const metaLine = describeMeta(value)
  if (metaLine) lines.push(metaLine)
  if (value.rootNote) lines.push(value.rootNote)
  if (value.errors?.length) {
    lines.push('')
    lines.push('errors:')
    for (const item of value.errors) lines.push(bullet(item))
  }
  if (value.warnings?.length) {
    lines.push('')
    lines.push('warnings:')
    for (const item of value.warnings) lines.push(bullet(item))
  }
  lines.push('')
  if (value.verdict === 'pass') {
    lines.push(value.warnings?.length ? '可以动手了；上面的 warning 自己判断要不要处理。' : '可以动手了。')
  } else {
    lines.push('先改上面的 error，再调一次 first_principles_check。verdict=pass 之前不要动代码。')
  }
  return lines.join('\n')
}

function renderTemplate(value) {
  const lines = [`已生成台账骨架（尚未写入文件）：${value.path ?? ''}`, '']
  lines.push(value.markdown ?? '')
  for (const note of value.notes ?? []) lines.push(`· ${note}`)
  return lines.join('\n')
}

export function renderReport(value) {
  if (!value || typeof value !== 'object') return String(value ?? '')
  if (value.verdict === 'template') return renderTemplate(value)
  return renderCheck(value)
}

export function toContent(value) {
  return [{ type: 'text', text: renderReport(value) }]
}
