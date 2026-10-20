import { createReader, extractCitation, extractQuote, fileMtime, globToRegExp, normalize, resolveScope, truncate, verifyFact } from './evidence.js'
import { confidenceFromHeader, daysUntil, extractConfidence, killFromHeader, localDateKey, parseConfidence, parseDateKey, reviewKeyFromHeader } from './meta.js'

/**
 * 自引禁区：这些位置的东西是「结论」，不是「证据」。
 * 台账引用它们，等于用自己的结论证明自己的结论。
 */
export const DEFAULT_SELF_REF_DENY = ['.fp/**', '**/DIRECTION.md', '**/DECISIONS.md', '**/adr/**', '**/ADR/**']

const SELF_REF_TEXT = {
  ledger: {
    message: (path) => `事实引用了台账目录里的 ${path}：台账不能当证据`,
    hint: '台账是结论的产物；要引就引产生它的原始材料（代码、日志、外部材料），不要把「上次的决定」当成「这次的事实」',
  },
  decision: {
    message: (path) => `事实引用了决策文档 ${path}：这是用结论证明结论`,
    hint: '决策文档是本次决策的产物；去引它背后的原始材料，或者把这条从 Facts 挪到 Conclusion',
  },
  self: {
    message: (path) => `事实引用了本次台账自身（${path}）`,
    hint: '自引用不是证据；把这条换成台账外部、可被独立打开核对的材料',
  },
}

