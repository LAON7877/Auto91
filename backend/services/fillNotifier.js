// 繁體中文註釋
// 成交通知統一服務：單則通知、嚴格動作/方向、REST 槓桿、去重

const axios = require('axios')
const crypto = require('crypto')
const ccxt = require('ccxt')
const logger = require('../utils/logger')
const { enqueueFill } = require('./telegram')
const { computeCloseRealizedPnl, round2 } = require('./pnlCalculator')
const { getLastAccountMessageByUser } = require('./accountMonitor')
const { esc, ymd } = require('./tgFormat')
const User = require('../models/User')

function normPair(user, symbol) {
  if (user?.pair) return user.pair
  const s = String(symbol || '')
  if (s.includes('/')) return s
  if (s.includes('-')) return s.replace('-', '/')
  if (s.toUpperCase().endsWith('USDT')) return `${s.slice(0, -4)}/USDT`
  return s
}

async function fetchLeverageForFill(user, exchangeId, pair, opts = {}) {
  try {
    const creds = user.getDecryptedKeys()
    if (exchangeId === 'binance') {
      const ts = Date.now()
      const recv = 60000
      const query = `timestamp=${ts}&recvWindow=${recv}`
      const sig = crypto.createHmac('sha256', creds.apiSecret).update(query).digest('hex')
      const url = `https://fapi.binance.com/fapi/v2/positionRisk?${query}&signature=${sig}`
      const res = await axios.get(url, { headers: { 'X-MBX-APIKEY': creds.apiKey } })
      const arr = Array.isArray(res.data) ? res.data : []
      const sym = String((pair || '').replace('/', ''))
      const row = arr.find(r => String(r.symbol) === sym)
      return Number(row?.leverage || 0)
    }
    if (exchangeId === 'okx') {
      const method = 'GET'
      const instId = (pair || '').replace('/', '-') + '-SWAP'
      const requestPath = `/api/v5/account/positions?instType=SWAP&instId=${instId}`
      const ts2 = new Date().toISOString()
      const prehash2 = ts2 + method + requestPath
      const sign2 = crypto.createHmac('sha256', creds.apiSecret).update(prehash2).digest('base64')
      const url2 = `https://www.okx.com${requestPath}`
      const res2 = await axios.get(url2, { headers: { 'OK-ACCESS-KEY': creds.apiKey, 'OK-ACCESS-SIGN': sign2, 'OK-ACCESS-TIMESTAMP': ts2, 'OK-ACCESS-PASSPHRASE': creds.apiPassphrase || '' } })
      const data2 = Array.isArray(res2.data?.data) ? res2.data.data : []
      const rows = data2.filter(r => String(r.instId) === instId)
      if (rows.length === 0) return 0
      const side = String(opts.side || '').toLowerCase()
      const isClose = !!opts.isReduceOnly
      // 先嘗試嚴格匹配 posSide（若帳戶為對沖模式）
      if (isClose && side) {
        const wanted = (side === 'sell') ? 'long' : 'short'
        const bySide = rows.find(r => String(r.posSide || '').toLowerCase() === wanted)
        if (bySide && Number(bySide.lever)) return Number(bySide.lever)
      }
      // 然後取持倉量不為 0 的列（淨倉模式或尚未完全歸零）
      const withPos = rows.find(r => Number(r.pos || r.posCcy || 0) !== 0 && Number(r.lever))
      if (withPos) return Number(withPos.lever)
      // 最後取該 instId 下 lever 最大值，避免 0 值回退到使用者預設
      let best = 0
      for (const r of rows) { const lv = Number(r.lever || 0); if (lv > best) best = lv }
      return best
    }
  } catch (_) { /* ignore */ }
  return 0
}

// 移除複雜的 prevSigned 邏輯，改用 reduceOnly 字段明確判斷

const { getUserPrefs } = require('./alerts/preferences')

