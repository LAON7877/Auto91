// 繁體中文註釋
// tradeExecutor：集中處理「信號 → 下單」的決策、風控、交易所差異、冪等

const ccxt = require('ccxt')
const logger = require('../utils/logger')
const crypto = require('crypto')
const priceCache = require('../utils/priceCache')
let BINANCE_TIME_OFFSET_MS = 0
async function binanceSyncServerTime() {
  try {
    const axios = require('axios')
    const res = await axios.get('https://fapi.binance.com/fapi/v1/time', { timeout: 5000 })
    const serverTime = Number(res?.data?.serverTime || 0)
    if (Number.isFinite(serverTime) && serverTime > 0) {
      BINANCE_TIME_OFFSET_MS = serverTime - Date.now()
      try { logger.info('binance_time_sync', { offsetMs: BINANCE_TIME_OFFSET_MS }) } catch (_) {}
    }
  } catch (_) {}
}
// 同 user+pair 串行鎖，避免快訊併發造成狀態衝突
const EXEC_LOCKS = new Map() // key -> Promise 佇列（單機）
async function withExecLock(key, fn) {
  // 若環境有 Redis（可選），使用分散式鎖；否則回退本機鎖
  try {
    const useRedis = process.env.REDIS_LOCK_URL
    if (useRedis) {
      const { createClient } = require('redis')
      const Redlock = require('redlock')
      if (!global.__redisClient) {
        global.__redisClient = createClient({ url: process.env.REDIS_LOCK_URL })
        await global.__redisClient.connect().catch(() => {})
        global.__redlock = new Redlock([global.__redisClient], { retryCount: 10, retryDelay: 80 })
      }
      const resource = `locks:order:${key}`
      const ttl = Number(process.env.REDIS_LOCK_TTL_MS || 5000)
      const lock = await global.__redlock.acquire([resource], ttl).catch(() => null)
      if (lock) {
        try { return await fn() } finally { try { await lock.release().catch(() => {}) } catch (_) {} }
      }
    }
  } catch (_) {}
  // 本機回退鎖
  const prev = EXEC_LOCKS.get(key) || Promise.resolve()
  let resolveNext
  const next = new Promise(res => { resolveNext = res })
  EXEC_LOCKS.set(key, prev.then(() => next))
  try {
    return await fn()
  } finally {
    resolveNext()
    if (EXEC_LOCKS.get(key) === next) EXEC_LOCKS.delete(key)
  }
}

const { getLastAccountMessageByUser } = require('./accountMonitor')

// 針對重播/重複信號的簡易冪等記憶體快取（key -> expiry）
const IDEM = new Map()
const IDEM_TTL_MS = 15 * 1000

function setIdem(key) { IDEM.set(key, Date.now() + IDEM_TTL_MS) }
function isIdem(key) {
  const now = Date.now()
  for (const [k, v] of IDEM.entries()) { if (v <= now) IDEM.delete(k) }
  const exp = IDEM.get(key)
  return !!(exp && exp > now)
}

function deriveIntent(signal) {
  const idRaw = String(signal.id || '')
  const id = idRaw.trim().toLowerCase()
  const action = String(signal.action || '').toLowerCase()
  const mp = String(signal.mp || '').toLowerCase()
  const prev = String(signal.prevMP || '').toLowerCase()

  // 1) 由 id 映射預期意圖（支援中英別名）
  function intentFromId(idStr) {
    const m = new Map([
      ['開多', 'open_long'], ['開空', 'open_short'], ['平多', 'close_long'], ['平空', 'close_short'],
      ['open_long', 'open_long'], ['open short', 'open_short'], ['open_short', 'open_short'],
      ['close_long', 'close_long'], ['close_short', 'close_short'], ['close long', 'close_long'], ['close short', 'close_short']
    ])
    return m.get(idStr) || null
  }

  const idIntent = intentFromId(id)

  // 2) 由 mp/prevMP 推導預期意圖
  let mpIntent = null
  if (mp === 'flat' && prev === 'long') mpIntent = 'close_long'
  else if (mp === 'flat' && prev === 'short') mpIntent = 'close_short'
  else if (mp === 'long' && prev !== 'long') mpIntent = 'open_long'
  else if (mp === 'short' && prev !== 'short') mpIntent = 'open_short'

  // 3) 全量一致性校驗：必須同時滿足「可識別的 idIntent」且與 mpIntent 一致，且 action 相符
  const expected = {
    open_long:  { side: 'buy',  reduceOnly: false },
    open_short: { side: 'sell', reduceOnly: false },
    close_long: { side: 'sell', reduceOnly: true  },
    close_short:{ side: 'buy',  reduceOnly: true  }
  }

  if (!idIntent) {
    try { logger.warn('signal_id_unknown', { id: idRaw, action, mp, prevMP: prev }) } catch (_) {}
    return { intent: 'noop', side: null, reduceOnly: false }
  }

  if (!mpIntent || idIntent !== mpIntent) {
    try { logger.warn('signal_inconsistent_id_vs_mp', { id: idRaw, action, mp, prevMP: prev, idIntent, mpIntent }) } catch (_) {}
    return { intent: 'noop', side: null, reduceOnly: false }
  }

  const exp = expected[idIntent]
  const actionOk = ((action === 'buy' && exp.side === 'buy') || (action === 'sell' && exp.side === 'sell'))
  if (!actionOk) {
    try { logger.warn('signal_inconsistent_action', { id: idRaw, action, mp, prevMP: prev, idIntent }) } catch (_) {}
    return { intent: 'noop', side: null, reduceOnly: false }
  }

  return { intent: idIntent, side: exp.side, reduceOnly: exp.reduceOnly }
}

function buildClient(user) {
  const creds = user.getDecryptedKeys()
  if (user.exchange === 'binance') {
    return new ccxt.binance({ apiKey: creds.apiKey, secret: creds.apiSecret, options: { defaultType: 'future' }, enableRateLimit: true })
  }
  if (user.exchange === 'okx') {
    return new ccxt.okx({ apiKey: creds.apiKey, secret: creds.apiSecret, password: creds.apiPassphrase || undefined, options: { defaultType: 'swap' }, enableRateLimit: true })
  }
  throw new Error('不支援的交易所')
}

