// 繁體中文註釋
// 簡易價格快取：marketWs 寫入，tradeExecutor 優先讀取

const cache = new Map(); // key: `${exchange}:${pair}` -> { price, ts }

function key(exchange, pair) { return `${exchange}:${pair}`; }

function set(exchange, pair, price) {
  cache.set(key(exchange, pair), { price: Number(price), ts: Date.now() });
}

function get(exchange, pair, maxAgeMs = 3000) {
  const k = key(exchange, pair);
  const v = cache.get(k);
  if (!v) return null;
  if ((Date.now() - v.ts) > maxAgeMs) return null;
  return v.price;
}

module.exports = { set, get };





















