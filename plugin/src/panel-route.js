/**
 * 面板的 HTTP 面：宿主 webServer 上的 `/x-first-principles/*`。
 *
 * 只有两个动作——读状态、开关闸门。读是 GET，写是 POST，
 * 不落库、不缓存，所有判断都在调用方注入的 stateFor/setGate 里。
 * 这也是客户端插件唯一的数据通道（同源 fetch，不经 RPC）。
 */

export const PANEL_PREFIX = '/x-first-principles'
const MAX_BODY_BYTES = 16 * 1024

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

/**
 * @param {{ stateFor: (sessionId: string|null) => Promise<object>, setGate: (enabled: boolean) => void }} deps
 */
export function createPanelHandler({ stateFor, setGate }) {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (!url.pathname.startsWith(PANEL_PREFIX)) {
        sendJson(res, 404, { ok: false, error: 'outside prefix' })
        return
      }
      const route = url.pathname.slice(PANEL_PREFIX.length) || '/'
      const sessionId = url.searchParams.get('session') || null

      if (req.method === 'GET' && (route === '/state' || route === '/')) {
        sendJson(res, 200, await stateFor(sessionId))
        return
      }
      if (req.method === 'GET' && route === '/health') {
        sendJson(res, 200, { ok: true })
        return
      }
      if (req.method === 'POST' && route === '/gate') {
        const body = await readJson(req)
        if (typeof body.enabled !== 'boolean') {
          sendJson(res, 400, { ok: false, error: 'enabled must be boolean' })
          return
        }
        setGate(body.enabled)
        const state = await stateFor(body.session ?? sessionId)
        sendJson(res, 200, { ok: true, state })
        return
      }
      sendJson(res, 404, { ok: false, error: 'not found' })
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
    }
  }
}