async function resolveCcxtSymbol(client, userPair) {
  await client.loadMarkets()
  const base = String(userPair || '').split('/')[0]
  const quote = String(userPair || '').split('/')[1]
  const markets = client.markets || {}

  // Binance：強制優先 USD-M 永續（避免誤命中現貨 'BTC/USDT'）
  if (client.id === 'binance') {
    let exactLinear = null
    let anyLinearSameBaseQuote = null
    let anyLinearSameBase = null
    for (const k of Object.keys(markets)) {
      const m = markets[k]
      if (!m) continue
      // 合約且線性（USDT 結算）優先
      const isLinear = !!m.linear || /:USDT$/.test(k)
      if (!isLinear || !m.contract) continue
      const b = String(m.base)
      const q = String(m.quote)
      if (!exactLinear && b === base && q === quote) { exactLinear = k }
      if (!anyLinearSameBaseQuote && b === base && q === quote) { anyLinearSameBaseQuote = k }
      if (!anyLinearSameBase && b === base) { anyLinearSameBase = k }
    }
    if (exactLinear) return exactLinear
    if (anyLinearSameBaseQuote) return anyLinearSameBaseQuote
    if (anyLinearSameBase) return anyLinearSameBase
    // 嘗試派生 ':USDT' 形式
    const derived = `${base}/${quote}:USDT`
    if (markets[derived]) return derived
    // 嚴格模式：找不到 USD-M 永續即拒單，避免誤用現貨
    throw new Error('binance_futures_symbol_not_found')
  }

  // OKX：強制優先選 SWAP 市場（避免誤命中現貨 'BTC/USDT'）
  if (client.id === 'okx') {
    let exactSwap = null
    let anySwapSameBase = null
    for (const k of Object.keys(markets)) {
      const m = markets[k]
      if (!m || !m.swap) continue
      if (String(m.base) === base && String(m.quote) === quote) {
        exactSwap = k
        break
      }
      if (!anySwapSameBase && String(m.base) === base) anySwapSameBase = k
    }
    if (exactSwap) return exactSwap
    if (anySwapSameBase) return anySwapSameBase
    // 若找不到 swap，再允許精確命中但需為 swap
    const maybe = markets[userPair]
    if (maybe && maybe.swap) return userPair
    return userPair
  }

  // 其他交易所：先用精確命中，否則找 swap 同 base/quote
  if (markets[userPair]) return userPair
  for (const k of Object.keys(markets)) {
    const m = markets[k]
    if (!m) continue
    if (m.swap && String(m.base) === base && String(m.quote) === quote) return k
  }
  for (const k of Object.keys(markets)) {
    const m = markets[k]
    if (!m) continue
    if (m.swap && String(m.base) === base) return k
  }
  return userPair
}

async function fetchBestPrice(user, client, symbol) {
  // 先讀 priceCache，取不到再用 fetchTicker 或公有端點
  try {
    const fromCache = priceCache.get(user.exchange, user.pair, 5000)
    if (Number.isFinite(Number(fromCache)) && Number(fromCache) > 0) return Number(fromCache)
  } catch (_) {}
  try {
    const t = await client.fetchTicker(symbol)
    const p = Number(t.last || t.mark || t.info?.markPrice || 0)
    if (Number.isFinite(p) && p > 0) return p
  } catch (_) {}
  // 最後保守返回 0
  return 0
}

async function ensurePretradeSettings(client, user, symbol) {
  // 檢查為主，校正為輔：若交易所/ccxt 提供統一方法，盡力套用；失敗不影響主流程
  try {
    // 優先嘗試單向淨額模式（net/oneway），避免對翻/平倉歧義
    try {
      if (typeof client.setPositionMode === 'function') {
        // 兼容不同 ccxt 介面：有的用 'net'/'hedged'，有的用布林
        try { await client.setPositionMode('net').catch(() => {}) } catch (_) {}
        try { await client.setPositionMode(false).catch(() => {}) } catch (_) {}
      }
    } catch (_) {}
    if (typeof client.setMarginMode === 'function') {
      const mm = (String(user.marginMode || 'cross').toLowerCase() === 'isolated') ? 'isolated' : 'cross'
      try { await client.setMarginMode(mm, symbol).catch(() => {}) } catch (_) {}
    }
  } catch (_) {}
  try {
    if (typeof client.setLeverage === 'function') {
      const lev = Math.max(1, Math.min(125, Number(user.leverage || 10)))
      try { await client.setLeverage(lev, symbol).catch(() => {}) } catch (_) {}
    }
  } catch (_) {}
}
async function cancelOpenOrdersForSymbol(client, symbol) {
  try {
    // 優先使用 cancelAllOrders；失敗則逐筆取消
    if (typeof client.cancelAllOrders === 'function') {
      try { await client.cancelAllOrders(symbol).catch(() => {}) } catch (_) {}
    }
    const open = await (client.fetchOpenOrders(symbol).catch(() => []))
    if (Array.isArray(open)) {
      for (const o of open) {
        try { await client.cancelOrder(o.id, symbol).catch(() => {}) } catch (_) {}
      }
    }
  } catch (_) {}
}


async function fetchAvailableUSDT(user, client) {
  try {
    const last = getLastAccountMessageByUser(user._id.toString())
    const s = last && last.summary ? last.summary : {}
    const v = Number(s.availableTransfer ?? s.walletBalance ?? 0)
    if (Number.isFinite(v) && v > 0) return v
  } catch (_) {}
  try {
    const bal = await client.fetchBalance()
    const v = Number(bal?.free?.USDT ?? bal?.USDT?.free ?? bal?.total?.USDT ?? bal?.USDT?.total ?? 0)
    if (Number.isFinite(v) && v >= 0) return v
  } catch (_) {}
  return 0
}

function clampToPrecision(client, symbol, amount) {
  try { return Number(client.amountToPrecision(symbol, amount)) } catch (_) { return Number(amount.toFixed(4)) }
}

function floorTo(minStep, value) {
  if (!Number.isFinite(Number(minStep)) || minStep <= 0) return value
  const steps = Math.floor(value / minStep)
  return steps * minStep
}

function ceilTo(step, value) {
  if (!Number.isFinite(Number(step)) || step <= 0) return value
  const steps = Math.ceil(value / step)
  return steps * step
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)) }
// 對翻等待參數（可配置）
const FLIP_WAIT_ITERS = Number(process.env.FLIP_WAIT_ITERS || 20) // 預設 ~5 秒（20*250ms）
const FLIP_WAIT_SLEEP_MS = Number(process.env.FLIP_WAIT_SLEEP_MS || 250)
const BINANCE_CLOSE_TRIGGER_OFFSET_RATIO = Number(process.env.BINANCE_CLOSE_TRIGGER_OFFSET_RATIO || 0.002) // 0.2%

