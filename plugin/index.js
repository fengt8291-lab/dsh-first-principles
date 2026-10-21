import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { checkLedger, parseLedger, summarize } from './src/ledger.js'
import { describeRoot, findProjectRoot } from './src/root.js'
import { describeMeta, renderReport, toContent } from './src/report.js'
import { sectionText, usageText } from './src/prompt.js'
import { buildTemplate, probeProject, probeScope, suggestSlug, templateNotes } from './src/template.js'
import { appendRun, readRuns, renderStats, summarizeRuns } from './src/runs.js'
import { applyReanchor, planReanchor, setReviewAfter } from './src/reanchor.js'
import { daysUntil, localDateKey, parseDateKey, reviewKeyFromHeader } from './src/meta.js'
import { appendGateEvent, classifyExecution, extractTargets, readGateEvents, renderGateStatus, scopeCovers } from './src/gate.js'
import { PANEL_VERSION, buildPanelState } from './src/panel.js'
import { anchorDigest, buildAnchor, renderAnchor } from './src/anchor.js'
import { createPanelHandler, PANEL_PREFIX } from './src/panel-route.js'

export const name = 'first-principles'
export const inject = ['systemPrompt', 'tools']

const SECTION_ORDER = 85
const MAX_STATUS_LEDGERS = 200
const DEFAULTS = { dir: '.fp', language: 'zh', gate: false, strict: false, telemetry: true }