function toPosix(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function kindOfPattern(pattern) {
  return /DIRECTION\.md$|DECISIONS?\.md$|adr/i.test(pattern) ? 'decision' : 'ledger'
}

export const DEFAULT_SELF_REF_RULES = DEFAULT_SELF_REF_DENY.map((pattern) => ({ regex: globToRegExp(pattern), kind: kindOfPattern(pattern) }))

/** 头部可以写 `self_ref_deny: 模式1, 模式2` 覆盖默认禁区；写 `self_ref_deny: -` 表示不设禁区。 */
export function selfRefRules(extra = {}) {
  const declared = extra?.self_ref_deny ?? extra?.['self-ref-deny']
  if (declared === undefined) return DEFAULT_SELF_REF_RULES
  return String(declared)
    .split(/\s*[,，、]\s*/)
    .filter((pattern) => pattern && pattern !== '-')
    .map((pattern) => ({ regex: globToRegExp(pattern), kind: kindOfPattern(pattern) }))
}

export function classifySelfReference(citationPath, ledgerPath, rules = DEFAULT_SELF_REF_RULES) {
  if (!citationPath) return null
  const path = toPosix(citationPath)
  if (!path) return null
  if (ledgerPath && toPosix(ledgerPath) === path) return { kind: 'self', path }
  for (const rule of rules) if (rule.regex.test(path)) return { kind: rule.kind, path }
  return null
}

export const MODES = new Set(['decision', 'diagnosis', 'exploration'])
export const BASES = new Set(['definition', 'inference', 'convention', 'external', '定义', '推断', '约定', '外部'])

const SECTION_ALIASES = {
  facts: ['facts', 'fact', '事实'],
  assumptions: ['assumptions', 'assumption', '假设', '假定'],
  open: ['open', 'open questions', 'open items', '待查', '未决', '开放问题'],
  derivation: ['derivation', 'derivations', '推导', '推理'],
  conclusion: ['conclusion', 'conclusions', '结论'],
  revisit: ['revisit', 'revisit conditions', '失效条件', '何时作废', '重访', '何时重估'],
}

const SPLIT_RE = /\s*·\s*|\s+\|\s+/

function splitFields(text) {
  return String(text ?? '')
    .split(SPLIT_RE)
    .map((field) => field.trim())
    .filter(Boolean)
}

function sectionKey(title) {
  const cleaned = String(title ?? '')
    .toLowerCase()
    .replace(/[*_`：:（）()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.includes(cleaned)) return key
  }
  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.some((alias) => cleaned.startsWith(alias))) return key
  }
  return null
}

function splitScope(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return []
  // 有逗号就只按逗号拆，这样「我的 模块/核心 逻辑.ts」这种带空格的文件名不会被拆碎；
  // 没有逗号时整串就是一个模式。
  const parts = /[,，、]/.test(raw) ? raw.split(/[,，、]+/) : [raw]
  return parts.map((part) => part.trim()).filter(Boolean)
}

function refList(text) {
  const matched = /([A-Za-z]\d{1,3}(?:\s*[,，、]\s*[A-Za-z]\d{1,3})*)/.exec(String(text ?? ''))
  if (!matched) return []
  return matched[1]
    .split(/\s*[,，、]\s*/)
    .map((ref) => ref.toUpperCase())
    .filter(Boolean)
}

function buildRecord(kind, raw, position) {
  const fields = splitFields(raw.text)
  const head = fields[0] ?? ''
  const idMatch = /^([A-Za-z])\s*(\d{1,3})(?![0-9])/.exec(head)
  const id = idMatch ? `${idMatch[1].toUpperCase()}${idMatch[2]}` : null
  const rest = (idMatch ? fields.slice(1) : fields).filter(Boolean)
  const full = [...rest, ...raw.body].join(' ').trim()
  return { kind, id, position, rest, full, raw: raw.text }
}

export function parseLedger(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const header = { question: '', mode: '', scope: [], extra: {} }
  const rawSections = { facts: [], assumptions: [], open: [], derivation: [], conclusion: [], revisit: [] }
  const present = new Set()
  let currentSection = null
  let currentItem = null

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const heading = /^#{2,3}\s+(.+?)\s*$/.exec(line)
    if (heading) {
      currentSection = sectionKey(heading[1])
      currentItem = null
      if (currentSection) present.add(currentSection)
      continue
    }
    if (!currentSection) {
      if (!line.trim() || line.trim().startsWith('#')) continue
      const field = /^([A-Za-z][\w-]*)\s*[:：]\s*(.*)$/.exec(line)
      if (!field) continue
      const key = field[1].toLowerCase()
      const value = field[2].trim()
      if (key === 'scope') header.scope.push(...splitScope(value))
      else if (key === 'question') header.question = value
      else if (key === 'mode') header.mode = value.toLowerCase()
      else header.extra[key] = value
      continue
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      currentItem = { text: bullet[1].trim(), body: [] }
      rawSections[currentSection].push(currentItem)
      continue
    }
    if (currentItem && line.trim()) currentItem.body.push(line.trim())
  }

  const facts = rawSections.facts.map((raw, index) => {
    const record = buildRecord('fact', raw, index)
    return { ...record, citation: extractCitation(record.rest), quote: extractQuote(record.rest) }
  })
  const assumptions = rawSections.assumptions.map((raw, index) => {
    const record = buildRecord('assumption', raw, index)
    const basis = /basis\s*[:：]\s*([\w\u4e00-\u9fa5]+)/i.exec(record.full)?.[1]?.toLowerCase() ?? null
    const falsify = /falsify\s*[:：]\s*(.+)$/i.exec(record.full)?.[1]?.trim() ?? null
    return { ...record, basis, falsify }
  })
  const open = rawSections.open.map((raw, index) => {
    const record = buildRecord('open', raw, index)
    const probe = /probe\s*[:：]\s*([^·|]*)/i.exec(record.full)?.[1]?.trim() ?? record.full
    const resolved = /resolved\s*\(\s*([^)]*)\s*\)/i.exec(record.full)
    const deferred = /deferred\s*\(\s*([^)]*)\s*\)/i.exec(record.full)
    let status = null
    let resolvedBy = null
    let deferredReason = null
    if (resolved) {
      status = 'resolved'
      resolvedBy = resolved[1].toUpperCase()
    } else if (deferred) {
      status = 'deferred'
      deferredReason = deferred[1]
    } else if (/\bopen\b/i.test(record.full)) {
      status = 'open'
    }
    return { ...record, probe, status, resolvedBy, deferredReason }
  })
  const derivation = rawSections.derivation.map((raw, index) => {
    const record = buildRecord('derivation', raw, index)
    const from = refList(/(?:from|依据|源自)\s*[:：]?\s*([A-Za-z]\d{1,3}(?:\s*[,，、]\s*[A-Za-z]\d{1,3})*)/i.exec(record.full)?.[1] ?? '')
    return { ...record, from }
  })
  const conclusion = rawSections.conclusion.map((raw, index) => {
    const record = buildRecord('conclusion', raw, index)
    const depends = refList(/(?:depends?|依赖)\s*[:：]?\s*([A-Za-z]\d{1,3}(?:\s*[,，、]\s*[A-Za-z]\d{1,3})*)/i.exec(record.full)?.[1] ?? '')
    return { ...record, depends }
  })
  const revisit = rawSections.revisit.map((raw, index) => {
    const record = buildRecord('revisit', raw, index)
    const refs = [...record.full.matchAll(/\b([AR]\d{1,3})\b/g)]
      .map((matched) => matched[1].toUpperCase())
      .filter((ref) => ref !== record.id)
    return { ...record, refs: [...new Set(refs)] }
  })

  return {
    header,
    present,
    facts,
    assumptions,
    open,
    derivation,
    conclusion,
    revisit,
    items: [...facts, ...assumptions, ...open, ...derivation, ...conclusion, ...revisit],
  }
}

function closureOf(id, graph, seen = new Set()) {
  if (seen.has(id)) return seen
  seen.add(id)
  for (const ref of graph.get(id) ?? []) closureOf(ref, graph, seen)
  return seen
}

function findCycle(graph) {
  const state = new Map()
  const stack = []
  let cycle = null
  const visit = (id) => {
    if (cycle) return
    const seen = state.get(id) ?? 0
    if (seen === 2) return
    if (seen === 1) {
      cycle = [...stack.slice(stack.indexOf(id)), id]
      return
    }
    state.set(id, 1)
    stack.push(id)
    for (const ref of graph.get(id) ?? []) if (graph.has(ref)) visit(ref)
    stack.pop()
    state.set(id, 2)
  }
  for (const id of graph.keys()) visit(id)
  return cycle
}

function emptyMeta(now = new Date()) {
  return { reviewAfter: null, confidence: null, kill: null, daysLeft: null, expired: false, today: localDateKey(now) }
}

const DEFAULT_LIMITS = {
  maxLedgerBytes: 4 * 1024 * 1024,
  maxItems: 5000,
  maxFileBytes: undefined,
  maxEntries: undefined,
  now: null,
}

const EMPTY_COUNTS = {
  facts: 0,
  factsVerified: 0,
  assumptions: 0,
  assumptionsFalsifiable: 0,
  open: 0,
  derivations: 0,
  conclusions: 0,
}

/**
 * 对外入口：任何内部异常都收敛成一条 E021 报告，绝不把栈抛给会话。
 * 台账可能来自任何项目、任何大小，所以入口先做体积/条目数闸门，再进正式校验。
 */
export function checkLedger(input = {}) {
  const { cwd, text, ledgerPath = null, strict = false, options = {} } = input
  const limits = { ...DEFAULT_LIMITS, ...(options ?? {}) }
  const raw = String(text ?? '')
  const oversize = raw.length > limits.maxLedgerBytes
  try {
    return doCheck({ cwd, text: raw, ledgerPath, strict, limits, oversize })
  } catch (error) {
    return {
      verdict: 'fail',
      ledgerPath,
      header: { question: '', mode: '', scope: [] },
      counts: { ...EMPTY_COUNTS },
      meta: { reviewAfter: null, confidence: null, kill: null, daysLeft: null, expired: false },
      errors: [
        {
          code: 'E021',
          at: 'ledger',
          message: `台账解析失败：${truncate(error?.message ?? String(error), 160)}`,
          hint: '这通常是格式极端的情况（超大单行、异常编码）；请贴出这段台账以便复现',
        },
      ],
      warnings: [],
    }
  }
}

function doCheck({ cwd, text, ledgerPath = null, strict = false, limits, oversize = false }) {
  const errors = []
  const warnings = []
  const fail = (code, at, message, hint) => errors.push({ code, at, message, ...(hint ? { hint } : {}) })
  const warn = (code, at, message, hint) => warnings.push({ code, at, message, ...(hint ? { hint } : {}) })
  const now = limits.now instanceof Date ? limits.now : new Date()

  if (oversize) {
    fail('E020', 'ledger', `台账 ${Math.round(String(text ?? '').length / 1024)}KB，超过可校验上限 ${Math.round(limits.maxLedgerBytes / 1024)}KB`, '把它拆成几份台账（按问题拆），一份台账管一个决策')
    return { verdict: 'fail', ledgerPath, header: { question: '', mode: '', scope: [] }, counts: { ...EMPTY_COUNTS }, meta: emptyMeta(now), errors, warnings }
  }

  const reader = createReader(cwd, { maxFileBytes: limits.maxFileBytes })
  const parsed = parseLedger(text)

  if (parsed.items.length > limits.maxItems) {
    fail('E020', 'ledger', `台账有 ${parsed.items.length} 条，超过可校验上限 ${limits.maxItems} 条`, '一份台账管一个决策；条目数上千说明它已经不是台账，是知识库')
    return { verdict: 'fail', ledgerPath, header: { question: parsed.header.question, mode: parsed.header.mode, scope: parsed.header.scope }, counts: { ...EMPTY_COUNTS }, meta: emptyMeta(now), errors, warnings }
  }

  const missingHeader = []
  if (!parsed.header.question) missingHeader.push('question')
  if (!parsed.header.mode) missingHeader.push('mode')
  if (parsed.header.scope.length === 0) missingHeader.push('scope')
  if (missingHeader.length) {
    fail('E001', 'header', `台账头部缺少：${missingHeader.join(' / ')}`, '头部三行固定为 question: / mode: / scope:')
  } else if (!MODES.has(parsed.header.mode)) {
    fail('E001', 'header', `mode 只能是 decision / diagnosis / exploration，现在是「${parsed.header.mode}」`)
  }

  const reviewRaw = reviewKeyFromHeader(parsed.header.extra)
  let reviewAfter = null
  if (reviewRaw) {
    const parsedReview = parseDateKey(reviewRaw)
    if (!parsedReview) {
      fail('E019', 'header', `review_after 不是合法日期：「${reviewRaw}」`, '写成 YYYY-MM-DD，例如 review_after: 2026-11-20')
    } else {
      reviewAfter = parsedReview.key
      const daysLeft = daysUntil(reviewAfter, now)
      if (daysLeft !== null && daysLeft < 0) {
        warn('W007', 'header', `台账已过期 ${Math.abs(daysLeft)} 天（review_after: ${reviewAfter}）`, '重新核对事实行号与假设，再把 review_after 改到未来某天；过期不代表结论错，代表没人再看它')
      }
    }
  }

  const confidenceRaw = confidenceFromHeader(parsed.header.extra)
  let confidence = null
  if (confidenceRaw) {
    confidence = parseConfidence(confidenceRaw)
    if (confidence === null) fail('E018', 'header', `confidence 取值非法：「${confidenceRaw}」`, '写 0–1 的小数（0.7）或百分比（70%）')
  }
  const kill = killFromHeader(parsed.header.extra)

  let scopeFiles = new Set()
  if (parsed.header.scope.length) {
    const resolved = resolveScope(cwd, parsed.header.scope, { maxEntries: limits.maxEntries })
    scopeFiles = resolved.files
    for (const pattern of resolved.missing) {
      const hint = resolved.truncated
        ? '项目文件太多，扫描被截断，这个模式可能只是没扫到——把 scope 写得更具体，或直接写文件路径'
        : 'scope 是这次考核的观察范围，必须真实存在，例如 src/auth/**'
      fail('E002', 'header', `scope 匹配不到任何文件：${pattern}`, hint)
    }
  }

  const ids = new Set()
  const duplicates = []
  for (const item of parsed.items) {
    if (!item.id) {
      fail('E016', item.kind, `条目缺少编号：${truncate(item.raw, 40)}`, '每条以 F1 · / A1 · / O1 · / D1 · / C1 · / R1 · 开头')
      continue
    }
    if (ids.has(item.id)) duplicates.push(item.id)
    ids.add(item.id)
  }
  if (duplicates.length) fail('E016', 'ledger', `编号重复：${[...new Set(duplicates)].join(', ')}`)

  const selfRefRuleSet = selfRefRules(parsed.header.extra)
  let verifiedFacts = 0
  for (const fact of parsed.facts) {
    if (!fact.id) continue
    const selfRef = classifySelfReference(fact.citation?.path, ledgerPath, selfRefRuleSet)
    if (selfRef) {
      const text = SELF_REF_TEXT[selfRef.kind] ?? SELF_REF_TEXT.ledger
      if (/\[policy\]/i.test(fact.full ?? '')) {
        warn('W006', fact.id, `${text.message(selfRef.path)}（已用 [policy] 声明为项目自身的承诺）`, '只有「本项目自己定的规则/口径」才能这样豁免；对世界的判断不能用 policy 挡住')
      } else {
        fail('E017', fact.id, text.message(selfRef.path), `${text.hint}。若这条确实是项目自身的承诺/约束，在条目里标 [policy]，它会降级为警告 W006`)
        continue
      }
    }
    const verified = verifyFact(fact, reader)
    if (!verified.ok) {
      fail(verified.code, fact.id, verified.message, verified.hint)
      continue
    }
    verifiedFacts += 1
    if (verified.duplicated) {
      warn('W002', fact.id, '引文在文件里出现多次，行号不足以定位', '改用更难复现的原文，或引用更具体的一行')
    }
  }

  let falsifiableAssumptions = 0
  for (const item of parsed.assumptions) {
    if (!item.id) continue
    if (!item.basis) {
      fail('E007', item.id, '假设没有 basis', '可选：definition / inference / convention / external')
    } else if (!BASES.has(item.basis)) {
      fail('E007', item.id, `basis 值非法：「${item.basis}」`, '可选：definition / inference / convention / external')
    }
    if (!item.falsify || item.falsify.length < 4) {
      fail('E008', item.id, '假设没有 falsify（可证伪条件）', '写清「出现什么证据就说明这条假设是错的」；写不出来的通常不叫假设，叫愿望')
    } else {
      falsifiableAssumptions += 1
    }
  }

  for (const item of parsed.open) {
    if (!item.id) continue
    if (!item.status) {
      fail('E012', item.id, 'Open 项没有结束状态', '结尾写 resolved(F2) 或 deferred(原因)')
    } else if (item.status === 'resolved' && !item.resolvedBy) {
      fail('E012', item.id, 'resolved 必须落到具体证据上，例如 resolved(F2)')
    } else if (item.status === 'deferred' && !item.deferredReason) {
      fail('E012', item.id, 'deferred 必须写明推迟原因，例如 deferred(需要线上日志)')
    }
  }

  const graph = new Map()
  for (const item of parsed.derivation) {
    if (!item.id) continue
    if (item.from.length === 0) {
      fail('E009', item.id, '推导没有 from（依据哪些编号）', '写成 D1 · from F1,A1')
    }
    for (const ref of item.from) {
      if (!ids.has(ref)) fail('E009', item.id, `引用了不存在的编号 ${ref}`)
    }
    graph.set(item.id, item.from)
  }
  for (const item of parsed.conclusion) {
    if (!item.id) continue
    if (item.depends.length === 0) {
      fail('E011', item.id, '结论没有 depends（依赖哪些编号）', '写成 C1 · depends: D1,D2')
    }
    for (const ref of item.depends) {
      if (!ids.has(ref)) fail('E009', item.id, `引用了不存在的编号 ${ref}`)
    }
    const itemConfidence = extractConfidence(item.full)
    if (itemConfidence !== undefined && parseConfidence(itemConfidence) === null) {
      fail('E018', item.id, `confidence 取值非法：「${itemConfidence}」`, '写 0–1 的小数（0.7）或百分比（70%）')
    }
    graph.set(item.id, item.depends)
  }

  const cycle = findCycle(graph)
  if (cycle) fail('E010', cycle[0], `推导成环：${cycle.join(' → ')}`, '第一性原理要求推导是有向、可终止的')

  const usedFacts = new Set()
  for (const refs of graph.values()) for (const ref of refs) if (ref.startsWith('F')) usedFacts.add(ref)

  const revisitRefs = new Set(parsed.revisit.flatMap((item) => item.refs))
  for (const item of parsed.facts) {
    if (item.id && !usedFacts.has(item.id)) {
      warn('W001', item.id, '这条事实没有被任何推导或结论使用', '要么把它接进推导链，要么删掉——它现在只是背景噪音')
    }
  }

  for (const item of parsed.conclusion) {
    if (!item.id) continue
    const reachable = closureOf(item.id, graph)
    const assumptions = [...reachable].filter((ref) => ref.startsWith('A'))
    const facts = [...reachable].filter((ref) => ref.startsWith('F'))
    const orphan = assumptions.filter((ref) => !revisitRefs.has(ref))
    if (orphan.length) {
      fail('E014', item.id, `结论依赖的假设没有出现在 Revisit：${orphan.join(', ')}`, '在 Revisit 段列出这些假设，写明什么事件会让结论失效')
    }
    if (facts.length === 0 && assumptions.length > 0) {
      warn('W004', item.id, '结论只建立在假设上，没有任何事实支撑')
    }
  }

  if (parsed.conclusion.length > 0 && parsed.assumptions.length === 0) {
    warn('W003', 'assumptions', '有结论但没有任何假设', '没有假设通常意味着有一条硬编码的隐含前提还没被摆上桌面')
  }

  if (!parsed.present.has('revisit') || parsed.revisit.length === 0) {
    fail('E013', 'revisit', '缺少 Revisit（失效条件）段', '第一性原理的产物不是「永远正确的结论」，而是「在什么条件下作废的结论」')
  }

  if (ledgerPath) {
    const ledgerMtime = fileMtime(cwd, ledgerPath)
    if (ledgerMtime) {
      const stale = [...scopeFiles].filter((file) => (fileMtime(cwd, file) ?? 0) > ledgerMtime + 1000)
      if (stale.length) {
        warn('W005', 'scope', `${stale.length} 个 scope 文件比台账新，结论可能已过期`, stale.slice(0, 5).join(', '))
      }
    }
  }

  const verdict = errors.length === 0 && (!strict || warnings.length === 0) ? 'pass' : 'fail'
  const daysLeft = reviewAfter ? daysUntil(reviewAfter, now) : null
  return {
    verdict,
    ledgerPath,
    header: { question: parsed.header.question, mode: parsed.header.mode, scope: parsed.header.scope },
    meta: {
      reviewAfter,
      confidence,
      kill,
      daysLeft,
      expired: daysLeft !== null && daysLeft < 0,
      today: localDateKey(now),
    },
    counts: {
      facts: parsed.facts.filter((item) => item.id).length,
      factsVerified: verifiedFacts,
      assumptions: parsed.assumptions.filter((item) => item.id).length,
      assumptionsFalsifiable: falsifiableAssumptions,
      open: parsed.open.filter((item) => item.id).length,
      derivations: parsed.derivation.filter((item) => item.id).length,
      conclusions: parsed.conclusion.filter((item) => item.id).length,
    },
    errors,
    warnings,
  }
}

export function summarize(report) {
  const { counts } = report
  return normalize(
    `facts ${counts.factsVerified}/${counts.facts} · assumptions ${counts.assumptionsFalsifiable}/${counts.assumptions} · open ${counts.open} · derivations ${counts.derivations} · conclusions ${counts.conclusions}`,
  )
}
