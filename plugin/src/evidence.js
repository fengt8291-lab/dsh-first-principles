import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_WALK_ENTRIES = 20000
/** 超过这个行数就不再逐条数「引文是否出现多次」——那是 O(行数×事实数) 的活。 */
export const MAX_DUP_SCAN_LINES = 20000
const SKIP_DIRS = new Set(['node_modules', '.git', '.fp', 'dist', 'build', 'out', 'coverage', '.next', 'target', 'vendor'])

export function normalize(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

/** 统一成 posix 相对路径：Windows 反斜杠、开头的 ./ 都在这里归一，避免同一文件两种写法。 */
export function toPosixPath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
}

export function truncate(text, limit = 120) {
  const value = String(text ?? '')
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

/** ``fact`` 里反引号包住的那段原文。 */
export function extractQuote(fields) {
  for (const field of fields) {
    const matched = /`([^`]+)`/.exec(field)
    if (matched) return matched[1]
  }
  return null
}

// \p{L} 让中文/日文文件名也能当引用；先认「整段就是路径:行」的严格形态，
// 这样带空格的文件名（我的 模块/x.ts:12）也可用，再退回句子里夹引用的宽松形态。
const CITATION_FIELD_RE = /^(.+?):(\d+)(?:-(\d+))?$/u
const CITATION_RE = /(?:^|[\s（(])([\p{L}\p{N}._/@+~\\-]+):(\d+)(?:-(\d+))?/u

/** ``路径:行`` 或 ``路径:起-止``，路径必须带 . 或 /，避免把 12:30 之类当成引用。 */
export function extractCitation(fields) {
  for (const field of fields) {
    const whole = CITATION_FIELD_RE.exec(String(field ?? '').trim())
    if (whole && /[./\\]/.test(whole[1]) && !whole[1].includes('`')) {
      const start = Number(whole[2])
      const end = whole[3] ? Number(whole[3]) : start
      return { path: whole[1].trim(), start, end: Math.max(start, end) }
    }
    const matched = CITATION_RE.exec(field)
    if (matched && /[./\\]/.test(matched[1])) {
      const start = Number(matched[2])
      const end = matched[3] ? Number(matched[3]) : start
      return { path: matched[1], start, end: Math.max(start, end) }
    }
  }
  return null
}

export function resolveInside(cwd, relative) {
  const root = path.resolve(cwd)
  const absolute = path.resolve(root, relative)
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null
  return absolute
}

export function createReader(cwd, options = {}) {
  const cache = new Map()
  const maxBytes = Number.isFinite(options.maxFileBytes) && options.maxFileBytes > 0 ? options.maxFileBytes : MAX_FILE_BYTES
  return {
    maxBytes,
    /** 读一次缓存一次：同一个文件被多条事实引用时不重复 IO。 */
    lines(relative) {
      const normalizedPath = toPosixPath(relative)
      const absolute = resolveInside(cwd, normalizedPath)
      if (!absolute) {
        return { error: 'E015', message: `引用路径在项目目录之外：${relative}`, hint: '引用必须写成相对项目根目录的路径，不能用绝对路径或 ../ 跳出去' }
      }
      if (cache.has(absolute)) return cache.get(absolute)
      let value
      try {
        const stat = statSync(absolute)
        if (!stat.isFile()) value = { error: 'E004', message: `${normalizedPath} 不是一个普通文件` }
        else if (stat.size > maxBytes) value = { error: 'E004', message: `${normalizedPath} 超过 ${Math.round(maxBytes / 1024)}KB，不适合作为证据`, hint: '换成更小的文件，或把证据挪到能逐字引用的片段里' }
        else {
          const buffer = readFileSync(absolute)
          if (buffer.includes(0)) {
            value = { error: 'E004', message: `${normalizedPath} 看起来是二进制文件`, hint: '证据必须是可逐字引用的文本' }
          } else {
            const text = buffer.toString('utf8').replace(/^\uFEFF/, '')
            const lines = text.split(/\r?\n/)
            value = { lines, normalized: lines.map((line) => normalize(line)), mtimeMs: stat.mtimeMs }
          }
        }
      } catch (error) {
        value = { error: 'E004', message: `找不到 ${normalizedPath}（${error?.code ?? '读取失败'}）`, hint: '确认路径相对项目根目录，且文件确实存在' }
      }
      cache.set(absolute, value)
      return value
    },
  }
}

