window.__ModuleLoader__.load({
  id: 'dsh-first-principles',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState, useCallback } = React

    const ENDPOINT = '/x-first-principles'
    const POLL_MS = 5000

    const FONT = 12
    const MUTED = 'var(--dsh-muted-color, rgba(127,127,127,0.95))'
    const LINE = 'var(--dsh-border-color, rgba(127,127,127,0.28))'

    const styles = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: FONT, lineHeight: 1.45, color: 'inherit' },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      chip: {
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px',
        border: `1px solid ${LINE}`, borderRadius: 999, background: 'transparent', color: 'inherit',
        font: 'inherit', cursor: 'pointer',
      },
      muted: { color: MUTED },
      dot: { width: 7, height: 7, borderRadius: '50%', display: 'inline-block' },
      panel: { border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', display: 'grid', gap: 8 },
      title: { fontWeight: 600, fontSize: FONT },
      list: { display: 'grid', gap: 3, margin: 0, padding: 0, listStyle: 'none' },
      item: { display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' },
      code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 },
      fix: { color: 'var(--dsh-success-color, #2e9e5b)' },
      bad: { color: 'var(--dsh-danger-color, #d9534f)' },
      btn: {
        font: 'inherit', padding: '2px 8px', borderRadius: 6, border: `1px solid ${LINE}`,
        background: 'transparent', color: 'inherit', cursor: 'pointer',
      },
    }

    function verdictDot(verdict) {
      const color = verdict === 'pass' ? 'var(--dsh-success-color, #2e9e5b)' : verdict === 'template' ? 'var(--dsh-warning-color, #d9a441)' : 'var(--dsh-danger-color, #d9534f)'
      return h('span', { style: { ...styles.dot, background: color } })
    }

    function timeOf(iso) {
      if (!iso) return ''
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }

    function FirstPrinciplesPanel(props) {
      const sessionId = props?.sessionId ?? null
      const [state, setState] = useState(null)
      const [error, setError] = useState(null)
      const [open, setOpen] = useState(false)
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        try {
          const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : ''
          const response = await fetch(`${ENDPOINT}/state${query}`, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setState(await response.json())
          setError(null)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }, [sessionId])

      useEffect(() => {
        let alive = true
        load()
        const timer = setInterval(() => { if (alive) load() }, POLL_MS)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [load])

      const toggleGate = useCallback(async () => {
        if (!state || busy) return
        setBusy(true)
        try {
          const response = await fetch(`${ENDPOINT}/gate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: !state.gate.enabled, session: sessionId }),
          })
          const payload = await response.json()
          if (payload?.state) setState(payload.state)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setBusy(false)
        }
      }, [state, busy, sessionId])

      if (error && !state) {
        return h('div', { style: { ...styles.wrap, ...styles.muted } }, `第一性原理台账：读不到插件数据面（${error}）`)
      }
      if (!state) {
        return h('div', { style: { ...styles.wrap, ...styles.muted } }, '第一性原理台账：读取中…')
      }

      const summary = state.summary ?? {}
      const ledgers = state.ledgers ?? []
      const rounds = state.rounds ?? []
      const recent = state.recent ?? []
      const gateOn = Boolean(state.gate?.enabled)
      const fixedTotal = rounds.reduce((sum, round) => sum + (round.fixed?.length ?? 0), 0)

      return h('div', { style: styles.wrap },
        h('div', { style: styles.row },
          h('span', { style: { fontWeight: 600 } }, '第一性原理'),
          h('button', {
            type: 'button', onClick: toggleGate, disabled: busy,
            title: gateOn ? '点击关闭闸门' : '点击打开闸门：不可逆操作前会先问一句',
            style: { ...styles.chip, borderColor: gateOn ? 'var(--dsh-warning-color, #d9a441)' : LINE },
          }, h('span', { style: { ...styles.dot, background: gateOn ? 'var(--dsh-warning-color, #d9a441)' : 'transparent', border: `1px solid ${LINE}` } }), gateOn ? '闸门开' : '闸门关'),
          h('span', { style: styles.muted }, `${summary.total ?? 0} 次校验`),
          h('span', { style: styles.muted }, `拦下 ${summary.failed ?? 0}`),
          h('span', { style: styles.muted }, `${ledgers.length} 份台账`),
          fixedTotal > 0 ? h('span', { style: styles.fix }, `已修 ${fixedTotal} 个错误码`) : null,
          state.version ? h('span', { style: styles.muted, title: '插件版本' }, `v${state.version}`) : null,
          state.command && state.command.registered === false
            ? h('span', { style: styles.bad, title: '斜杠命令没注册上：命令会被当成普通消息发给模型' }, '命令未注册')
            : null,
          h('button', { type: 'button', onClick: () => setOpen(!open), style: styles.btn }, open ? '收起' : '详情'),
        ),
        open ? h('div', { style: styles.panel },
          h('div', null,
            h('div', { style: styles.title }, '这一轮修掉的错'),
            rounds.length === 0
              ? h('div', { style: styles.muted }, '还没有「改完再校验」的记录。跑一次校验、把错误改掉、再跑一次，这里就会出现差集。')
              : h('ul', { style: styles.list }, rounds.slice(0, 6).map((round, index) =>
                h('li', { key: `${round.ledger}-${index}`, style: styles.item },
                  h('span', { style: styles.muted }, timeOf(round.ts)),
                  h('span', null, round.ledger),
                  (round.fixed ?? []).length ? h('span', { style: styles.fix }, `修掉 ${round.fixed.join(' ')}`) : null,
                  (round.added ?? []).length ? h('span', { style: styles.bad }, `新增 ${round.added.join(' ')}`) : null,
                  h('span', { style: { ...styles.muted, ...styles.code } }, round.verdict === 'pass' ? '→ pass' : '→ fail'),
                ),
              )),
          ),
          h('div', null,
            h('div', { style: styles.title }, '台账'),
            ledgers.length === 0
              ? h('div', { style: styles.muted }, '还没有台账。让模型调一次 first_principles_check 拿骨架。')
              : h('ul', { style: styles.list }, ledgers.slice(0, 6).map((ledger) =>
                h('li', { key: ledger.name, style: styles.item },
                  verdictDot(ledger.verdict),
                  h('span', null, ledger.name),
                  h('span', { style: styles.muted }, String(ledger.verdict).toUpperCase()),
                  ledger.meta?.reviewAfter ? h('span', { style: ledger.meta.expired ? styles.bad : styles.muted }, ledger.meta.expired ? `已过期 ${Math.abs(ledger.meta.daysLeft ?? 0)} 天` : `复查还有 ${ledger.meta.daysLeft ?? '?'} 天`) : h('span', { style: styles.muted }, '未设复查'),
                ),
              )),
          ),
          h('div', null,
            h('div', { style: styles.title }, '最近校验'),
            recent.length === 0
              ? h('div', { style: styles.muted }, '本会话还没有校验记录。')
              : h('ul', { style: styles.list }, recent.slice(0, 6).map((run, index) =>
                h('li', { key: `${run.ts}-${index}`, style: styles.item },
                  h('span', { style: styles.muted }, timeOf(run.ts)),
                  h('span', null, run.ledger),
                  h('span', { style: { ...styles.code, ...(run.verdict === 'pass' ? styles.fix : styles.bad) } }, (run.errors ?? []).join(' ') || 'pass'),
                ),
              )),
          ),
          (state.gateEvents ?? []).length > 0 ? h('div', null,
            h('div', { style: styles.title }, '闸门最近判定'),
            h('ul', { style: styles.list }, state.gateEvents.slice(0, 4).map((event, index) =>
              h('li', { key: `${event.ts}-${index}`, style: styles.item },
                h('span', { style: styles.muted }, timeOf(event.ts)),
                h('span', { style: styles.code }, event.rule ?? event.tool ?? ''),
                h('span', { style: event.decision === 'ask' ? styles.bad : styles.muted }, event.decision === 'ask' ? '问了' : '放行'),
              ),
            )),
          ) : null,
          h('div', { style: { ...styles.muted, ...styles.code } },
            `${state.dir}/ledgers/ · ${state.gate?.enabled ? '' : '闸门当前对本进程关闭'}${error ? ` · 上次刷新失败：${error}` : ''}`),
        ) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'first-principles',
          order: 6,
        }, FirstPrinciplesPanel))
      },
    }
  },
})
