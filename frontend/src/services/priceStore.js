// 繁體中文註釋
// 共享 Ticker Store（單例）：
// - 單一 WS 連線到內部 Hub
// - 150ms 去抖聚合，統一格式化/標準化
// - 對外提供 subscribe(fn) / unsubscribe 與 getPrice(ex, pair)

import { wsConnect } from './ws'

const listeners = new Set()
// key: `${ex}|${pairNorm}` -> { price, ts }
const latest = new Map()
let started = false
let ws
let debounceTimer = null

function normExchange(ex) {
  return String(ex || '').toLowerCase()
}
function normPair(pair) {
  return String(pair || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}
function round2(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.round(v * 100) / 100
}

function publish() {
  const payloads = []
  for (const [key, { price, ts }] of latest.entries()) {
    const [ex, pair] = key.split('|')
    payloads.push({ exchange: ex, pair, price, ts })
  }
  if (payloads.length === 0) return
  for (const fn of listeners) {
    try { fn(payloads) } catch (_) {}
  }
}

function ensureStarted() {
  if (started) return
  started = true
  ws = wsConnect((ev) => {
    try {
      const msg = JSON.parse(ev.data)
      if (!msg || msg.type !== 'ticker') return
      const ex = normExchange(msg.exchange)
      const pair = normPair(msg.pair)
      const price = round2(msg.price)
      if (!Number.isFinite(price) || price === 0) return
      const key = `${ex}|${pair}`
      latest.set(key, { price, ts: Date.now() })
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => { debounceTimer = null; publish() }, 150)
    } catch (_) {}
  })
}

export function subscribePrices(handler) {
  ensureStarted()
  listeners.add(handler)
  return () => { try { listeners.delete(handler) } catch (_) {} }
}

export function getPrice(exchange, pair) {
  const key = `${normExchange(exchange)}|${normPair(pair)}`
  const v = latest.get(key)
  return v ? v.price : undefined
}









