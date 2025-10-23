// 簡易訊號壓測腳本：以固定併發對 /api/signal 發 POST

const axios = require('axios');

const TARGET = process.env.TARGET || 'http://localhost:5001/api/signal/test';
const API_KEY = process.env.API_KEY || '';
const CONC = Number(process.env.CONC || 10);
const COUNT = Number(process.env.COUNT || 100);

async function one(i) {
  const body = { id: `load-${Date.now()}-${i}`, action: 'buy', mp: 'long', prevMP: 'flat' };
  const headers = { 'Content-Type': 'application/json' };
  const url = API_KEY ? `${TARGET}${TARGET.includes('?') ? '&' : '?'}apiKey=${encodeURIComponent(API_KEY)}` : TARGET;
  try { await axios.post(url, body, { headers }); return true; } catch { return false; }
}

async function main() {
  let ok = 0;
  let fail = 0;
  let i = 0;
  const workers = Array.from({ length: CONC }, async () => {
    while (i < COUNT) {
      const n = i++;
      const r = await one(n);
      if (r) ok++; else fail++;
    }
  });
  await Promise.all(workers);
  console.log({ ok, fail });
}

main();





















