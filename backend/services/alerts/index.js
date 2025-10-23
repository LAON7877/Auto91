// 繁體中文註釋
// Alerts 中央初始化：
// - 讀取使用者偏好
// - 接收 account_update 事件，套用 positions/account 規則（預設關閉）
// - 預留 system/risk 事件入口

const bus = require('../eventBus')
const { getUserPrefs } = require('./preferences')
const { sendTelegram, sendTelegramHourly, sendTelegramWindowed } = require('./dispatcher')
const { evalPositionAccountChanges } = require('./rules/positions')
const { DEFAULT_PREFS } = require('./constants')

function extractChatIds(user) {
  try { return String(user.telegramIds || '').split(',').map(s => s.trim()).filter(Boolean) } catch (_) { return [] }
}

function windowKeyNow(min, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || process.env.TZ || 'Asia/Taipei', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date())
  const o = {}; for (const p of parts) o[p.type] = p.value
  const bucketMinute = String(Math.floor(Number(o.minute) / Math.max(1, Number(min))) * Math.max(1, Number(min))).padStart(2, '0')
  return `${o.year}-${o.month}-${o.day}-${o.hour}:${bucketMinute}`
}

function initAlerts() {
  // 帳戶摘要更新事件（由 accountMonitor 觸發）
  // payload: { user, summary, positions } 或完整 account_update
  bus.on('account:update', async (payload) => {
    try {
      const user = payload && payload.user
      if (!user || !user._id) return
      // 訂閱到期：過期則不發送風險型帳戶告警
      try { if (user.subscriptionEnd && new Date(user.subscriptionEnd).getTime() < Date.now()) return } catch (_) {}
      const prefs = await getUserPrefs(user._id)
      if (!prefs || prefs.acctPos !== true) return // 預設關閉

      const prev = payload.prev || null
      const curr = { summary: payload.summary, positions: payload.positions }
      const items = evalPositionAccountChanges({ curr, prev, thresholds: prefs.thresholds || DEFAULT_PREFS.thresholds })
      if (!items.length) return
      const chatIds = extractChatIds(user)
      if (!chatIds.length) return

      const who = user.name || user.uid || String(user._id || '')
      const tz = process.env.TZ || 'Asia/Taipei'
      // 20% 變動幅度再發：在此讀寫記憶體快取（僅進程內）
      const CACHE = sendTelegramWindowed.__CACHE || (sendTelegramWindowed.__CACHE = new Map())
      const REC = sendTelegramWindowed.__REC || (sendTelegramWindowed.__REC = new Map())
      const id = String(user._id)
      const now = Date.now()
      const activeScopes = new Set()
      for (const it of items) {
        const text = `📣 ${who}｜${it.text}`
        const scope = String(it.scope || 'misc')
        const key = `${id}:${scope}`
        const last = CACHE.get(key)
        let shouldSend = true
        if (last) {
          const lastSeverityRank = last.sev === 'severe' ? 3 : last.sev === 'critical' ? 2 : 1
          const currSeverityRank = it.severity === 'severe' ? 3 : it.severity === 'critical' ? 2 : 1
          // 跨更嚴重等級：立即發
          if (currSeverityRank > lastSeverityRank) {
            shouldSend = true
          } else {
            // 同等級：檢查變動幅度≥20%才發（方向為「越危險越小」或「越危險越負」）
            const a = Number(it.value)
            const b = Number(last.value)
            if (scope === 'liq' || scope === 'margin') {
              // 越小越危險：a <= b * 0.8 才重發
              shouldSend = a <= b * 0.8
            } else if (scope === 'unp' || scope === 'rlz') {
              // 越負越危險：|a| >= |b| * 1.2 才重發
              shouldSend = Math.abs(a) >= Math.abs(b) * 1.2
            }
          }
        }
        if (!shouldSend) continue
        // 記錄最新
        CACHE.set(key, { ts: now, sev: it.severity, value: it.value })
        const windowMin = Number(it.windowMin || 60)
        const wk = windowKeyNow(windowMin, tz)
        const scopeKey = it.key
        await sendTelegramWindowed({ chatIds, text, userId: user._id, windowKey: wk, scopeKey })
        activeScopes.add(scope)
      }

      // 風險恢復安全：連續安全超過設定時間則發恢復訊息（含數值明細）
      const RECOVERY_MINUTES_BY_SCOPE = { liq: 30, margin: 60, unp: 60, rlz: 120 }
      const SCOPE_LABEL = { liq: '強平距離', margin: '保證金可用', unp: '未實現盈虧', rlz: '日內已實現盈虧' }
      const SCOPES = ['liq','margin','unp','rlz']
      for (const scope of SCOPES) {
        const k = `${id}:${scope}`
        const hadAlert = CACHE.has(k)
        if (!hadAlert) continue
        if (activeScopes.has(scope)) {
          // 仍在告警中，清除恢復計時
          REC.delete(`${k}:rec`)
          continue
        }
        const recKey = `${k}:rec`
        const rec = REC.get(recKey)
        if (!rec) {
          REC.set(recKey, { since: now })
          continue
        }
        const scopeMinutes = Number(RECOVERY_MINUTES_BY_SCOPE[scope] || 60)
        if ((now - rec.since) >= scopeMinutes * 60 * 1000) {
          // 發送恢復訊息，並清除該 scope 的上一輪告警狀態
          const label = SCOPE_LABEL[scope] || scope
          let detail = ''
          try {
            const positions = Array.isArray(curr.positions) ? curr.positions : []
            const pos = positions.find(p => Math.abs(Number(p?.contracts || 0)) > 0) || null
            const sym = pos ? String(pos.symbol || '') : ''
            const base = sym && sym.includes('/') ? sym.split('/') [0] : sym
            const side = pos ? String(pos.side || '').toLowerCase() : ''
            const dirText = side === 'long' ? '多單' : (side === 'short' ? '空單' : '-')
            const qty = pos ? Math.abs(Number(pos.contracts || 0)) : 0
            const lev = pos ? Number(pos.leverage || 0) : 0
            const mark = pos ? Number(pos.markPrice || 0) : 0
            const liq = pos ? Number(pos.liquidationPrice || 0) : 0
            const s = curr.summary || {}
            const avail = Number(s.availableTransfer || 0)
            const margin = Number(s.marginBalance || s.walletBalance || 0)
            const unp = pos ? Number(pos.unrealizedPnl || 0) : Number(s.unrealizedPnl || 0)
            const pnl1d = Number(s.pnl1d || 0)
            if (scope === 'liq' && pos && mark > 0 && liq > 0) {
              let ratio = 1
              if (dirText === '多單') ratio = (mark - liq) / Math.max(mark, 1e-9)
              else if (dirText === '空單') ratio = (liq - mark) / Math.max(liq, 1e-9)
              const pct = Math.max(0, ratio * 100).toFixed(1)
              detail = `${sym}｜${dirText}｜槓桿 ${lev}x｜數量 ${qty} ${base}｜標記價 ${mark.toFixed(2)}｜強平價 ${liq.toFixed(2)}｜距離 ${pct}%`
            } else if (scope === 'margin' && margin > 0) {
              const pct = Math.max(0, (avail / margin) * 100).toFixed(1)
              detail = `可用 ${avail.toFixed(2)} / 保證金 ${margin.toFixed(2)} USDT｜可用比 ${pct}%`
            } else if (scope === 'unp') {
              detail = `未實現盈虧 ${unp.toFixed(2)} USDT` + (pos ? `\n${sym}｜${dirText}｜槓桿 ${lev}x｜數量 ${qty} ${base}` : '')
            } else if (scope === 'rlz') {
              detail = `今日已實現 ${pnl1d.toFixed(2)} USDT`
            }
          } catch (_) {}
          const text = detail ? `✅ ${who}｜風險恢復安全｜${label}\n${detail}` : `✅ ${who}｜風險恢復安全｜${label}`
          const wk = windowKeyNow(scopeMinutes, tz)
          await sendTelegramWindowed({ chatIds, text, userId: user._id, windowKey: wk, scopeKey: `${scope}-recovered` })
          REC.delete(recKey)
          CACHE.delete(k)
        }
      }
    } catch (_) {}
  })

  // 預留：系統/風控事件入口（之後在私有 WS/補位處觸發 bus.emit('alerts:system', {...}))
  bus.on('alerts:system', async (payload) => {
    try {
      const user = payload && payload.user
      if (!user || !user._id) return
      // 訂閱到期：過期則不發送系統告警
      try { if (user.subscriptionEnd && new Date(user.subscriptionEnd).getTime() < Date.now()) return } catch (_) {}
      const prefs = await getUserPrefs(user._id)
      if (!prefs || prefs.riskOps !== true) return
      const chatIds = extractChatIds(user)
      if (!chatIds.length) return
      const text = payload.text || ''
      if (!text) return

      // 將系統告警改為「視窗去重」而非「每日去重」，避免同日只送一則
      const tz = process.env.TZ || 'Asia/Taipei'
      const windowMin = Number(process.env.ALERTS_SYSTEM_WINDOW_MIN || 5)
      const wk = windowKeyNow(windowMin, tz)
      const lower = String(text).toLowerCase()
      const ex = lower.includes('okx') ? 'okx' : (lower.includes('binance') ? 'binance' : 'misc')
      let scopeKey = `system:${ex}`
      if (lower.includes('已重連') || lower.includes('reconnect')) scopeKey = `ws-reconnect:${ex}`
      else if (lower.includes('關閉') || lower.includes('close')) scopeKey = `ws-close:${ex}`
      else if (lower.includes('錯誤') || lower.includes('error')) scopeKey = `ws-error:${ex}`

      await sendTelegramWindowed({ chatIds, text, userId: user._id, windowKey: wk, scopeKey })
    } catch (_) {}
  })
}

module.exports = { initAlerts }