function normalizeConfig(config) {
  const raw = config && typeof config === 'object' ? config : {}
  const dir = typeof raw.dir === 'string' && raw.dir.trim() ? raw.dir.trim().replace(/^\.\//, '') : DEFAULTS.dir
  const language = typeof raw.language === 'string' && raw.language.toLowerCase().startsWith('en') ? 'en' : DEFAULTS.language
  const positive = (value) => (Number.isFinite(value) && value > 0 ? value : undefined)
  return {
    dir,
    language,
    gate: raw.gate === true,
    strict: raw.strict === true,
    telemetry: raw.telemetry === false ? false : DEFAULTS.telemetry,
    rootDir: typeof raw.rootDir === 'string' && raw.rootDir.trim() ? raw.rootDir.trim() : null,
    maxFileBytes: positive(raw.maxFileBytes),
    maxEntries: positive(raw.maxEntries),
    maxItems: positive(raw.maxItems),
  }
}

function safeGet(ctx, key) {
  try {
    return ctx.get?.(key) ?? null
  } catch {
    return null
  }
}

/** 工具和斜杠命令拿到的 agent 不一定带 cwd，按 会话头 → workingDirectory 服务 → 进程 cwd 逐级兜底。 */
async function resolveCwd(ctx, agent) {
  const fromHeader = agent?.session?.header?.cwd
  if (typeof fromHeader === 'string' && fromHeader) return fromHeader
  const service = safeGet(ctx, 'workingDirectory')
  if (service && typeof service === 'object') {
    for (const method of ['ensure', 'get', 'current', 'resolve']) {
      if (typeof service[method] !== 'function') continue
      try {
        const value = await service[method](agent)
        if (typeof value === 'string' && value) return value
        if (value && typeof value.cwd === 'string' && value.cwd) return value.cwd
      } catch {
        /* 换下一个方法 */
      }
    }
  }
  return process.cwd()
}

/**
 * 项目根：配置里写死 > 从 cwd 向上找 .fp > 向上找项目标记 > cwd。
 * 会话开在 monorepo 的 packages/x 里也能把台账定位到真正的项目根。
 */
async function resolveRoot(ctx, agent, settings) {
  if (settings.rootDir) {
    const configured = path.resolve(settings.rootDir)
    return { root: configured, foundBy: 'config', depth: 0 }
  }
  const cwd = await resolveCwd(ctx, agent)
  return findProjectRoot(cwd, { dir: settings.dir })
}

function ledgerDir(root, settings) {
  return path.join(root, settings.dir, 'ledgers')
}

function listLedgers(root, settings) {
  const dir = ledgerDir(root, settings)
  let names
  try {
    names = readdirSync(dir).filter((entry) => entry.endsWith('.md'))
  } catch {
    return []
  }
  const found = []
  for (const entry of names.slice(0, MAX_STATUS_LEDGERS)) {
    const absolute = path.join(dir, entry)
    try {
      found.push({ name: entry, path: absolute, mtime: statSync(absolute).mtimeMs })
    } catch {
      /* 读不到就跳过 */
    }
  }
  return found.sort((left, right) => right.mtime - left.mtime)
}

function latestLedger(root, settings) {
  return listLedgers(root, settings)[0]?.path ?? null
}

function emptyReport(ledgerPath, code, message, hint) {
  return {
    verdict: 'fail',
    ledgerPath,
    counts: { facts: 0, factsVerified: 0, assumptions: 0, assumptionsFalsifiable: 0, open: 0, derivations: 0, conclusions: 0 },
    errors: [{ code, at: 'path', message, ...(hint ? { hint } : {}) }],
    warnings: [],
  }
}

function templateResult(root, settings) {
  const facts = probeProject(root)
  const target = path.join(ledgerDir(root, settings), `${suggestSlug(root)}.md`)
  return {
    verdict: 'template',
    path: target,
    markdown: buildTemplate({ cwd: root, facts, scope: probeScope(root) }),
    notes: templateNotes({ cwd: root, ledgerPath: target, facts }),
    facts,
  }
}

/** 会话 id：面板按会话过滤「这轮对话修了什么」，所以运行记录必须带上它。 */
function sessionIdOf(agent) {
  const id = agent?.session?.header?.id ?? agent?.session?.id
  return typeof id === 'string' && id ? id : null
}

/** 每次真实校验都记一条，给「纠错统计」面板留数据；失败不影响校验本身。 */
function recordRun(root, settings, report, ledgerLabel, startedAt, extra = {}) {
  if (!settings.telemetry || !ledgerLabel) return
  try {
    appendRun(root, settings.dir, {
      ts: new Date().toISOString(),
      ledger: ledgerLabel,
      verdict: report.verdict,
      errors: (report.errors ?? []).map((item) => item.code),
      warnings: (report.warnings ?? []).map((item) => item.code),
      facts: report.counts?.facts ?? 0,
      conclusions: report.counts?.conclusions ?? 0,
      ms: Date.now() - startedAt,
      ...(extra.session ? { session: extra.session } : {}),
    })
  } catch {
    /* 统计失败不影响主流程 */
  }
}

async function runCheck(ctx, settings, args, agent) {
  const startedAt = Date.now()
  const found = await resolveRoot(ctx, agent, settings)
  const root = found.root
  if (args.context === true) {
    const files = listLedgers(root, settings)
    const anchor = buildAnchor(root, files, { limit: 3 })
    return {
      verdict: 'anchor',
      ledgerPath: files[0] ? path.relative(root, files[0].path) : '',
      anchor: renderAnchor(anchor, settings.language),
      entries: anchor.entries.length,
      generatedAt: anchor.generatedAt,
    }
  }
  const explicit = typeof args.path === 'string' ? args.path.trim() : ''
  const document = typeof args.document === 'string' ? args.document.trim() : ''
  let text = document || null
  let ledgerPath = null

  if (!text && explicit) {
    ledgerPath = path.resolve(root, explicit)
    try {
      text = readFileSync(ledgerPath, 'utf8')
    } catch {
      return emptyReport(path.relative(root, ledgerPath), 'E004', `读不到台账 ${explicit}`, '路径相对项目根目录；不传 path 会取最新一份台账或返回骨架')
    }
  }
  if (!text) {
    ledgerPath = latestLedger(root, settings)
    if (ledgerPath) {
      try {
        text = readFileSync(ledgerPath, 'utf8')
      } catch {
        text = null
      }
    }
  }
  if (!text) return templateResult(root, settings)

  const report = checkLedger({
    cwd: root,
    text,
    ledgerPath,
    strict: settings.strict || args.strict === true,
    options: { maxFileBytes: settings.maxFileBytes, maxEntries: settings.maxEntries, maxItems: settings.maxItems },
  })
  // 宿主按 output.schema 校验返回值：ledgerPath 声明成 string，null 会让整次调用报错。
  report.ledgerPath = typeof report.ledgerPath === 'string' && report.ledgerPath ? path.relative(root, report.ledgerPath) : ''
  if (found.foundBy !== 'cwd') report.rootNote = describeRoot(found)
  const drift = driftWarning(root, settings, ledgerPath, report)
  if (drift) report.warnings.push(drift)
  recordRun(root, settings, report, report.ledgerPath || '(inline)', startedAt, { session: sessionIdOf(agent) })
  return report
}

function sameQuestion(left, right) {
  const flat = (value) => String(value ?? '').replace(/\s+/g, '').replace(/[，。,.!?！？:：;；]/g, '').toLowerCase()
  return flat(left) === flat(right)
}

/**
 * W008：项目里还有别的、没过期的台账，且问题跟这次不一样。
 * 这是「换题了却没交代」的机械信号——不判断谁对，只提醒别假装没看过。
 */
function driftWarning(root, settings, currentPath, report) {
  if (report.verdict !== 'pass') return null
  const question = report.header?.question
  if (!question) return null
  const now = new Date()
  const others = []
  for (const ledger of listLedgers(root, settings)) {
    if (currentPath && path.resolve(ledger.path) === path.resolve(currentPath)) continue
    try {
      const parsed = parseLedger(readFileSync(ledger.path, 'utf8'))
      const reviewAfter = reviewKeyFromHeader(parsed.header.extra)
      const date = reviewAfter ? parseDateKey(reviewAfter) : null
      if (date && (daysUntil(date, now) ?? 0) < 0) continue
      if (!parsed.header.question) continue
      if (sameQuestion(parsed.header.question, question)) continue
      others.push(path.relative(root, ledger.path))
    } catch {
      /* 读不到的旧台账不参与漂移判断 */
    }
  }
  if (others.length === 0) return null
  return {
    code: 'W008',
    at: 'ledger',
    message: `项目里还有 ${others.length} 份没过期的台账，问题跟这次不一样：${others.slice(0, 3).join(', ')}`,
    hint: '换题了就明说为什么换；同一件事就合并成一份台账，别让两份结论各说各话',
  }
}

/** 最近一份「通过且没过期」的台账。闸门只问有没有，不假装知道它跟这次操作有没有关系。 */
function findFreshPasses(root, settings) {
  const found = []
  for (const ledger of listLedgers(root, settings)) {
    try {
      const report = checkLedger({
        cwd: root,
        text: readFileSync(ledger.path, 'utf8'),
        ledgerPath: ledger.path,
        options: { maxFileBytes: settings.maxFileBytes, maxEntries: settings.maxEntries, maxItems: settings.maxItems },
      })
      if (report.verdict === 'pass' && !report.meta?.expired) {
        found.push({ rel: path.relative(root, ledger.path), meta: report.meta, scope: report.header?.scope ?? [] })
      }
    } catch {
      /* 坏台账跳过，闸门不该因为读不懂一份台账就卡住 */
    }
  }
  return found
}

/** 把命令行里的目标路径折算成工作区相对路径；指不出、在项目外、带通配符的一律返回 null。 */
function toWorkspaceRelative(root, target) {
  const raw = String(target ?? '').trim()
  if (!raw || /[*?]/.test(raw)) return null
  const absolute = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(root, raw)
  const rel = path.relative(root, absolute)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

/**
 * 闸门相关性：能指认路径的操作，要求通过校验的台账 scope 覆盖它。
 * 指不出路径（整仓操作 / 项目外 / 通配符）就退回旧行为——宁可漏，不误拦。
 */
function judgeRelevance(passes, hit, exec, root) {
  const targets = extractTargets(hit, exec)
  if (!targets.judgeable) return { decision: passes.length ? 'allow' : 'ask', reason: passes.length ? 'ok' : 'no-ledger', ledger: passes[0]?.rel ?? null, targets: [] }
  const relative = targets.paths.map((item) => toWorkspaceRelative(root, item))
  const inside = relative.filter(Boolean)
  if (inside.length === 0) {
    return { decision: passes.length ? 'allow' : 'ask', reason: passes.length ? 'ok' : 'no-ledger', ledger: passes[0]?.rel ?? null, targets: [] }
  }
  const covering = passes.find((pass) => inside.every((item) => scopeCovers(pass.scope, item)))
  if (covering) return { decision: 'allow', reason: 'ok', ledger: covering.rel, targets: inside }
  return { decision: passes.length ? 'ask' : 'ask', reason: passes.length ? 'scope' : 'no-ledger', ledger: passes[0]?.rel ?? null, targets: inside }
}

function gateReason(hit, settings, verdict) {
  if (verdict?.reason === 'scope') {
    const where = (verdict.targets ?? []).join(', ')
    if (settings.language === 'en') {
      return `Irreversible operation (${hit.rule}) touches ${where}, which no passing ledger's scope covers. Widen that ledger's scope and re-run first_principles_check — or approve this one time if you know the consequences.`
    }
    return `不可逆操作（${hit.rule}）要动 ${where}，而通过校验的台账 scope 没覆盖这里。先把那份台账的 scope 补上并重新校验；如果你清楚后果，直接批准这一次也行。`
  }
  if (settings.language === 'en') {
    return `Irreversible operation (${hit.rule}) with no usable ledger. Write the reasoning into ${settings.dir}/ledgers/ and run first_principles_check until verdict=pass first — or approve this one time if you know the consequences.`
  }
  return `不可逆操作（${hit.rule}）之前没有可用的台账。先把判断写进 ${settings.dir}/ledgers/ 并用 first_principles_check 校验到 pass；如果你清楚后果，直接批准这一次也行。`
}

/** tools/pre-execute 的监听器：拿不到上下文就 next()，闸门的失败方式是「不管」。 */
function createGateHandler(ctx, settings, runtime) {
  return async (exec, next) => {
    try {
      if (!runtime.gate) return next()
      const hit = classifyExecution(exec)
      if (!hit) return next()
      const found = await resolveRoot(ctx, exec?.agent, settings)
      const passes = findFreshPasses(found.root, settings)
      const verdict = judgeRelevance(passes, hit, exec, found.root)
      try {
        appendGateEvent(found.root, settings.dir, {
          ts: new Date().toISOString(),
          tool: hit.tool,
          rule: hit.rule,
          detail: hit.detail,
          decision: verdict.decision,
          ledger: verdict.ledger,
          reason: verdict.reason,
          targets: verdict.targets.length ? verdict.targets : undefined,
        })
      } catch {
        /* 日志写不进去也要照常判断 */
      }
      if (verdict.decision === 'allow') return next()
      return { kind: 'ask', reason: gateReason(hit, settings, verdict) }
    } catch {
      return next()
    }
  }
}

function doctorText(root, settings, runtime, found) {
  const list = listLedgers(root, settings)
  const runs = readRuns(root, settings.dir)
  const gateEvents = readGateEvents(root, settings.dir, 500)
  const panel = runtime.panel ?? { registered: false, reason: '未知' }
  const command = runtime.command ?? { registered: false, reason: '未知' }
  const lines = [
    `first-principles v${PANEL_VERSION}`,
    `项目根：${root}${found?.foundBy ? `（来源：${found.foundBy}）` : ''}`,
    `面板路由：${panel.registered ? `已注册 ${PANEL_PREFIX}/*` : `未注册（${panel.reason}）`}`,
    `斜杠命令：${command.registered ? '已注册 /fp' : `未注册（${command.reason}）`}`,
    `闸门：${runtime.gate ? '开' : '关'}（配置值 ${settings.gate ? 'true' : 'false'}，运行期可 /fp gate on|off）`,
    `台账：${list.length} 份${list.length ? `，最新 ${path.relative(root, list[0])}` : ''}`,
    `跨会话锚点：${anchorDigest(buildAnchor(root, list, { limit: 1 }), settings.language)}`,
    `运行记录：${runs.length} 条（${settings.dir}/runs.jsonl）· 闸门记录：${gateEvents.length} 条（${settings.dir}/gate.jsonl）`,
    `数据目录：${path.join(root, settings.dir)}`,
  ]
  if (!panel.registered) {
    lines.push('')
    lines.push('面板未注册时：对话输入框下方不会有状态栏。多半是 webServer 服务在插件加载时还没就绪；本版已改为等它就绪再注册，若仍为未注册，请把这一行贴给开发者。')
  }
  return lines.join('\n')
}

function contextText(root, settings) {
  const files = listLedgers(root, settings)
  if (files.length === 0) return '还没有台账，没有可继承的结论。先跑一次 first_principles_check 拿骨架。'
  return renderAnchor(buildAnchor(root, files, { limit: 3 }), settings.language)
}

function gateText(root, settings, runtime, rest) {
  const action = String(rest ?? '').trim()
  if (action === 'on' || action === 'off') {
    runtime.gate = action === 'on'
    const verb = runtime.gate ? '闸门已打开（本进程有效）' : '闸门已关闭'
    return `${verb}。\n${renderGateStatus({ enabled: runtime.gate, events: readGateEvents(root, settings.dir, 50), dirName: settings.dir })}`
  }
  return renderGateStatus({ enabled: runtime.gate, events: readGateEvents(root, settings.dir, 50), dirName: settings.dir })
}

const PARAMETERS = {
  type: 'object',
  properties: {
    path: { type: 'string', description: '台账文件路径（相对项目根目录）。省略时取最新一份台账；一份都没有则返回骨架。' },
    document: { type: 'string', description: '直接传入台账全文校验，而不是读取文件。' },
    strict: { type: 'boolean', description: 'true 时 warning 也算不通过。' },
    context: { type: 'boolean', description: 'true 时不安检、只看项目里最近几份台账的结论与未决项（跨会话锚点）。' },
  },
  additionalProperties: false,
}

function createTool(ctx, settings) {
  return {
    name: 'first_principles_check',
    description:
      '校验第一性原理台账：每条事实必须落回真实的 文件:行 且反引号引文逐字可比对；每条假设必须带 falsify 可证伪条件；结论依赖的假设必须出现在 Revisit；review_after 到期会提示。不传参数时返回一份带真实引用的骨架；传 context: true 则返回最近几份台账的结论与未决项（跨会话锚点）。',
    parameters: PARAMETERS,
    output: {
      schema: {
        type: 'object',
        properties: {
          verdict: { type: 'string', description: 'pass | fail | template' },
          ledgerPath: { type: 'string' },
        },
        required: ['verdict'],
        additionalProperties: true,
      },
      render(_args, value) {
        return toContent(value)
      },
    },
    timeoutMs: 20000,
    isConcurrencySafe: true,
    async execute(args, execution) {
      return runCheck(ctx, settings, args ?? {}, execution?.agent)
    },
  }
}

function reviewLabel(report) {
  const meta = report.meta ?? {}
  if (!meta.reviewAfter) return '未设复查日期'
  if (meta.expired) return `已过期 ${Math.abs(meta.daysLeft)} 天`
  return `还有 ${meta.daysLeft} 天`
}

function statusText(root, settings, found) {
  const ledgers = listLedgers(root, settings)
  const head = found && found.foundBy !== 'cwd' ? `（${describeRoot(found)}）` : ''
  if (ledgers.length === 0) {
    return `还没有台账${head}。${path.relative(root, ledgerDir(root, settings))}/ 下没有任何 .md 文件；先跑一次 first_principles_check 拿骨架。`
  }
  const lines = [`台账 ${ledgers.length} 份（${path.relative(root, ledgerDir(root, settings))}/）${head}：`]
  let expired = 0
  for (const ledger of ledgers) {
    try {
      const report = checkLedger({
        cwd: root,
        text: readFileSync(ledger.path, 'utf8'),
        ledgerPath: ledger.path,
        options: { maxFileBytes: settings.maxFileBytes, maxEntries: settings.maxEntries, maxItems: settings.maxItems },
      })
      if (report.meta?.expired) expired += 1
      const flags = [report.meta?.expired ? '⚠ 过期' : null, report.meta?.kill ? null : '无止损'].filter(Boolean)
      lines.push(
        `- ${ledger.name}: ${String(report.verdict).toUpperCase()}（${report.errors.length} err, ${report.warnings.length} warn）· 复查 ${reviewLabel(report)}${flags.length ? ` · ${flags.join(' · ')}` : ''}`,
      )
      const metaLine = describeMeta(report)
      if (metaLine) lines.push(`  ${metaLine}`)
    } catch {
      lines.push(`- ${ledger.name}: 读取失败`)
    }
  }
  lines.push('')
  lines.push(`/fp stats 看历史纠错统计；/fp reanchor 把漂掉的行号按引文重新锚定。`)
  return lines.join('\n')
}

function statsText(root, settings) {
  const runs = readRuns(root, settings.dir)
  const ledgers = listLedgers(root, settings)
  let expired = 0
  for (const ledger of ledgers) {
    try {
      const report = checkLedger({ cwd: root, text: readFileSync(ledger.path, 'utf8'), options: { maxFileBytes: settings.maxFileBytes } })
      if (report.meta?.expired) expired += 1
    } catch {
      /* 统计而已 */
    }
  }
  return renderStats(summarizeRuns(runs), { ledgers: ledgers.length, expired, dirName: settings.dir })
}

function pickLedger(root, settings, explicit) {
  if (explicit) return path.resolve(root, explicit)
  return latestLedger(root, settings)
}

function reanchorText(root, settings, explicit) {
  const target = pickLedger(root, settings, explicit)
  if (!target) return `没有可重锚的台账：${settings.dir}/ledgers/ 下没有 .md。先跑一次 first_principles_check 拿骨架。`
  let text
  try {
    text = readFileSync(target, 'utf8')
  } catch {
    return `读不到台账：${path.relative(root, target)}`
  }
  const plan = planReanchor({ cwd: root, text, maxBytes: settings.maxFileBytes })
  const lines = [`重锚 ${path.relative(root, target)}：检查 ${plan.facts} 条事实，需要改行号 ${plan.changes.length} 条，没解决 ${plan.unresolved.length} 条。`]
  if (plan.changes.length > 0) {
    const applied = applyReanchor(text, plan.changes)
    try {
      writeFileSync(target, applied.text, 'utf8')
    } catch {
      return `写回失败：${path.relative(root, target)}（文件只读？）`
    }
    for (const change of plan.changes) lines.push(`- ${change.id} · ${change.path}:${change.from} → :${change.to}（引文仍在，行号漂了）`)
  }
  for (const item of plan.unresolved) {
    const at = item.path ? `${item.path} · ` : ''
    lines.push(`- ${item.id} · ${at}${item.reason}`)
  }
  if (plan.changes.length === 0 && plan.unresolved.length === 0) lines.push('行号都是对的，不用改。')
  return lines.join('\n')
}

function reviewText(root, settings, rest) {
  const tokens = String(rest ?? '').trim().split(/\s+/).filter(Boolean)
  const dateToken = tokens[0]
  const explicit = tokens[1]
  const parsed = parseDateKey(dateToken)
  if (!parsed) return `用法：/fp review 2026-11-20 [台账路径]。日期写成 YYYY-MM-DD，收到的是「${dateToken ?? ''}」。`
  const target = pickLedger(root, settings, explicit)
  if (!target) return `没有可改的台账：${settings.dir}/ledgers/ 下没有 .md。`
  let text
  try {
    text = readFileSync(target, 'utf8')
  } catch {
    return `读不到台账：${path.relative(root, target)}`
  }
  const updated = setReviewAfter(text, parsed.key)
  try {
    writeFileSync(target, updated.text, 'utf8')
  } catch {
    return `写回失败：${path.relative(root, target)}（文件只读？）`
  }
  const left = daysUntil(parsed.key)
  const when = left === null ? '' : left < 0 ? `（已经过期 ${Math.abs(left)} 天）` : `（${left} 天后）`
  return `${updated.replaced ? '已更新' : '已写入'} review_after: ${parsed.key} ${when} → ${path.relative(root, target)}。今天 ${localDateKey()}。`
}

function createCommand(ctx, settings, runtime) {
  return {
    name: 'fp',
    description: '第一性原理台账：/fp 看用法，/fp status 校验全部台账，/fp stats 看纠错统计，/fp gate [on|off] 开关闸门，/fp reanchor 重锚行号，/fp review <日期> 设备查日期，/fp context 看上次结论与未决项，/fp doctor 看面板与数据面状态，/fp <文件> 校验指定台账',
    handler: async (invocation) => {
      const found = await resolveRoot(ctx, invocation?.agent, settings)
      const root = found.root
      const input = String(invocation?.rawInput ?? '').trim()
      if (!input || input === 'help') return { kind: 'success', text: usageText(settings) }
      const [head, ...tail] = input.split(/\s+/)
      const rest = tail.join(' ')
      if (head === 'status') return { kind: 'success', text: statusText(root, settings, found) }
      if (head === 'stats') return { kind: 'success', text: statsText(root, settings) }
      if (head === 'context' || head === 'anchor') return { kind: 'success', text: contextText(root, settings) }
      if (head === 'gate') return { kind: 'success', text: gateText(root, settings, runtime, rest) }
      if (head === 'reanchor') return { kind: 'success', text: reanchorText(root, settings, rest.trim()) }
      if (head === 'review') return { kind: 'success', text: reviewText(root, settings, rest) }
      if (head === 'doctor') return { kind: 'success', text: doctorText(root, settings, runtime, found) }
      const report = await runCheck(ctx, settings, { path: input }, invocation?.agent)
      return { kind: 'success', text: renderReport(report) }
    },
  }
}

export function apply(ctx, config) {
  const settings = normalizeConfig(config)
  const runtime = { gate: settings.gate }

  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'first-principles',
      order: SECTION_ORDER,
      text: sectionText(settings),
    }),
  )

  ctx.effect(() => ctx.tools.register(createTool(ctx, settings)))

  // 斜杠命令：commands 同样是可选服务（ctx.get('commands') 可能为 undefined）。
  // 和面板路由一样必须用 ctx.inject 等它就绪，否则 /fp 会被静默跳过——
  // 用户输入的 "/fp doctor" 就会当成普通消息发给模型（正是这个 bug 的表现）。
  const registerCommand = (scopeCtx) => {
    const scope = scopeCtx ?? ctx
    const service = safeGet(scope, 'commands')
    if (!service || typeof service.register !== 'function') {
      runtime.command = { registered: false, reason: 'commands 服务不可用' }
      return
    }
    if (runtime.command?.registered) return
    scope.effect(() => service.register(createCommand(ctx, settings, runtime)))
    runtime.command = { registered: true, reason: 'ok' }
  }
  runtime.command = { registered: false, reason: '等待 commands 服务' }
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['commands'], (scopeCtx) => registerCommand(scopeCtx))
    } catch {
      registerCommand(ctx)
    }
  } else {
    registerCommand(ctx)
  }

  // 闸门走 tools/pre-execute 瀑布：能 ask（异步问人），guard 只能同步 deny。
  if (typeof ctx.on === 'function') {
    ctx.effect(() => {
      const dispose = ctx.on('tools/pre-execute', createGateHandler(ctx, settings, runtime))
      return typeof dispose === 'function' ? dispose : () => {}
    })
  }

  // 面板数据面：宿主 webServer 上的 /x-first-principles/*，同源 fetch，不经 RPC。
  // 注意：webServer 是可选服务，apply 时可能还没激活（ctx.get 会返回 null），
  // 因此用 ctx.inject(['webServer'], …) 等它出现再注册——直接在 apply 里 get 会静默跳过。
  const registerPanel = (scopeCtx) => {
    const scope = scopeCtx ?? ctx
    const webServer = safeGet(scope, 'webServer')
    if (!webServer || typeof webServer.register !== 'function') {
      runtime.panel = { registered: false, reason: 'webServer 服务不可用' }
      return
    }
    const handler = createPanelHandler({
      stateFor: async (sessionId) => {
        const agents = safeGet(ctx, 'agents')
        // 面板拿到的 session 可能已经不在内存里（刷新、重启），逐级兜底到任意活着的 agent。
        let agent = sessionId && typeof agents?.get === 'function' ? agents.get(sessionId) : null
        if (!agent) {
          const pool = typeof agents?.roots === 'function' ? agents.roots() : typeof agents?.list === 'function' ? agents.list() : []
          agent = (pool ?? []).find((item) => item?.session?.header?.cwd) ?? (pool ?? [])[0] ?? null
        }
        const found = await resolveRoot(ctx, agent, settings)
        return {
          ...buildPanelState({ root: found.root, settings, gateEnabled: runtime.gate, sessionId: sessionId || null }),
          command: runtime.command ?? { registered: false, reason: '未知' },
          panel: runtime.panel ?? { registered: false, reason: '未知' },
        }
      },
      setGate: (enabled) => {
        runtime.gate = enabled === true
      },
    })
    if (runtime.panel?.registered) return
    scope.effect(() => webServer.register({ kind: 'prefix', path: PANEL_PREFIX, handler }))
    runtime.panel = { registered: true, reason: 'ok' }
  }
  runtime.panel = { registered: false, reason: '等待 webServer 服务' }
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer'], (scopeCtx) => registerPanel(scopeCtx))
    } catch {
      registerPanel(ctx)
    }
  } else {
    registerPanel(ctx)
  }
}
