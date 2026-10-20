import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * 项目根定位。
 *
 * 目标是「无论在谁的电脑上、无论什么项目结构都找得到台账」：
 *  1. 先向上找带台账目录（默认 .fp）的祖先——多数时候就是项目根；
 *  2. 再向上找带版本库/构建清单的祖先（.git、package.json、Cargo.toml…）；
 *  3. 都没有就用当前目录。
 *
 * 会话 cwd 是子目录（monorepo 的 packages/x、Windows 上从子盘符打开）时，这一步把它拉回项目根。
 */
export const ROOT_MARKERS = [
  '.git',
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
]

export const MAX_ROOT_DEPTH = 16

function isDirectory(absolute) {
  try {
    return statSync(absolute).isDirectory()
  } catch {
    return false
  }
}

function hasAny(dir, names) {
  for (const name of names) if (existsSync(path.join(dir, name))) return true
  return false
}

/**
 * 从 cwd 逐层向上，每层先看台账目录、再看项目标记，先命中的那层就是根。
 *
 * 为什么不再单独跑「只找 .fp」一遍：那样会让 `packages/x`（自带 package.json）
 * 一路跳到外层 monorepo 的 .fp 上，把子包的台账写到别人的项目里。
 * 现在「自己像一个项目」就近停下，想强制指定根就配 rootDir。
 *
 * @param {string} cwd 会话工作目录
 * @param {{dir?: string, maxDepth?: number}} [options]
 * @returns {{root: string, foundBy: 'ledger-dir'|'marker'|'cwd', depth: number}}
 */
export function findProjectRoot(cwd, options = {}) {
  const start = path.resolve(cwd || process.cwd())
  const dirName = options.dir ?? '.fp'
  const maxDepth = Number.isFinite(options.maxDepth) ? Math.max(0, options.maxDepth) : MAX_ROOT_DEPTH

  let current = start
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    if (isDirectory(path.join(current, dirName))) return { root: current, foundBy: 'ledger-dir', depth }
    if (hasAny(current, ROOT_MARKERS)) return { root: current, foundBy: 'marker', depth }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return { root: start, foundBy: 'cwd', depth: 0 }
}

/** 让上报里能看到「根是怎么定的」，用户排错时不用猜。 */
export function describeRoot(found) {
  if (!found) return ''
  if (found.foundBy === 'ledger-dir') return '根目录由 .fp 向上定位'
  if (found.foundBy === 'marker') return `根目录由项目标记向上定位（${found.depth} 层）`
  return '根目录＝当前目录'
}