async function notifyFill(user, { exchange, symbol, side, amount, price, ts, orderId, reduceOnly, realized }) {
  try {
    // 訂閱到期：過期則不發送成交通知
    try { if (user.subscriptionEnd && new Date(user.subscriptionEnd).getTime() < Date.now()) return } catch (_) {}
    // 偏好：成交通知開關（預設開）
    try { const prefs = await getUserPrefs(user._id); if (prefs && prefs.fills === false) return } catch (_) {}
    const symbolNorm = normPair(user, symbol)
    
    // 1) 正規化 reduceOnly（OKX 常為字串 'true'）
    const isReduceOnly = (typeof reduceOnly === 'boolean') ? reduceOnly : (String(reduceOnly).toLowerCase() === 'true')

    // 先取得最近的持倉快取（供方向推斷與盈虧計算）
    const last = getLastAccountMessageByUser(user._id.toString()) || {}
    const p = (Array.isArray(last.positions) ? last.positions : []).find(x => String(x.symbol||'').toUpperCase() === String(symbolNorm||'').toUpperCase())

    // 與幣安一致：先判斷是否平倉；方向顯示「開倉方向」（多單/空單）
    let action
    let direction
    // 先以 reduceOnly 判斷，若缺失則以當前持倉方向 + 成交方向判斷是否為平倉
    let isClose = !!isReduceOnly
    try {
      if (!isClose && p && p.side && p.side !== 'flat') {
        const posSide = String(p.side).toLowerCase() // long/short
        if ((posSide === 'long' && side === 'sell') || (posSide === 'short' && side === 'buy')) {
          isClose = true
        }
      }
    } catch (_) {}

    if (isClose) {
      action = '平倉'
      // 平倉顯示原始開倉方向
      if (p && p.side && p.side !== 'flat') {
        direction = (String(p.side).toLowerCase() === 'long') ? '多單' : '空單'
      } else {
        // 無持倉快取時以成交方向反推
        direction = (side === 'sell') ? '多單' : '空單'
      }
    } else {
      action = '開倉'
      direction = (side === 'buy') ? '多單' : '空單'
    }
  
    
    const levFetched = await fetchLeverageForFill(user, String(exchange||'').toLowerCase(), symbolNorm, { side, isReduceOnly })
    // 槓桿一律以 REST 回傳為準；若抓不到再回退持倉快取，最後才是使用者設定
    const lev = Number(levFetched) > 0 ? Number(levFetched) : (Number(p?.leverage || 0) > 0 ? Number(p.leverage) : Number(user.leverage || 0))
    const base = (symbolNorm || '').split('/')[0] || ''
    
    function fmtQtyDyn(q){
      const n = Number(q || 0)
      const s = n.toFixed(4)
      const parts = s.split('.')
      if (parts.length < 2) return n.toFixed(2)
      const f = parts[1]
      if (f[3] !== '0') return n.toFixed(4)
      if (f[2] !== '0') return n.toFixed(3)
      return n.toFixed(2)
    }
    const qtyText = fmtQtyDyn(amount)
    const priceText = Number(price||0).toFixed(2)
    const dateText = ymd(ts || Date.now(), process.env.TZ || 'UTC').replace(/-/g, '/')
    
    const lines = [
      `✅ 成交通知（${esc(dateText)}）`,
      `${esc(String(exchange||'').toUpperCase())}｜${esc((symbolNorm||'').replace('/',''))}｜${esc(String(lev||0))}x`,
      `單號：${esc(orderId)}`,
      `動作：${esc(action)}`,
      `方向：${esc(direction)}`,
      `數量：${esc(qtyText)} ${esc(base)}`,
      `均價：${esc(priceText)} USDT`
    ]
    
    // 平倉時計算並顯示盈虧：
    // 1) 優先用事件 realized（權威）
    // 2) 否則用統一計算器（以當前持倉快取 entryPrice 推算，不落盤）
    if (isReduceOnly === true) {
      const realizedNum = Number(realized)
      if (Number.isFinite(realizedNum)) {
        const r = round2(realizedNum)
        const pnlText = r >= 0 ? `+${r.toFixed(2)}` : r.toFixed(2)
        lines.push(`盈虧 ${esc(pnlText)} USDT`)
      } else {
        const posSide = (direction === '多單') ? 'long' : 'short'
        const pnlCalc = computeCloseRealizedPnl({
          positionSide: posSide,
          entryPrice: Number(p?.entryPrice || 0),
          fillPrice: Number(price || 0),
          quantity: Number(amount || 0),
          includeFees: false
        })
        if (Number.isFinite(pnlCalc)) {
          const r = round2(pnlCalc)
          const pnlText = r >= 0 ? `+${r.toFixed(2)}` : r.toFixed(2)
          lines.push(`盈虧 ${esc(pnlText)} USDT`)
        }
      }
    }
    let freshUser = user // prefer live user, but reload if telegramIds is missing
    let tg = String(freshUser?.telegramIds || '').split(',').map(s => s.trim()).filter(Boolean)
    if (!tg.length) {
      try {
        const reloaded = await User.findById(user._id).select('telegramIds').lean()
        if (reloaded && reloaded.telegramIds) {
          tg = String(reloaded.telegramIds).split(',').map(s => s.trim()).filter(Boolean)
        }
      } catch (_) {}
    }
    
    if (tg.length) {
      await enqueueFill({ chatIds: tg, text: lines.join('\n'), userId: String(user._id), orderId: String(orderId) })
    }
  } catch (err) {
    logger.error('[FillNotifier] 處理失敗', {
      userId: String(user._id),
      orderId: String(orderId),
      error: err.message,
      stack: err.stack
    })
  }
}

module.exports = { notifyFill }