function buildIdemKey(user, signal) {
  const bucket = Math.floor(Date.now() / 3000) // 3 秒窗口
  return `${user._id}:${signal.id || ''}:${signal.action || ''}:${signal.mp || ''}:${signal.prevMP || ''}:${bucket}`
}

function deriveBinanceMarketIdFromSymbol(symbol) {
  try {
    const s = String(symbol || '')
    // e.g. BTC/USDT:USDT -> BTCUSDT
    const m = s.match(/^([A-Z0-9]+)\/([A-Z0-9]+)(?::[A-Z0-9]+)?$/i)
    if (m) return `${m[1].toUpperCase()}${m[2].toUpperCase()}`
    // fallback: remove non-word then if ends with USDTUSDT collapse to USDT
    let cleaned = s.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    cleaned = cleaned.replace(/USDTUSDT$/, 'USDT')
    if (/^[A-Z0-9]+$/.test(cleaned)) return cleaned
    return 'BTCUSDT'
  } catch (_) { return 'BTCUSDT' }
}

async function placeOrderWithExchange(client, user, symbol, side, baseQty, reduceOnly, price, forceClose = false) {
  const m = client.markets?.[symbol] || {}
  const isOkx = client.id === 'okx'
  const isBinance = client.id === 'binance'

  let amountToSend = Number(baseQty)

  // OKX 多為合約（contractSize 常見 0.01），下單需用「張數」
  if (isOkx && m.contract && Number(m.contractSize)) {
    const contracts = baseQty / Number(m.contractSize)
    amountToSend = contracts
  }

  // 精度/步進處理
  try {
    // 優先用 ccxt 的 amountToPrecision；若有最小步進則下切
    amountToSend = clampToPrecision(client, symbol, amountToSend)
    const lot = Number(m.limits?.amount?.min || 0)
    const step = Number(m.info?.lotSize || m.info?.stepSize || 0)
    const minStep = Number.isFinite(step) && step > 0 ? step : lot
    amountToSend = floorTo(minStep, amountToSend)
  } catch (_) {}

  // OKX 專屬：強制符合最小張數與最小名義金額（開倉時可自動抬高；平倉不足則跳過）
  if (isOkx) {
    try {
      const step = Number(m.info?.lotSize || m.info?.stepSize || 0)
      const lotMin = Number(m.limits?.amount?.min || 0)
      const stepOrLot = Number.isFinite(step) && step > 0 ? step : (Number.isFinite(lotMin) && lotMin > 0 ? lotMin : 1)
      const minContracts = Number(m.info?.minSz || m.limits?.amount?.min || stepOrLot || 1)
      const contractSize = Number(m.contractSize || 0)
      const minCost = Number(m.limits?.cost?.min || m.info?.minNotional || 0)

      // 張數下限：
      if (Number.isFinite(minContracts) && minContracts > 0 && amountToSend < minContracts) {
        if (reduceOnly) {
          // 平倉不足最低門檻：跳過，交由上層處理訊息
          throw new Error('okx_below_min_amount_reduce_only')
        }
        logger.info('OKX 調整至最小張數以符合門檻', {
          userId: user._id.toString(), symbol, before: amountToSend, minContracts
        })
        amountToSend = minContracts
      }

      // 名義金額下限：contracts * contractSize * price
      if (Number.isFinite(minCost) && minCost > 0 && Number.isFinite(contractSize) && contractSize > 0 && Number.isFinite(price) && price > 0) {
        const notional = amountToSend * contractSize * price
        if (notional < minCost) {
          if (reduceOnly) {
            throw new Error('okx_below_min_notional_reduce_only')
          }
          // 需要將張數抬高到達到 minCost，並符合步進
          const rawNeeded = minCost / (contractSize * price)
          const stepBase = stepOrLot > 0 ? stepOrLot : 1
          const neededWithStep = ceilTo(stepBase, rawNeeded)
          logger.info('OKX 調整至最小名義金額所需張數', {
            userId: user._id.toString(), symbol, before: amountToSend, after: neededWithStep, minCost
          })
          amountToSend = neededWithStep
        }
      }
    } catch (e) {
      if (String(e.message || '').startsWith('okx_below_min_')) throw e
      // 任何資料缺失時，容錯繼續
    }
  }

  if (!Number.isFinite(amountToSend) || amountToSend <= 0) throw new Error('amount_invalid')

  const params = {}
  if (isBinance) {
    // 一律帶 reduceOnly；positionSide 僅在雙向持倉時需要，這裡先不顯式指定以避免衝突
    if (reduceOnly === true) params.reduceOnly = true
    params.recvWindow = 60000
    // 嘗試自動偵測是否為雙向持倉（hedge 模式）。若是，提供 positionSide 以避免歧義
    try {
      if (typeof client.fapiPrivateGetPositionSideDual === 'function') {
        const dual = await client.fapiPrivateGetPositionSideDual().catch(() => null)
        const flag = String(dual?.dualSidePosition ?? dual?.data?.dualSidePosition ?? '').toLowerCase()
        const isDual = flag === 'true' || flag === '1' || flag === true
        if (isDual) {
          // intent 對應 positionSide：做多/平空 → LONG；做空/平多 → SHORT
          // 以 side 與 reduceOnly 推斷：
          // - buy & !reduceOnly => 開多 → LONG
          // - sell & reduceOnly => 平多 → LONG
          // - sell & !reduceOnly => 開空 → SHORT
          // - buy & reduceOnly => 平空 → SHORT
          if ((side === 'buy' && !reduceOnly) || (side === 'sell' && reduceOnly)) params.positionSide = 'LONG'
          if ((side === 'sell' && !reduceOnly) || (side === 'buy' && reduceOnly)) params.positionSide = 'SHORT'
        }
      }
    } catch (_) {}
    // Binance：補最小數量/名義金額檢查（開倉不足抬量；平倉不足可選擇跳過）
    try {
      const lot = Number(m.limits?.amount?.min || 0)
      const step = Number(m.info?.stepSize || m.info?.lotSize || 0)
      const minStep = Number.isFinite(step) && step > 0 ? step : (Number.isFinite(lot) && lot > 0 ? lot : 0)
      const minNotional = Number(m.limits?.cost?.min || m.info?.minNotional || 0)
      if (Number.isFinite(minStep) && minStep > 0) amountToSend = floorTo(minStep, amountToSend)
      if (reduceOnly !== true) {
        if (Number.isFinite(lot) && lot > 0 && amountToSend < lot) amountToSend = lot
        if (Number.isFinite(minNotional) && minNotional > 0 && Number.isFinite(price) && price > 0) {
          const notional = amountToSend * price
          if (notional < minNotional) {
            const needed = minNotional / price
            const stepBase = (minStep > 0) ? minStep : (lot > 0 ? lot : 0)
            amountToSend = stepBase > 0 ? ceilTo(stepBase, needed) : needed
          }
        }
      } else {
        // 平倉 reduceOnly：若明確低於最小數量且有 lot 定義，跳過以避免拒單
        if ((Number.isFinite(lot) && lot > 0 && amountToSend < lot) || (Number.isFinite(minNotional) && minNotional > 0 && Number.isFinite(price) && price > 0 && (amountToSend * price) < minNotional)) {
          throw new Error('binance_below_min_reduce_only')
        }
      }
    } catch (_) {}
  } else if (isOkx) {
    if (reduceOnly === true) params.reduceOnly = true
    // OKX 需要交易模式 tdMode（cross/isolated）
    try { params.tdMode = (String(user.marginMode || 'cross').toLowerCase() === 'isolated') ? 'isolated' : 'cross' } catch (_) {}
    // 平倉失敗時可改用 closePosition；若上層強制，這裡直接帶上
    if (forceClose === true && reduceOnly === true) {
      params.closePosition = true
    }
  }

  const order = await client.createOrder(symbol, 'market', side, amountToSend, undefined, params)
  return { order, amountSent: amountToSend }
}

