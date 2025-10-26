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

// 可調參數
const FILL_LIQ_REQUIRED_MAX_MS = Number(process.env.FILL_LIQ_REQUIRED_MAX_MS || 10000)
const FILL_LIQ_POLL_INTERVAL_MS = Number(process.env.FILL_LIQ_POLL_INTERVAL_MS || 200)
const FILL_LIQ_MEMO_TTL_MS = Number(process.env.FILL_LIQ_MEMO_TTL_MS || 1500)
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || ''

function delay(ms){ return new Promise(resolve => setTimeout(resolve, ms)) }

// 極短期記憶，降低同一 user+symbol 短時間內重複打 REST 的壓力
const LIQ_MEMO = new Map()
function memoKey(userId, symbol, side){ return `${String(userId)}:${String(symbol).toUpperCase()}:${String(side).toLowerCase()}` }
function setMemo(userId, symbol, side, price){ LIQ_MEMO.set(memoKey(userId, symbol, side), { price: Number(price||0), at: Date.now() }) }
function getMemo(userId, symbol, side){
  const rec = LIQ_MEMO.get(memoKey(userId, symbol, side))
  if (!rec) return null
  if ((Date.now() - rec.at) > FILL_LIQ_MEMO_TTL_MS) return null
  return Number(rec.price || 0)
}

async function reportSlack(text){
  try { if (!SLACK_WEBHOOK_URL) return; await axios.post(SLACK_WEBHOOK_URL, { text: String(text||'') }) } catch (_) {}
}

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

// 權威單次抓取強平價（不含輪詢與檢核）
async function fetchLiquidationPriceREST(user, exchangeId, pair, opts = {}) {
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
      const liq = Number(row?.liquidationPrice || 0)
      return Number.isFinite(liq) ? liq : 0
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
      if (!rows.length) return 0
      const side = String(opts.side || '').toLowerCase()
      // 先嘗試 posSide 嚴格匹配（對沖模式）
      if (side) {
        const wantedPos = (side === 'buy') ? 'long' : 'short'
        const byPos = rows.find(r => String(r.posSide || '').toLowerCase() === wantedPos)
        if (byPos && Number.isFinite(Number(byPos.liqPx))) return Number(byPos.liqPx)
      }
      // 其次選擇持倉量不為 0 的列
      const withPos = rows.find(r => Number(r.pos || r.posCcy || 0) !== 0 && Number.isFinite(Number(r.liqPx)))
      if (withPos) return Number(withPos.liqPx)
      // 最後選擇有 liqPx 的任一列（保底）
      const any = rows.find(r => Number.isFinite(Number(r.liqPx)))
      return any ? Number(any.liqPx) : 0
    }
  } catch (_) { /* ignore */ }
  return 0
}

function validateLiqAgainstFill({ side, liq, fill }){
  const liqNum = Number(liq)
  const fillNum = Number(fill)
  if (!Number.isFinite(liqNum) || liqNum <= 0) return false
  if (!Number.isFinite(fillNum) || fillNum <= 0) return true // 若均價缺失則不做方向檢核
  const s = String(side || '').toLowerCase()
  if (s === 'buy') return liqNum < fillNum
  if (s === 'sell') return liqNum > fillNum
  return true
}

async function fetchLiquidationPriceForFill(user, exchangeId, pair, { side, fillPrice, maxWaitMs, intervalMs } = {}) {
  const userId = user._id.toString()
  const symbol = String(pair || '')
  const s = String(side || '').toLowerCase()
  const maxMs = Number.isFinite(Number(maxWaitMs)) ? Number(maxWaitMs) : FILL_LIQ_REQUIRED_MAX_MS
  const stepMs = Number.isFinite(Number(intervalMs)) ? Number(intervalMs) : FILL_LIQ_POLL_INTERVAL_MS

  // Memo 命中直接返回（僅 1.5s 內）
  try {
    const cached = getMemo(userId, symbol, s)
    if (Number(cached) > 0 && validateLiqAgainstFill({ side: s, liq: cached, fill: fillPrice })) return Number(cached)
  } catch (_) {}

  const startedAt = Date.now()
  let attempts = 0
  while ((Date.now() - startedAt) <= maxMs) {
    attempts++
    const liq = await fetchLiquidationPriceREST(user, exchangeId, symbol, { side: s })
    if (validateLiqAgainstFill({ side: s, liq, fill: fillPrice })) {
      setMemo(userId, symbol, s, liq)
      return Number(liq)
    }
    await delay(stepMs)
  }
  const spent = Date.now() - startedAt
  const msg = `[FillNotifier] 強平價等待超時，將不上送通知: user=${userId} symbol=${symbol} side=${s} attempts=${attempts} spentMs=${spent}`
  logger.warn(msg)
  reportSlack(msg).catch(() => {})
  return 0
}

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
    
    // 開倉：阻塞等待強平價（權威 REST），若 10 秒內仍取不到正確值，則不上送通知
    if (isClose !== true) {
      const liq = await fetchLiquidationPriceForFill(user, String(exchange||'').toLowerCase(), symbolNorm, {
        side,
        fillPrice: Number(price || 0),
        maxWaitMs: FILL_LIQ_REQUIRED_MAX_MS,
        intervalMs: FILL_LIQ_POLL_INTERVAL_MS
      })
      if (!Number.isFinite(Number(liq)) || Number(liq) <= 0) {
        // 不發送；嚴格遵守「一定要帶且正確」
        return
      }
      const liqText = Number(liq).toFixed(2)
      lines.push(`強平：${esc(liqText)} USDT`)
    }

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


