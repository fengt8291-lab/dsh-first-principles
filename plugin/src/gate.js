import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { globToRegExp } from './evidence.js'

/**
 * 可选闸门：只在「删掉就回不来」的操作前问一句，别的都不管。
 * 宁可漏，也不误伤可逆操作——误拦一次，用户就会把整个插件关掉。
 */
const COMMAND_RULES = [
  { rule: 'rm', re: /(?:^|[;&|]\s*)rm\s+-\S*[rR]/ },
  { rule: 'git-push-force', re: /git\s+push\b[^\n]*\s(?:--force|-f)(?:\s|$)/ },
  { rule: 'git-reset-hard', re: /git\s+reset\s+--hard\b/ },
  { rule: 'git-clean', re: /git\s+clean\s+-[a-zA-Z]*[fdx]/ },
  { rule: 'publish', re: /\b(?:npm|pnpm|yarn)\s+publish\b/ },
  { rule: 'remote-delete', re: /\bgh\s+(?:release|repo|branch)\s+delete\b/ },
  { rule: 'container-remove', re: /\bdocker\s+(?:rm|rmi|volume\s+rm)\b/ },
  { rule: 'cluster-delete', re: /\bkubectl\s+delete\b/ },
  { rule: 'sql-drop', re: /\b(?:drop\s+(?:table|database)|truncate\s+table)\b/i },
  { rule: 'disk-write', re: /\bdd\s+[^\n]*\bof=\/dev\// },
]

const COMMAND_TOOLS = new Set(['bash', 'ssh_exec', 'ssh_cluster'])
const DESTRUCTIVE_NAME = /^(?:delete|remove|destroy|drop|purge|truncate|publish|deploy|uninstall)/i
const DETAIL_MAX = 120

export const GATE_LOG = 'gate.jsonl'

function clip(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > DETAIL_MAX ? `${flat.slice(0, DETAIL_MAX)}…` : flat
}

/** 认不出工具名/命令就放行；闸门的失败方式是「不管」，不是「全拦」。 */
export function classifyExecution(exec) {
  const tool = typeof exec?.name === 'string' ? exec.name : ''
  if (!tool) return null
  const args = exec?.arguments && typeof exec.arguments === 'object' ? exec.arguments : {}
  if (COMMAND_TOOLS.has(tool)) {
    const command = typeof args.command === 'string' ? args.command : ''
    if (!command) return null
    for (const entry of COMMAND_RULES) {
      if (entry.re.test(command)) return { rule: entry.rule, tool, detail: clip(command) }
    }
    return null
  }
  if (DESTRUCTIVE_NAME.test(tool)) {
    const hint = typeof args.path === 'string' ? args.path : typeof args.command === 'string' ? args.command : ''
    return { rule: `tool:${tool}`, tool, detail: clip(hint) }
  }
  return null
}

/**
 * 从被拦下的调用里找出「它到底要动哪里」，用于判断台账覆盖不覆盖。
 * - rm：取非选项参数（含通配符就不判断，交给调用方放弃）
 * - 仓库级操作（git reset --hard / clean / push --force / publish）：整仓，指不出具体路径
 * - 其余规则：没有文件路径，维持旧行为
 */
const REPO_WIDE_RULES = new Set(['git-reset-hard', 'git-clean', 'git-push-force', 'publish'])

function splitArgs(text) {
  const out = []
  const re = /'([^']*)'|"([^"]*)"|(\S+)/g
  let match
  while ((match = re.exec(String(text ?? '')))) {
    out.push(match[1] ?? match[2] ?? match[3] ?? '')
  }
  return out.filter(Boolean)
}

export function extractTargets(hit, exec) {
  const empty = { paths: [], repoWide: false, judgeable: false }
  if (!hit) return empty
  if (REPO_WIDE_RULES.has(hit.rule)) return { paths: [], repoWide: true, judgeable: false }
  if (hit.rule !== 'rm') return empty
  const command = typeof exec?.arguments?.command === 'string' ? exec.arguments.command : ''
  if (!command) return empty
  const paths = []
  const segment = /(?:^|[;&|]\s*)rm\s+([^\n;&|]*)/g
  let match
  while ((match = segment.exec(command))) {
    for (const token of splitArgs(match[1])) {
      if (token.startsWith('-')) continue
      paths.push(token)
    }
  }
  return { paths: [...new Set(paths)], repoWide: false, judgeable: paths.length > 0 }
}