// Binance 兜底：以 closePosition=true 建立條件單（STOP_MARKET 與 TAKE_PROFIT_MARKET），使用標記價格觸發
// 目的：處理 reduce-only 市價單受最小名義金額/步進限制導致的微小殘量
async function binanceCloseAllFallback(client, user, symbol, side, markPrice) {
  try {
    // 取得原生 symbol（如 BTCUSDT）
    let marketId = undefined
    try { marketId = client.market(symbol)?.id || undefined } catch (_) {}
    if (!marketId) {
      try { marketId = String(symbol).replace(/\W/g, '') } catch (_) { marketId = 'BTCUSDT' }
    }

    // 檢測是否為雙向持倉以設置 positionSide
    let paramsBase = { reduceOnly: true, closePosition: true, workingType: 'MARK_PRICE' }
    try {
      if (typeof client.fapiPrivateGetPositionSideDual === 'function') {
        const dual = await client.fapiPrivateGetPositionSideDual().catch(() => null)
        const flag = String(dual?.dualSidePosition ?? dual?.data?.dualSidePosition ?? '').toLowerCase()
        const isDual = flag === 'true' || flag === '1' || flag === true
        if (isDual) {
          // 以 side 推斷對應的 positionSide（close_long 用 SELL → LONG；close_short 用 BUY → SHORT）
          if (side === 'sell') paramsBase.positionSide = 'LONG'
          if (side === 'buy') paramsBase.positionSide = 'SHORT'
        }
      }
    } catch (_) {}

    const sideRaw = side.toUpperCase() // 'BUY' | 'SELL'
    const p = Number(markPrice)
    const pValid = Number.isFinite(p) && p > 0
    // 以極小偏移設置兩個觸發價，確保價向任一側微動即可觸發其一
    // 擴大微幅偏移，提高即時觸發機率（約 ±0.2%）
    const off = Number.isFinite(BINANCE_CLOSE_TRIGGER_OFFSET_RATIO) && BINANCE_CLOSE_TRIGGER_OFFSET_RATIO > 0 ? BINANCE_CLOSE_TRIGGER_OFFSET_RATIO : 0.002
    const stop1 = pValid ? (p * (1 - off)) : undefined
    const stop2 = pValid ? (p * (1 + off)) : undefined

    // 優先嘗試原生期貨下單端點（避免 ccxt 對類型/數量的限制）
    const reqs = []
    try {
      if (typeof client.fapiPrivatePostOrder === 'function') {
        if (pValid) {
          reqs.push(client.fapiPrivatePostOrder({
            symbol: marketId,
            side: sideRaw,
            type: 'STOP_MARKET',
            reduceOnly: true,
            closePosition: true,
            workingType: 'MARK_PRICE',
            stopPrice: String(stop1),
            ...(paramsBase.positionSide ? { positionSide: paramsBase.positionSide } : {})
          }).catch(e => { throw e }))
          reqs.push(client.fapiPrivatePostOrder({
            symbol: marketId,
            side: sideRaw,
            type: 'TAKE_PROFIT_MARKET',
            reduceOnly: true,
            closePosition: true,
            workingType: 'MARK_PRICE',
            stopPrice: String(stop2),
            ...(paramsBase.positionSide ? { positionSide: paramsBase.positionSide } : {})
          }).catch(e => { throw e }))
        }
      }
    } catch (e) {
      // 降級：嘗試用 ccxt createOrder（部分環境接受無 amount 的 closePosition）
      try {
        if (pValid) {
          await client.createOrder(symbol, 'STOP_MARKET', side, undefined, undefined, { ...paramsBase, stopPrice: String(stop1) })
          await client.createOrder(symbol, 'TAKE_PROFIT_MARKET', side, undefined, undefined, { ...paramsBase, stopPrice: String(stop2) })
        }
      } catch (ee) {
        logger.warn('Binance closePosition 兜底下單失敗', { userId: user._id.toString(), symbol, message: String(ee?.message || ee) })
        return false
      }
    }

    try { if (reqs.length) await Promise.allSettled(reqs) } catch (_) {}
    logger.info('Binance 已佈署 closePosition 條件單兜底', { userId: user._id.toString(), symbol, side: sideRaw, stop1, stop2 })
    return true
  } catch (e) {
    logger.warn('Binance closePosition 兜底流程異常', { userId: user._id.toString(), symbol, message: String(e?.message || e) })
    return false
  }
}

// 取消幣安尚未觸發的 closePosition 條件單（避免之後誤觸）
async function binanceCancelClosePositionConditionals(client, symbol) {
  try {
    const open = await (client.fetchOpenOrders(symbol).catch(() => []))
    if (!Array.isArray(open) || !open.length) return
    for (const o of open) {
      try {
        const t = String(o.type || o.info?.type || '').toUpperCase()
        const info = o.info || {}
        const isClosePos = (info.closePosition === true) || (String(info.closePosition).toLowerCase() === 'true')
        if (isClosePos && (t === 'STOP_MARKET' || t === 'TAKE_PROFIT_MARKET')) {
          await client.cancelOrder(o.id, symbol).catch(() => {})
        }
      } catch (_) {}
    }
  } catch (_) {}
}

