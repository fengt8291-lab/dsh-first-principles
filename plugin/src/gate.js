import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

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
  return `${ts} ${event?.decision === 'allow' ? '放行' : '询问'} · ${event?.rule ?? '?'} · ${event?.tool ?? '?'}${event?.detail ? ` · ${event.detail}` : ''}`
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
  lines.push(`放行条件：项目里有一份通过校验且没到 review_after 的台账；没有就问一句，由你决定。`)
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