/** 校验一条事实：路径存在、行号在范围内、该行原文确实能被引文匹配到。 */
export function verifyFact(fact, reader) {
  if (!fact.citation) {
    return { ok: false, code: 'E003', message: '事实没有 `路径:行` 引用', hint: '写成：F1 · src/a.ts:42 · `该行原文`' }
  }
  if (!fact.quote) {
    return { ok: false, code: 'E003', message: `事实 ${fact.id ?? ''} 没有反引号原文`.replace('  ', ' '), hint: '把目标行的原文原样放进反引号，校验器会逐字比对' }
  }
  const { path: relative, start, end } = fact.citation
  const read = reader.lines(relative)
  if (read.error) return { ok: false, code: read.error, message: read.message, hint: read.hint }
  const lines = read.lines
  if (start < 1 || start > lines.length || end > lines.length || end < start) {
    return { ok: false, code: 'E005', message: `行号越界：${relative}:${start}${end > start ? `-${end}` : ''}，该文件只有 ${lines.length} 行` }
  }
  const haystack = normalize(lines.slice(start - 1, end).join('\n'))
  const needle = normalize(fact.quote)
  if (!needle || !haystack.includes(needle)) {
    return {
      ok: false,
      code: 'E006',
      message: `引文与 ${relative}:${start} 不符`,
      hint: `该行实际是：${truncate(lines[start - 1]?.trim(), 160)}`,
    }
  }
  const normalizedLines = read.normalized ?? lines.map((line) => normalize(line))
  let duplicated = false
  if (normalizedLines.length <= MAX_DUP_SCAN_LINES) {
    let occurrences = 0
    for (const line of normalizedLines) if (line.includes(needle)) occurrences += 1
    duplicated = occurrences > 1
  }
  return { ok: true, line: start, duplicated }
}

const REGEX_SPECIALS = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'])

export function globToRegExp(pattern) {
  const source = pattern.replace(/^\.\//, '').replace(/\\/g, '/')
  let out = '^'
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '*') {
      if (source[index + 1] === '*') {
        index += 1
        if (source[index + 1] === '/') {
          index += 1
          out += '(?:.*/)?'
        } else {
          out += '.*'
        }
      } else {
        out += '[^/]*'
      }
    } else if (char === '?') {
      out += '[^/]'
    } else if (REGEX_SPECIALS.has(char)) {
      out += `\\${char}`
    } else {
      out += char
    }
  }
  return new RegExp(`${out}$`)
}

export function isGlob(pattern) {
  return /[*?[\]{}]/.test(pattern)
}

function walk(root, limit) {
  const found = []
  const stack = ['']
  let truncated = false
  while (stack.length) {
    if (found.length >= limit) {
      truncated = true
      break
    }
    const relative = stack.pop()
    let entries
    try {
      entries = readdirSync(path.join(root, relative), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (found.length >= limit) {
        truncated = true
        break
      }
      const child = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(child)
      } else if (entry.isFile()) {
        found.push(child)
      }
    }
  }
  return { files: found, truncated }
}

/**
 * scope 的每条模式都必须至少匹配到一个文件，否则台账的观察范围就是空的。
 * 文件多到扫不完时返回 truncated=true，让 E002 的提示能说清「可能是没扫到」而不是「不存在」。
 */
export function resolveScope(cwd, patterns, options = {}) {
  const files = new Set()
  const missing = []
  const limit = Number.isFinite(options.maxEntries) && options.maxEntries > 0 ? options.maxEntries : MAX_WALK_ENTRIES
  let listing = null
  let truncated = false
  for (const pattern of patterns) {
    const normalized = toPosixPath(pattern)
    if (!isGlob(normalized)) {
      const absolute = resolveInside(cwd, normalized)
      let exists = false
      try {
        exists = Boolean(absolute) && statSync(absolute).isFile()
      } catch {
        exists = false
      }
      if (!exists) missing.push(normalized)
      continue
    }
    if (!listing) {
      listing = walk(path.resolve(cwd), limit)
      truncated = listing.truncated
      listing = listing.files
    }
    const regex = globToRegExp(normalized)
    const matched = listing.filter((file) => regex.test(file))
    if (matched.length === 0) missing.push(normalized)
    for (const file of matched) files.add(file)
  }
  return { files, missing, truncated }
}

export function fileMtime(cwd, relative) {
  try {
    return statSync(path.resolve(cwd, relative)).mtimeMs
  } catch {
    return null
  }
}