// 取得 Binance 當前 LONG/SHORT 拆分的倉位絕對量（支援 hedge 模式）
async function binanceFetchPositionDetails(client, symbol, user) {
  let marketId = undefined
  try { marketId = client.market(symbol)?.id || undefined } catch (_) {}
  const wantId = deriveBinanceMarketIdFromSymbol(symbol)
  if (!marketId) { marketId = wantId }
  let longAbs = 0
  let shortAbs = 0
  let net = 0
  // 唯一路徑：原生 v2/positionRisk（權威且支援 BOTH）
  try {
    const creds = user && typeof user.getDecryptedKeys === 'function' ? user.getDecryptedKeys() : null
    if (!creds) return { net: 0, longAbs: 0, shortAbs: 0 }
    let raw = await binanceRawPositionRisk(creds, { symbol: wantId })
    // 若單一 symbol 回空，改抓全部再本地過濾
    if (!Array.isArray(raw) || raw.length === 0) {
      raw = await binanceRawPositionRisk(creds, {})
    }
    for (const r of (Array.isArray(raw) ? raw : [])) {
      try {
        if (String(r.symbol || '').toUpperCase() !== String(wantId).toUpperCase()) continue
        const a = Number(r?.positionAmt ?? 0)
        if (!Number.isFinite(a)) continue
        net += a
        const side = String(r?.positionSide || '').toUpperCase()
        if (side === 'LONG') longAbs += Math.abs(a)
        else if (side === 'SHORT') shortAbs += Math.abs(a)
        else if (side === 'BOTH') { if (a > 0) longAbs += Math.abs(a); if (a < 0) shortAbs += Math.abs(a) }
      } catch (_) {}
    }
    return { net, longAbs, shortAbs }
  } catch (_) { return { net: 0, longAbs: 0, shortAbs: 0 } }
}

// 直接以原生 REST 呼叫 fapi/v2/positionRisk（繞過 ccxt），確保與官方一致
async function binanceRawPositionRisk(creds, { symbol } = {}) {
  try {
    const apiKey = creds.apiKey
    const secret = creds.apiSecret
    const base = 'https://fapi.binance.com'
    const qsBase = []
    if (symbol) qsBase.push(`symbol=${encodeURIComponent(String(symbol))}`)
    // 確保時間同步並帶上較大的 recvWindow
    if (!Number.isFinite(BINANCE_TIME_OFFSET_MS) || Math.abs(BINANCE_TIME_OFFSET_MS) > 12 * 60 * 60 * 1000) BINANCE_TIME_OFFSET_MS = 0
    const tsNow = Date.now() + BINANCE_TIME_OFFSET_MS
    qsBase.push(`timestamp=${tsNow}`)
    qsBase.push(`recvWindow=60000`)
    const qs = qsBase.join('&')
    const sig = crypto.createHmac('sha256', String(secret)).update(qs).digest('hex')
    const url = `${base}/fapi/v2/positionRisk?${qs}&signature=${sig}`
    const axios = require('axios')
    let res
    try {
      res = await axios.get(url, { headers: { 'X-MBX-APIKEY': apiKey }, timeout: 10000 })
    } catch (e) {
      // 可能是時間戳問題，嘗試同步時間後重試一次
      await binanceSyncServerTime()
      const tsNow2 = Date.now() + BINANCE_TIME_OFFSET_MS
      const qs2 = qsBase.filter(x => !/^timestamp=/.test(x) && !/^recvWindow=/.test(x))
      qs2.push(`timestamp=${tsNow2}`)
      qs2.push(`recvWindow=60000`)
      const qsRetry = qs2.join('&')
      const sig2 = crypto.createHmac('sha256', String(secret)).update(qsRetry).digest('hex')
      const url2 = `${base}/fapi/v2/positionRisk?${qsRetry}&signature=${sig2}`
      res = await axios.get(url2, { headers: { 'X-MBX-APIKEY': apiKey }, timeout: 10000 })
    }
    let arr = []
    if (Array.isArray(res.data)) arr = res.data
    else if (res && res.data && typeof res.data === 'object') arr = [res.data]
    return arr
  } catch (e) {
    try {
      const status = Number(e?.response?.status || 0)
      const body = e?.response?.data ? String(e.response.data) : ''
      logger.warn('binance_raw_position_risk_failed', { message: String(e?.message||e), status, body })
    } catch (_) {}
    return []
  }
}

// 反覆以 reduceOnly 市價單關閉指定方向（Binance）直到淨倉為 0 或達上限
async function binanceIterativeCloseSide(client, user, symbol, side, maxIters = 6) {
  // side: 'sell' => close_long; 'buy' => close_short
  const intendedClose = (side === 'sell') ? 'close_long' : 'close_short'
  for (let i = 0; i < maxIters; i++) {
    let remaining = 0
    try {
      const details = await binanceFetchPositionDetails(client, symbol, user)
      remaining = intendedClose === 'close_long' ? Number(details.longAbs || 0) : Number(details.shortAbs || 0)
    } catch (_) {}
    if (!remaining || remaining <= 0) {
      return { closed: true }
    }
    try {
      await placeOrderWithExchange(client, user, symbol, side, remaining, true, 0)
    } catch (e) {
      const msg = String(e && e.message || '')
      logger.warn('binance_iterative_close_failed', { userId: user._id.toString(), symbol, intendedClose, iter: i, message: msg })
      // 若遭遇最小門檻導致拒單，直接退出由上層決策
      if (/binance_below_min_reduce_only/i.test(msg)) {
        return { closed: false, remaining }
      }
    }
    await sleep(FLIP_WAIT_SLEEP_MS)
  }
  // 最後一次檢查
  try {
    const details = await binanceFetchPositionDetails(client, symbol, user)
    const remaining = intendedClose === 'close_long' ? Number(details.longAbs || 0) : Number(details.shortAbs || 0)
    if (!remaining || remaining <= 0) {
      return { closed: true, remaining: 0 }
    }
    // 仍有殘量：佈署 closePosition 條件單兜底（MARK_PRICE ±偏移）
    logger.warn('binance_iterative_close_remaining', { userId: user._id.toString(), symbol, intendedClose, remaining })
    try {
      const mark = await fetchBestPrice(user, client, symbol)
      await binanceCloseAllFallback(client, user, symbol, side, mark)
      for (let i = 0; i < FLIP_WAIT_ITERS; i++) {
        const left = await binanceFetchNetPositionAbs(client, symbol)
        if (!left || left <= 0) break
        await sleep(FLIP_WAIT_SLEEP_MS)
      }
      // 撤除兜底條件單
      try { await binanceCancelClosePositionConditionals(client, symbol) } catch (_) {}
      // 最終確認
      const left2 = await binanceFetchNetPositionAbs(client, symbol)
      const done = !left2 || left2 <= 0
      return { closed: done, remaining: Number(left2||0) }
    } catch (_) {
      return { closed: false, remaining }
    }
  } catch (_) { return { closed: false } }
}