/** 台账的 scope 是否覆盖某个工作区相对路径。目录写法按前缀算，通配按 glob 算。 */
export function scopeCovers(patterns, relativePath) {
  const target = String(relativePath ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!target) return false
  for (const raw of patterns ?? []) {
    const pattern = String(raw ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
    if (!pattern) continue
    if (pattern === target) return true
    if (!/[*?]/.test(pattern)) {
      if (target.startsWith(`${pattern}/`)) return true
      continue
    }
    if (globToRegExp(pattern).test(target)) return true
  }
  return false
}

export function gateLogPath(root, dirName) {
  return path.join(root, dirName, GATE_LOG)
}
export function appendGateEvent(root, dirName, record) {
  const file = gateLogPath(root, dirName)
  mkdirSync(path.dirname(file), { recursive: true })
  appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8')
  return file
}

export function readGateEvents(root, dirName, limit = 5) {
  const file = gateLogPath(root, dirName)
  if (!existsSync(file)) return []
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const lines = text.split('\n').filter((line) => line.trim())
  const events = []
  for (const line of lines) {
    try {
      events.push(JSON.parse(line))
    } catch {
      /* 坏行跳过：日志坏了不影响闸门 */
    }
  }
  return typeof limit === 'number' && limit > 0 ? events.slice(-limit) : events
}

export function summarizeGate(events) {
  const asks = events.filter((event) => event?.decision === 'ask').length
  const allows = events.filter((event) => event?.decision === 'allow').length
  const rules = new Map()
  for (const event of events) {
    if (!event?.rule) continue
    rules.set(event.rule, (rules.get(event.rule) ?? 0) + 1)
  }
  const top = [...rules.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5)
  return { total: events.length, asks, allows, top }
}

function stamp(event) {
  const ts = typeof event?.ts === 'string' ? event.ts.slice(5, 16).replace('T', ' ') : '?'
  const why = event?.reason === 'scope' ? '（scope 未覆盖）' : event?.reason === 'no-ledger' ? '（没有可用台账）' : ''
  return `${ts} ${event?.decision === 'allow' ? '放行' : '询问'} · ${event?.rule ?? '?'} · ${event?.tool ?? '?'}${event?.detail ? ` · ${event.detail}` : ''}${why}`
}

export function renderGateStatus({ enabled, events, dirName }) {
  const summary = summarizeGate(events)
  const lines = [`闸门：${enabled ? '开（只在不可逆操作前询问）' : '关（默认）'}`]
  if (!enabled) {
    lines.push('开：/fp gate on。关掉 DSH 后失效；想永久开，在插件配置里写 gate: true。')
  } else {
    lines.push('关：/fp gate off。配置 gate: true 可永久开启。')
  }
  lines.push('规则只认能确认的：rm -r、git push --force、git reset --hard、git clean -f、npm/pnpm/yarn publish、gh * delete、docker rm、kubectl delete、drop table、dd 写盘；读操作与可逆写不拦。')
  lines.push(`放行条件：有一份通过校验、没到 review_after、且 scope 覆盖这次要动的东西的台账。`)
  lines.push('覆盖是怎么算的：能指认路径的操作（rm）拿路径去比 scope；git reset --hard / git clean -f / git push --force / publish 是整仓操作，比不出路径，只要有可用台账就放行；路径在项目外或带通配符时同样不判断——宁可漏，不误拦。')
  if (summary.total === 0) {
    lines.push(`还没有记录。日志：${dirName}/${GATE_LOG}`)
    return lines.join('\n')
  }
  lines.push(`记录 ${summary.total} 次：询问 ${summary.asks} · 放行 ${summary.allows}。`)
  if (summary.top.length) lines.push(`命中规则：${summary.top.map(([rule, count]) => `${rule}×${count}`).join(' · ')}`)
  lines.push('最近：')
  for (const event of events.slice(-5)) lines.push(`- ${stamp(event)}`)
  lines.push('日志只追加、不参与判定；删掉它就等于清空统计。')
  return lines.join('\n')
}
