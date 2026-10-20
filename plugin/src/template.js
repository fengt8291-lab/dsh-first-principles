import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { localDateKey, parseDateKey } from './meta.js'

const PREFERRED_LINE = /"(name|title|version)"\s*:/
const CANDIDATES = [
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'composer.json',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'deno.json',
  'Makefile',
  'requirements.txt',
  'setup.py',
  'README.md',
  'readme.md',
  'README',
  'src/index.ts',
  'src/index.js',
  'src/main.ts',
  'src/main.js',
  'index.js',
  'main.py',
  'app.py',
  'main.go',
  'cmd/main.go',
  'lib/main.dart',
  'Program.cs',
  'src/lib.rs',
]
const SCAN_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.kts',
  '.rb', '.php', '.cs', '.swift', '.c', '.h', '.cc', '.cpp', '.hpp', '.scala', '.ex', '.exs',
  '.dart', '.lua', '.sh', '.sql', '.md', '.toml', '.yaml', '.yml', '.json', '.vue', '.svelte',
])
const SKIP_DIRS = new Set(['node_modules', '.git', '.fp', 'dist', 'build', 'out', 'coverage', '.next', 'target', 'vendor', '.venv', 'venv', '__pycache__'])
const MAX_LINE = 120
const MAX_SCAN_FILES = 200
const MAX_SCAN_BYTES = 512 * 1024

function isFile(absolute) {
  try {
    return statSync(absolute).isFile()
  } catch {
    return false
  }
}

function usable(line) {
  const trimmed = String(line ?? '').trim()
  if (!trimmed) return false
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('<!--')) return false
  if (trimmed.includes('`')) return false
  return trimmed.length <= MAX_LINE
}

function firstUsableLine(absolute) {
  let text
  try {
    if (statSync(absolute).size > MAX_SCAN_BYTES) return null
    text = readFileSync(absolute, 'utf8')
  } catch {
    return null
  }
  if (text.includes('\u0000')) return null
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const preferred = lines.findIndex((line) => usable(line) && PREFERRED_LINE.test(line))
  const index = preferred >= 0 ? preferred : lines.findIndex(usable)
  if (index < 0) return null
  return { line: index + 1, text: lines[index].trim() }
}

/**
 * 随便什么项目结构：先按常见清单文件找，再浅扫一层源码。
 * 目标是让骨架一生成就带着「真实存在、可逐字比对」的 F1/F2，而不是让用户先猜格式。
 */
export function probeProject(cwd, limit = 2) {
  const facts = []
  for (const relative of CANDIDATES) {
    if (facts.length >= limit) break
    const absolute = path.join(cwd, relative)
    if (!isFile(absolute)) continue
    const found = firstUsableLine(absolute)
    if (found) facts.push({ path: relative, line: found.line, text: found.text })
  }
  if (facts.length >= limit) return facts

  for (const relative of scanSourceFiles(cwd)) {
    if (facts.length >= limit) break
    if (facts.some((fact) => fact.path === relative)) continue
    const found = firstUsableLine(path.join(cwd, relative))
    if (found) facts.push({ path: relative, line: found.line, text: found.text })
  }
  return facts
}