// 直接查 Binance 期貨持倉淨額（雙向持倉則彙總 LONG/SHORT 絕對值）
async function binanceFetchNetPositionAbs(client, symbol) {
  try {
    // 嘗試取市場 ID（如 BTCUSDT）
    let marketId = undefined
    try { marketId = client.market(symbol)?.id || undefined } catch (_) {}
    if (!marketId) {
      try { marketId = String(symbol).replace(/\W/g, '') } catch (_) { marketId = 'BTCUSDT' }
    }

    // 優先使用 position 信息端點
    let list = []
    try {
      if (typeof client.fapiPrivateGetPositionInformation === 'function') {
        const res = await client.fapiPrivateGetPositionInformation({ symbol: marketId }).catch(() => null)
        if (Array.isArray(res)) list = res
      }
    } catch (_) {}
    // 回退 position risk
    if (!list.length && typeof client.fapiPrivateGetPositionRisk === 'function') {
      try {
        const res2 = await client.fapiPrivateGetPositionRisk({ symbol: marketId }).catch(() => null)
        if (Array.isArray(res2)) list = res2
      } catch (_) {}
    }
    if (!list.length) return 0
    // 匹配該 symbol，將 LONG/SHORT 兩筆的絕對值相加
    let totalAbs = 0
    for (const r of list) {
      try {
        if (String(r.symbol || r.instId || '').toUpperCase() !== String(marketId).toUpperCase()) continue
        const amt = Number(r.positionAmt ?? r.positionAmount ?? r.posAmt ?? 0)
        if (Number.isFinite(amt)) totalAbs += Math.abs(amt)
      } catch (_) {}
    }
    return totalAbs
  } catch (_) { return 0 }
}

async function processSignalForUser(user, signal) {
  const userId = user._id.toString()
  const { intent, side, reduceOnly } = deriveIntent(signal)

  if (!side || intent === 'noop') {
    return { placed: false, reason: 'no_position_change', retryable: false }
  }

  const idemKey = buildIdemKey(user, signal)
  if (isIdem(idemKey)) {
    return { placed: false, reason: 'duplicate_signal', retryable: false }
  }

  const client = buildClient(user)
  let symbol
  try { symbol = await resolveCcxtSymbol(client, user.pair) } catch (e) { symbol = user.pair }

  // 交易前置校正（可用則設定，失敗忽略）
  try { await ensurePretradeSettings(client, user, symbol) } catch (_) {}

  // 偵錯：記錄市場資訊（有助於排查 51020 門檻）
  try {
    const mDbg = client.markets?.[symbol] || {}
    logger.info('將下單市場資訊', {
      userId,
      exchange: client.id,
      symbol,
      contract: !!mDbg.contract,
      contractSize: Number(mDbg.contractSize || 0),
      minSz: mDbg?.info?.minSz,
      amountMin: mDbg?.limits?.amount?.min,
      costMin: mDbg?.limits?.cost?.min,
      stepSize: mDbg?.info?.lotSize || mDbg?.info?.stepSize
    })
  } catch (_) {}

  // 注意：對翻需先處理全平，再去取價與資金計算新倉
  let price = 0
  let available = 0
  let baseQty = 0

  // 若為開倉訊號，檢查是否與當前持倉「相反」→ 先全平再開倉（簡化：直查交易所，單次全平，無備援）
  try {
    if (!reduceOnly) {
      const intended = (side === 'buy') ? 'long' : 'short'
      let currentSide = 'flat'
      let absQty = 0
      if (String(user.exchange||'').toLowerCase() === 'binance') {
        const details = await binanceFetchPositionDetails(client, symbol, user)
        absQty = Math.abs(Number(details.net || 0))
        currentSide = (Number(details.net) > 0) ? 'long' : (Number(details.net) < 0 ? 'short' : 'flat')
      } else {
        // OKX
        try {
          const possLive = await (typeof client.fetchPositions === 'function' ? client.fetchPositions([symbol]).catch(() => []) : [])
          const one = Array.isArray(possLive) && possLive.length ? possLive[0] : null
          const sideRaw = String(one?.side || one?.info?.posSide || '').toLowerCase()
          if (sideRaw === 'long' || sideRaw === 'short') {
            currentSide = sideRaw
          } else {
            const signed = Number(one?.contracts || one?.contractsSize || one?.info?.pos || 0)
            currentSide = (signed > 0) ? 'long' : ((signed < 0) ? 'short' : 'flat')
          }
          const qty = Math.abs(Number(one?.contracts || one?.contractsSize || one?.info?.pos || 0))
          absQty = Number(qty || 0)
        } catch (_) {}
      }
      const isOpposite = (currentSide === 'long' && intended === 'short') || (currentSide === 'short' && intended === 'long')
      if (isOpposite && absQty > 0) {
        const toCloseSide = (currentSide === 'long') ? 'sell' : 'buy'
        const lockKeyFlip = `${user._id.toString()}:${symbol}`
        await withExecLock(lockKeyFlip, async () => {
          await cancelOpenOrdersForSymbol(client, symbol)
          if (String(user.exchange||'').toLowerCase() === 'okx') {
            // OKX: 發送市價平倉單後，輪詢確認持倉已歸零
            await placeOrderWithExchange(client, user, symbol, toCloseSide, absQty, true, price, true)
            for (let i = 0; i < FLIP_WAIT_ITERS; i++) {
              await sleep(FLIP_WAIT_SLEEP_MS)
              try {
                const possLive = await (typeof client.fetchPositions === 'function' ? client.fetchPositions([symbol]).catch(() => []) : [])
                const one = Array.isArray(possLive) && possLive.length ? possLive[0] : null
                if (!one) break
                // 優先使用 side/posSide 欄位判斷倉位方向
                const sideRaw = String(one?.side || one?.posSide || one?.info?.side || one?.info?.posSide || '').toLowerCase()
                let remainingSide = 'flat'
                if (sideRaw === 'long' || sideRaw === 'short') {
                  remainingSide = sideRaw
                } else {
                  const signed = Number(one?.contracts || one?.contractsSize || one?.info?.pos || 0)
                  remainingSide = (signed > 0) ? 'long' : ((signed < 0) ? 'short' : 'flat')
                }
                if (remainingSide === 'flat') break
                const qty = Math.abs(Number(one?.contracts || one?.contractsSize || one?.info?.pos || 0))
                if (!qty || qty <= 0) break
              } catch (_) { break }
            }
          } else {
            // Binance：使用迭代市價平倉（binanceIterativeCloseSide）直接平掉當前持倉方向
            const result = await binanceIterativeCloseSide(client, user, symbol, toCloseSide)
            if (!result.closed) {
              logger.warn('flip_binance_close_incomplete', { userId: user._id.toString(), symbol, toCloseSide, remaining: result.remaining })
            }
          }
        })
      }
      // 全平後直接進入後續的取價與下單計算（不等待迴圈）
      try {
        price = await fetchBestPrice(user, client, symbol)
        available = await fetchAvailableUSDT(user, client)
        if (!Number.isFinite(price) || price <= 0) return { placed: false, reason: 'price_unavailable', retryable: true }
        const riskPct = Math.max(1, Math.min(100, Number(user.riskPercent || 10))) / 100
        const lev = Math.max(1, Math.min(100, Number(user.leverage || 1)))
        const reserved = Math.max(0, Number(user.reservedFunds || 0))
        const fixed = Math.max(0, Number(user.fixedFunds || 0))
        let effectiveAvailable = Number(available || 0)
        if (reserved > 0) effectiveAvailable = Math.max(0, Number(available || 0) - reserved)
        if (fixed > 0 && reserved > 0) {
          if (effectiveAvailable < fixed) {
            logger.info('gate_block: effectiveAvailable < fixed', { userId, available, reserved, effectiveAvailable, fixed })
            return { placed: false, reason: 'reserve_gate_fixed_exceeds_effective', retryable: false }
          }
          baseQty = (fixed * riskPct * lev) / price
        } else if (fixed > 0 && reserved === 0) {
          if (fixed > Number(available || 0)) {
            logger.info('gate_block: fixed > available', { userId, available, fixed })
            return { placed: false, reason: 'fixed_exceeds_available', retryable: false }
          }
          baseQty = (fixed * riskPct * lev) / price
        } else if (reserved > 0 && fixed === 0) {
          if (effectiveAvailable <= 0) {
            logger.info('gate_block: effectiveAvailable <= 0', { userId, available, reserved, effectiveAvailable })
            return { placed: false, reason: 'effective_available_zero_or_negative', retryable: false }
          }
          baseQty = (effectiveAvailable * riskPct * lev) / price
        } else {
          baseQty = ((available || 0) * riskPct * lev) / price
        }
      } catch (_) {}
    }
  } catch (e) {
    logger.warn('flip_simple_close_failed', { userId, symbol, message: String(e?.message||e) })
    return { placed: false, reason: 'flip_close_failed', retryable: /timeout|temporarily|network/i.test(String(e?.message||e)) }
  }

  // 同向加倉縮放：若目前持倉方向與信號方向相同，將基礎數量乘以 0.25（加倉）
  try {
    if (!reduceOnly) {
      const intended = (side === 'buy') ? 'long' : 'short'
      let currentSide = 'flat'
      let hasPosition = false
      
      if (String(user.exchange||'').toLowerCase() === 'binance') {
        const details = await binanceFetchPositionDetails(client, symbol, user)
        const net = Number(details.net || 0)
        if (net > 0) currentSide = 'long'
        else if (net < 0) currentSide = 'short'
        hasPosition = (currentSide === 'long' || currentSide === 'short')
      } else {
        // OKX
        try {
          const possLive = await (typeof client.fetchPositions === 'function' ? client.fetchPositions([symbol]).catch(() => []) : [])
          const one = Array.isArray(possLive) && possLive.length ? possLive[0] : null
          const sideRaw = String(one?.side || one?.info?.posSide || '').toLowerCase()
          if (sideRaw === 'long' || sideRaw === 'short') {
            currentSide = sideRaw
          } else {
            const signed = Number(one?.contracts || one?.contractsSize || one?.info?.pos || 0)
            currentSide = (signed > 0) ? 'long' : ((signed < 0) ? 'short' : 'flat')
          }
          const qty = Math.abs(Number(one?.contracts || one?.contractsSize || one?.info?.pos || 0))
          hasPosition = qty > 0
        } catch (_) {}
      }
      
      if (hasPosition && currentSide === intended) {
        const before = baseQty
        baseQty = Number(before) * 0.25
        logger.info('同向加倉縮放 0.25 已套用', { userId, pair: user.pair, before, after: baseQty, intended, currentSide })
      }
    }
  } catch (_) {}

  // 平倉：直查交易所 → 方向正確才全平（無備援/無迭代）
  if (reduceOnly) {
    try {
      const intendedClose = (intent === 'close_long' || intent === 'close_short') ? intent : ((side === 'sell') ? 'close_long' : 'close_short')
      let currentSide = 'flat'
      let contracts = 0
      if (String(user.exchange||'').toLowerCase() === 'binance') {
        // 以 intendedClose 決定要關哪一側（hedge 模式下取對側絕對量）
        const details = await binanceFetchPositionDetails(client, symbol, user)
        currentSide = (Number(details.net) > 0) ? 'long' : (Number(details.net) < 0 ? 'short' : 'flat')
        if (intendedClose === 'close_long') contracts = Number(details.longAbs || 0)
        if (intendedClose === 'close_short') contracts = Number(details.shortAbs || 0)
      } else {
        try {
          const possLive = await (typeof client.fetchPositions === 'function' ? client.fetchPositions([symbol]).catch(() => []) : [])
          const one = Array.isArray(possLive) && possLive.length ? possLive[0] : null
          // OKX：方向以 side/posSide 判斷，contracts 常為絕對值
          const sideRaw = String(one?.side || one?.info?.posSide || '').toLowerCase() // 'long' | 'short'
          if (sideRaw === 'long' || sideRaw === 'short') {
            currentSide = sideRaw
          } else {
            // 後備：若 side 缺失，才用 contracts 正負
            const signed = Number(one?.contracts || one?.contractsSize || one?.info?.pos || 0)
            currentSide = (signed > 0) ? 'long' : ((signed < 0) ? 'short' : 'flat')
          }
          const qty = Math.abs(Number(one?.contracts || one?.contractsSize || one?.info?.pos || 0))
          contracts = Number(qty || 0)
        } catch (_) {}
      }
      if (!contracts || contracts <= 0) {
        return { placed: false, reason: 'no_position_to_close', retryable: false }
      }
      if ((currentSide === 'long' && intendedClose !== 'close_long') || (currentSide === 'short' && intendedClose !== 'close_short')) {
        return { placed: false, reason: 'direction_mismatch_skip', retryable: false }
      }
      const lockKey = `${user._id.toString()}:${symbol}`
      await withExecLock(lockKey, async () => {
        await cancelOpenOrdersForSymbol(client, symbol)
        if (String(user.exchange||'').toLowerCase() === 'okx') {
          await placeOrderWithExchange(client, user, symbol, side, contracts, true, price, true)
        } else {
          // Binance：改為迭代式市價 reduceOnly 至 0（不再使用 closePosition 兜底）
          await binanceIterativeCloseSide(client, user, symbol, side)
        }
      })
      setIdem(idemKey)
      return { placed: true, exchange: client.id, symbol, side, amount: Number(contracts), reduceOnly: true, orderId: '' }
    } catch (e) {
      const msg = String(e && e.message || '')
      logger.warn('direct_close_failed', { userId, symbol, message: msg })
      return { placed: false, reason: msg || 'order_failed', retryable: /timeout|temporarily|network/i.test(msg) }
    }
  }

  // 若未經對翻路徑（或無需對翻），補取價/資金以便後續開倉
  if (!reduceOnly && (!Number.isFinite(price) || price <= 0)) {
    price = await fetchBestPrice(user, client, symbol)
    if (!Number.isFinite(price) || price <= 0) return { placed: false, reason: 'price_unavailable', retryable: true }
    available = await fetchAvailableUSDT(user, client)
    const riskPct = Math.max(1, Math.min(100, Number(user.riskPercent || 10))) / 100
    const lev = Math.max(1, Math.min(100, Number(user.leverage || 1)))
    const reserved = Math.max(0, Number(user.reservedFunds || 0))
    const fixed = Math.max(0, Number(user.fixedFunds || 0))
    let effectiveAvailable = Number(available || 0)
    if (reserved > 0) effectiveAvailable = Math.max(0, Number(available || 0) - reserved)

    if (fixed > 0 && reserved > 0) {
      if (effectiveAvailable < fixed) {
        logger.info('gate_block: effectiveAvailable < fixed', { userId, available, reserved, effectiveAvailable, fixed })
        return { placed: false, reason: 'reserve_gate_fixed_exceeds_effective', retryable: false }
      }
      baseQty = (fixed * riskPct * lev) / price
    } else if (fixed > 0 && reserved === 0) {
      if (fixed > Number(available || 0)) {
        logger.info('gate_block: fixed > available', { userId, available, fixed })
        return { placed: false, reason: 'fixed_exceeds_available', retryable: false }
      }
      baseQty = (fixed * riskPct * lev) / price
    } else if (reserved > 0 && fixed === 0) {
      if (effectiveAvailable <= 0) {
        logger.info('gate_block: effectiveAvailable <= 0', { userId, available, reserved, effectiveAvailable })
        return { placed: false, reason: 'effective_available_zero_or_negative', retryable: false }
      }
      baseQty = (effectiveAvailable * riskPct * lev) / price
    } else {
      baseQty = ((available || 0) * riskPct * lev) / price
    }
  }

  // 安全下限
  if (!Number.isFinite(baseQty) || baseQty <= 0) baseQty = 0.001

  const lockKey = `${user._id.toString()}:${symbol}`
  try {
    const { order, amountSent } = await withExecLock(lockKey, async () => {
      return await placeOrderWithExchange(client, user, symbol, side, baseQty, reduceOnly, price)
    })
    setIdem(idemKey)
    return {
      placed: true,
      exchange: client.id,
      symbol,
      side,
      amount: Number(amountSent),
      reduceOnly: !!reduceOnly,
      orderId: String(order?.id || order?.clientOrderId || order?.info?.ordId || order?.info?.orderId || ''),
    }
  } catch (e) {
    const msg = String(e && e.message || '')
    if (/^okx_below_min_/.test(msg)) {
      logger.info('OKX 平倉訂單低於最小門檻，已跳過', { userId, symbol, reason: msg })
      return { placed: false, reason: 'below_minimum_reduce_only', retryable: false }
    }
    // OKX 51020：名義金額/張數不足，針對開倉自動抬量重試（最多 2 次）
    const isOkx = String(user.exchange||'').toLowerCase() === 'okx'
    if (isOkx && reduceOnly !== true && /51020/.test(msg)) {
      for (const factor of [2, 3]) {
        try {
          logger.info('OKX 51020 檢測，執行抬量重試', { userId, symbol, factor })
          const { order, amountSent } = await placeOrderWithExchange(client, user, symbol, side, Number(baseQty) * factor, reduceOnly, price)
          setIdem(idemKey)
          return {
            placed: true,
            exchange: client.id,
            symbol,
            side,
            amount: Number(amountSent),
            reduceOnly: !!reduceOnly,
            orderId: String(order?.id || order?.clientOrderId || order?.info?.ordId || order?.info?.orderId || ''),
          }
        } catch (ee) {
          const m2 = String(ee && ee.message || '')
          logger.warn('OKX 51020 重試仍失敗', { userId, symbol, factor, message: m2 })
          if (!/51020/.test(m2)) break
        }
      }
    }
    // OKX reduce-only 平倉衝突（51134/Closing failed）：嘗試取消掛單後重試，必要時強制 closePosition
    if (isOkx && reduceOnly === true && /51134|Closing failed/i.test(msg)) {
      try {
        logger.info('OKX 平倉衝突，先取消掛單後重試', { userId, symbol, message: msg })
        await cancelOpenOrdersForSymbol(client, symbol)
        // 重試一次（帶 closePosition）
        const { order, amountSent } = await placeOrderWithExchange(client, user, symbol, side, baseQty, reduceOnly, price, true)
        setIdem(idemKey)
        return {
          placed: true,
          exchange: client.id,
          symbol,
          side,
          amount: Number(amountSent),
          reduceOnly: !!reduceOnly,
          orderId: String(order?.id || order?.clientOrderId || order?.info?.ordId || order?.info?.orderId || ''),
        }
      } catch (e2) {
        const msg2 = String(e2 && e2.message || '')
        logger.warn('OKX 平倉二次嘗試仍失敗', { userId, symbol, message: msg2 })
      }
    }
    const status = Number(e?.response?.status || 0)
    const retryable = status === 429 || status === 418 || /timeout|temporarily|network|ECONNRESET|ETIMEDOUT/i.test(msg)
    logger.warn('下單失敗', { userId, exchange: user.exchange, message: msg })
    return { placed: false, reason: msg || 'order_failed', retryable }
  }
}

module.exports = { processSignalForUser }