/** 深度优先浅扫（最多 3 层、200 个文件），给没有标准清单的项目兜底。 */
export function scanSourceFiles(cwd, limit = MAX_SCAN_FILES) {
  const found = []
  const queue = [{ relative: '', depth: 0 }]
  while (queue.length && found.length < limit) {
    const { relative, depth } = queue.shift()
    let entries
    try {
      entries = readdirSync(path.join(cwd, relative), { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (found.length >= limit) break
      const child = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (depth < 3 && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) queue.push({ relative: child, depth: depth + 1 })
        continue
      }
      if (!entry.isFile()) continue
      if (!SCAN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      found.push(child)
    }
  }
  return found
}

/** 给骨架一个真实存在的 scope，否则刚生成的台账会被 E002 打回。 */
export function probeScope(cwd, limit = 2) {
  const files = []
  for (const relative of CANDIDATES) {
    if (files.length >= limit) break
    if (isFile(path.join(cwd, relative))) files.push(relative)
  }
  const src = path.join(cwd, 'src')
  if (files.length < limit && existsSync(src)) {
    try {
      if (files.length === 0 && readdirSync(src).length > 0) files.push('src/**')
    } catch {
      /* 读不到就算了 */
    }
  }
  if (files.length === 0) {
    const scanned = scanSourceFiles(cwd, 2)
    for (const relative of scanned) files.push(relative)
  }
  return files.length > 0 ? files.join(', ') : ''
}

export function suggestSlug(cwd) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'))
    if (typeof manifest.name === 'string' && manifest.name.trim()) {
      return manifest.name
        .trim()
        .replace(/^@[^/]+\//, '')
        .replace(/[^\w.-]+/g, '-')
        .toLowerCase()
    }
  } catch {
    /* 没有 package.json，就退回目录名 */
  }
  const base = path.basename(path.resolve(cwd || '.'))
  const slug = base.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return slug || 'task'
}

/** 默认复查日期：30 天后。骨架一生成就带上它，省得每次手写日期格式出错。 */
export function defaultReviewDate(today = new Date()) {
  const parsed = parseDateKey(localDateKey(today)) ?? { time: today.getTime() }
  const later = new Date(parsed.time + 30 * 86400000)
  return localDateKey(later)
}

export function buildTemplate({ cwd, facts, scope, today = new Date() }) {
  const factLines = facts.slice(0, 2).map((fact, index) => `- F${index + 1} · ${fact.path}:${fact.line} · \`${fact.text}\``)
  const factBlock = factLines.length > 0 ? factLines.join('\n') : '- F1 · <相对路径>:<行号> · `<该行原文>`'
  const factRefs = facts.length > 0 ? facts.slice(0, 2).map((_, index) => `F${index + 1}`).join(',') : 'F1'
  return [
    `# 第一性原理台账 · ${suggestSlug(cwd)}`,
    'question: （一句话写清这次真正要回答的问题）',
    'mode: decision',
    `scope: ${scope || '<至少一个真实文件或 glob>'}`,
    `review_after: ${defaultReviewDate(today)}`,
    'confidence: 0.7',
    'kill: （出现什么情况就承认这个判断失败并停下）',
    '',
    '## Facts',
    factBlock,
    '',
    '## Assumptions',
    '- A1 · basis: inference · falsify: （出现什么证据就说明这条假设是错的）',
    '  （假设内容：现在只能靠猜、但整个结论都压在它上面的那句话）',
    '',
    '## Open',
    '- O1 · probe: （一次能跑完的验证动作，或一次读文件） · open',
    '',
    '## Derivation',
    `- D1 · from ${factRefs}`,
    '  （一步推理：由已确认的部分推出什么）',
    '',
    '## Conclusion',
    '- C1 · depends: D1',
    '  （结论：一句可执行的判断）',
    '',
    '## Revisit',
    '- R1 · A1',
    '  （什么事件发生时，这条结论必须重估）',
    '',
  ].join('\n')
}

export function templateNotes({ cwd, ledgerPath, facts }) {
  const notes = [`建议写入：${ledgerPath}（相对根目录 ${cwd}）`, '写完把文件路径传给 first_principles_check，verdict=pass 之后再动手。']
  notes.push(
    facts.length > 0
      ? '上面 F1/F2 的原文已经从真实文件里取好了，可以直接用；其余条目换成你自己读到的行。'
      : '这个目录里没找到合适的锚点文件，F1 要你自己填一个真实存在、能逐字比对的 路径:行（任意文本文件都行）。',
  )
  notes.push('review_after 默认填了 30 天后：到期没复查，/fp status 会把它标成过期。')
  return notes
}
