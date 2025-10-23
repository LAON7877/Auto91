// 繁體中文註釋
// 簡易維護任務：定期清理交易歷史與精簡本地 Mongo 輸出檔

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const Bottleneck = require('bottleneck');
const Trade = require('../models/Trade');
const User = require('../models/User');
const { getLastAccountMessageByUser, coldStartSnapshotForUser } = require('./accountMonitor');
const { enqueueDaily } = require('./telegram');
const { enqueueHourly } = require('./telegram');
const DailyStats = require('../models/DailyStats');
const { aggregateForUser } = require('./pnlAggregator');
const { getSummary: getOkxSummary, cleanupOld: cleanupOkxPnlCache, getWeeklySummary: getOkxWeekly } = require('./okxPnlService');
const { cleanupOld: cleanupBinancePnlCache, getWeeklySummary: getBinanceWeekly } = require('./binancePnlService');
const ccxt = require('ccxt');

function getEnvInt(name, def) {
  const v = Number(process.env[name] || def);
  return Number.isFinite(v) ? v : def;
}

async function cleanupTrades() {
  try {
    const days = getEnvInt('TRADE_TTL_DAYS', 0);
    if (!days || days <= 0) return;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const res = await Trade.deleteMany({ createdAt: { $lt: cutoff } });
    if (res?.deletedCount) logger.info(`維護：已刪除過期交易 ${res.deletedCount} 筆（>${days} 天）`);
  } catch (e) {
    logger.warn('維護：刪除過期交易失敗', { message: e.message });
  }
}

async function cleanupDailyStats() {
  try {
    const days = 90;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const res = await DailyStats.deleteMany({ createdAt: { $lt: cutoff } });
    if (res?.deletedCount) logger.info(`維護：已刪除過期日統計 ${res.deletedCount} 筆（>${days} 天）`);
  } catch (e) {
    logger.warn('維護：刪除過期日統計失敗', { message: e.message });
  }
}

function trimFileIfLarge(filePath) {
  try {
    const maxMb = getEnvInt('LOG_TRIM_MB', 0);
    const keepMb = getEnvInt('LOG_TRIM_KEEP_MB', 5);
    if (!maxMb || maxMb <= 0) return;
    if (!fs.existsSync(filePath)) return;
    const st = fs.statSync(filePath);
    const maxBytes = maxMb * 1024 * 1024;
    if (st.size <= maxBytes) return;
    const keepBytes = keepMb * 1024 * 1024;
    const fd = fs.openSync(filePath, 'r');
    const start = Math.max(0, st.size - keepBytes);
    const buf = Buffer.alloc(Math.min(keepBytes, st.size));
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    fs.writeFileSync(filePath, buf);
    logger.info('維護：已精簡日誌', { filePath, fromBytes: st.size, toBytes: buf.length });
  } catch (e) {
    logger.warn('維護：精簡日誌失敗', { filePath, message: e.message });
  }
}

function trimMongoLogs() {
  const root = process.cwd();
  trimFileIfLarge(path.join(root, 'mongo.out.log'));
  trimFileIfLarge(path.join(root, 'mongo.err.log'));
}

function scheduleDaily(hour = 3) {
  function msUntil(targetHour) {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }
  setTimeout(() => {
    (async () => { await cleanupTrades(); await cleanupDailyStats(); try { await cleanupOkxPnlCache(40) } catch (_) {}; try { await cleanupBinancePnlCache(40) } catch (_) {}; trimMongoLogs(); })();
    setInterval(() => { (async () => { await cleanupTrades(); await cleanupDailyStats(); try { await cleanupOkxPnlCache(40) } catch (_) {}; try { await cleanupBinancePnlCache(40) } catch (_) {}; trimMongoLogs(); })(); }, 24 * 60 * 60 * 1000);
  }, msUntil(hour));
}

async function initMaintenance() {
  // 啟動 5 分鐘後先跑一次，之後固定每日 03:00 執行
  setTimeout(() => { (async () => { await cleanupTrades(); await cleanupDailyStats(); try { await cleanupOkxPnlCache(40) } catch (_) {}; try { await cleanupBinancePnlCache(40) } catch (_) {}; trimMongoLogs(); })(); }, 5 * 60 * 1000);
  scheduleDaily(3);
}

// 23:54–23:59 巡檢發送日結摘要（若無 BOT TOKEN，telegram.js 會自動跳過）
;(function scheduleDailySummaryWindow(){
  const TZ = process.env.TZ || 'Asia/Taipei'
  function nowInTz(){
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date())
    const o = {}; for (const p of parts) o[p.type] = p.value
    return { y:o.year, m:o.month, d:o.day, hh:Number(o.hour), mm:Number(o.minute), dateKey: `${o.year}-${o.month}-${o.day}` }
  }
  async function tick(){
    try {
      const t = nowInTz()
      // 僅在 23:54–23:59 視窗內執行；其餘時間直接返回
      if (!(t.hh === 23 && t.mm >= 54 && t.mm <= 59)) return
      const users = await User.find({ enabled: true });

      // 準備每交易所節流器（避免 REST 補位觸發限流）；全域再做一層微節流
      const exLimiters = new Map();
      function getExLimiter(ex){
        const key = String(ex || 'default').toLowerCase();
        if (!exLimiters.has(key)) exLimiters.set(key, new Bottleneck({ minTime: 300, maxConcurrent: 1 }));
        return exLimiters.get(key);
      }
      const globalLimiter = new Bottleneck({ minTime: 150, maxConcurrent: 1 });
      async function handleUser(u) {
        // 訂閱到期：過期則不發送日結
        try {
          if (u.subscriptionEnd && new Date(u.subscriptionEnd).getTime() < Date.now()) return
        } catch (_) {}
        const ids = String(u.telegramIds || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!ids.length) return;
        let last = getLastAccountMessageByUser(u._id.toString()) || {};
        let s = last.summary || {};
        // 新鮮度門檻：若快取過舊（>60s），執行輕量 REST 補位（balance+positions）後再檢查
        let delayed = false
        try {
          const staleMs = Math.max(0, Date.now() - Number(last.ts || 0))
          if (!last || !last.ts || staleMs > 60000) {
            const exLimiter = getExLimiter(u.exchange)
            await globalLimiter.schedule(() => exLimiter.schedule(() => coldStartSnapshotForUser(u)))
            // 補位後重新讀取快取
            last = getLastAccountMessageByUser(u._id.toString()) || {}
            s = last.summary || {}
            const staleMs2 = Math.max(0, Date.now() - Number(last.ts || 0))
            const hasCore = Number.isFinite(Number(s.walletBalance)) || (Array.isArray(last.positions) && last.positions.length > 0)
            if (!last || !last.ts || staleMs2 > 60000 || !hasCore) delayed = true
          }
        } catch (_) { delayed = true }

        // 進一步防呆：若目前快取的持倉為空（或全為 0），在日結前強制補抓一次（即使資料不舊）
        try {
          const hasNonZeroPos = (() => {
            try {
              const arr = Array.isArray(last.positions) ? last.positions : []
              return arr.some(p => Math.abs(Number(p?.contracts ?? p?.contractsSize ?? 0)) > 0)
            } catch (_) { return false }
          })()
          if (!hasNonZeroPos) {
            const exLimiter = getExLimiter(u.exchange)
            await globalLimiter.schedule(() => exLimiter.schedule(() => coldStartSnapshotForUser(u)))
            last = getLastAccountMessageByUser(u._id.toString()) || {}
            s = last.summary || {}
          }
        } catch (_) {}
        // 按需求：日結數據來源改為當下 REST 快照（不做歷史聚合校準）

        // 依需求：不再做日結前的歷史對帳差異比對（僅以當下 REST 快照為準）

        // 合併每日統計（持久化/記憶體）
        let daily = { tradeCount: 0, feeSum: 0, pnlSum: 0, closedTrades: [] };
        try {
          const rec = await DailyStats.findOne({ user: u._id, date: t.dateKey });
          if (rec) daily = { tradeCount: rec.tradeCount, feeSum: rec.feeSum, pnlSum: rec.pnlSum, closedTrades: rec.closedTrades || [] };
        } catch (_) {}
        const dateText = String(t.dateKey||'').replace(/-/g,'/')
        // 交易所專屬覆蓋：OKX/BN 均用服務重算（refresh=true），不做回退
        try {
          const ex = String(u.exchange||'').toLowerCase()
          if (ex === 'okx') {
            const s2 = await getOkxSummary(u._id, { refresh: true })
            s = { ...(s || {}), feePaid: Number(s2.feePaid||0), pnl1d: Number(s2.pnl1d||0), pnl7d: Number(s2.pnl7d||0), pnl30d: Number(s2.pnl30d||0) }
          } else if (ex === 'binance') {
            try {
              const { getSummary: getBinanceSummary } = require('./binancePnlService')
              const s2 = await getBinanceSummary(u._id, { refresh: true })
              s = { ...(s || {}), feePaid: Number(s2.feePaid||0), pnl1d: Number(s2.pnl1d||0), pnl7d: Number(s2.pnl7d||0), pnl30d: Number(s2.pnl30d||0) }
            } catch (_) {}
          }
        } catch (_) {}

        const lines = [
          `📊 交易結算（${dateText}）`,
          `═════帳戶狀態═════`,
          ...(delayed ? ['⚠ 資料延遲（使用上次更新），請稍後留意最新彙整'] : []),
          `成交次數：${daily.tradeCount || 0} 次`,
          `錢包餘額：${Number(s.walletBalance||0).toFixed(2)} USDT`,
          `可供轉帳：${Number(s.availableTransfer||0).toFixed(2)} USDT`,
          `保證金餘額：${Number(s.marginBalance||0).toFixed(2)} USDT`,
          `交易手續費：${Number(s.feePaid||0).toFixed(2)} USDT`,
          `本日盈虧：${Number(s.pnl1d||0).toFixed(2)} USDT`,
          `7日盈虧：${Number(s.pnl7d||0).toFixed(2)} USDT`,
          `30日盈虧：${Number(s.pnl30d||0).toFixed(2)} USDT`,
          `═════持倉狀態═════`,
          (() => {
            const arr = Array.isArray(last.positions) ? last.positions : []
            const nz = arr.find(x => Math.abs(Number(x?.contracts || 0)) > 0)
            const p = nz || null
            if (!p) return '❌ 無持倉部位';
            const sideText = (String(p.side||'').toLowerCase()==='long')?'多單':(String(p.side||'').toLowerCase()==='short'?'空單':'—');
            const base = String(p.symbol||'').split('/')[0] || '';
            function fmtQtyDyn2(q){
              const n = Number(q||0)
              const s = n.toFixed(4)
              const parts = s.split('.')
              if (parts.length < 2) return n.toFixed(2)
              const f = parts[1]
              if (f[3] !== '0') return n.toFixed(4)
              if (f[2] !== '0') return n.toFixed(3)
              return n.toFixed(2)
            }
            const qty = fmtQtyDyn2(p.contracts||0);
            const entry = Number(p.entryPrice||0).toLocaleString(undefined,{maximumFractionDigits:0});
            const liq = Number(p.liquidationPrice||0).toLocaleString(undefined,{maximumFractionDigits:0});
            const unp = Number(p.unrealizedPnl||0).toFixed(2);
            const prefix = (Number(p.unrealizedPnl||0)>0)?'+':(Number(p.unrealizedPnl||0)<0?'-':'');
            return `${sideText}｜${qty} ${base}｜${entry} USDT｜${liq} USDT\n未實現盈虧 ${prefix}${Math.abs(Number(unp)).toFixed(2)} USDT`;
          })()
        ];
        // 偏好：日結開關（預設開）
        try {
          const { getUserPrefs } = require('./alerts/preferences')
          const prefs = await getUserPrefs(u._id)
          if (prefs && prefs.daily === false) return
        } catch (_) {}
        await enqueueDaily({ chatIds: ids, text: lines.join('\n'), dateKey: t.dateKey, userId: u._id });
      }

      const CONC = 5
      let __idx = 0
      const workers = Array.from({ length: CONC }).map(() => (async () => {
        while (true) {
          let u
          try {
            if (__idx >= users.length) break
            u = users[__idx++]
          } catch (_) { break }
          try { await handleUser(u) } catch (_) {}
        }
      })())
      await Promise.all(workers)
    } catch (_) {}
  }
  // 每分鐘巡檢一次
  setInterval(tick, 60 * 1000)
  // 啟動 15 秒後先跑一次，避免剛好落在視窗內錯過
  setTimeout(tick, 15000)
})();

module.exports = { initMaintenance };

// 每週日 23:59 統計本週盈虧與 10% 抽傭並推送
;(function scheduleWeeklyCommission(){
  let LAST_TZ = process.env.TZ || 'Asia/Taipei'
  function validateOrFallbackTz(tzRaw){
    const fallback = process.env.TZ || 'Asia/Taipei'
    const tz = String(tzRaw || '').trim()
    if (!tz) return fallback
    try {
      // 若為無效時區，Intl 會丟 RangeError
      new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
      return tz
    } catch (e) {
      try { const logger = require('../utils/logger'); logger.warn('週報時區設定無效，使用預設', { tzRaw, fallback, message: e.message }) } catch (_) {}
      return fallback
    }
  }
  function nowInTz(){
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: LAST_TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date())
    const o = {}; for (const p of parts) o[p.type] = p.value
    const hh = Number(o.hour), mm = Number(o.minute)
    const isSun = new Date().toLocaleString('en-US', { timeZone: LAST_TZ, weekday: 'short' }).toLowerCase().startsWith('sun')
    return { hh, mm, isSun }
  }
  function weekRangeInTz(tz){
    try {
      const now = new Date()
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      const parts = fmt.formatToParts(now)
      const y = Number(parts.find(p => p.type === 'year')?.value)
      const m = Number(parts.find(p => p.type === 'month')?.value) - 1
      const d = Number(parts.find(p => p.type === 'day')?.value)
      const z = new Date(Date.UTC(y, m, d, 0, 0, 0))
      const tzOffsetMs = new Date(z.toLocaleString('en-US', { timeZone: tz })).getTime() - z.getTime()
      const localMidnight = new Date(z.getTime() + tzOffsetMs)
      const dow = localMidnight.getDay() // 0 Sun
      const daysFromMon = (dow === 0 ? 6 : (dow - 1))
      const mondayLocal = new Date(localMidnight.getTime() - daysFromMon * 24 * 60 * 60 * 1000)
      // 週日結束時間：週一 + 6 天 + 23:59:59.999
      const sundayLocalEnd = new Date(mondayLocal.getTime() + 6 * 24 * 60 * 60 * 1000 + (24 * 60 * 60 * 1000 - 1))
      const startMM = String(mondayLocal.getMonth()+1).padStart(2,'0')
      const startDD = String(mondayLocal.getDate()).padStart(2,'0')
      const endMM = String(sundayLocalEnd.getMonth()+1).padStart(2,'0')
      const endDD = String(sundayLocalEnd.getDate()).padStart(2,'0')
      const rangeText = `${startMM}/${startDD}~${endMM}/${endDD}`
      const mondayKey = `${mondayLocal.getFullYear()}-${String(mondayLocal.getMonth()+1).padStart(2,'0')}-${String(mondayLocal.getDate()).padStart(2,'0')}`
      const sundayKey = `${sundayLocalEnd.getFullYear()}-${String(sundayLocalEnd.getMonth()+1).padStart(2,'0')}-${String(sundayLocalEnd.getDate()).padStart(2,'0')}`
      return { rangeText, mondayKey, sundayKey }
    } catch (_) { return { rangeText: '', mondayKey: '', sundayKey: '' } }
  }
  async function tick(){
    try {
      // 先讀取 SystemConfig 以決定觸發所用時區
      const SystemConfig = require('../models/SystemConfig')
      const cfg = await SystemConfig.getSingleton().catch(() => null)
      const cfgTz = String(cfg?.weekly?.tz || '').trim()
      LAST_TZ = validateOrFallbackTz(cfgTz)
      const t = nowInTz()
      if (!(t.isSun && t.hh === 23 && t.mm === 59)) return
      try { const logger = require('../utils/logger'); logger.info('每週結算觸發', { tz: LAST_TZ }) } catch (_) {}
      const percent = (() => {
        const p = Number(cfg?.weekly?.percent)
        if (Number.isFinite(p) && p >= 0 && p <= 1) return p
        const envp = Number(process.env.WEEKLY_COMMISSION_PERCENT || 0.1)
        return (Number.isFinite(envp) && envp >= 0 && envp <= 1) ? envp : 0.1
      })()
      const cfgIds = Array.isArray(cfg?.weekly?.tgIds) ? cfg.weekly.tgIds : []
      const envIds = String(process.env.WEEKLY_COMMISSION_TG_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
      const ids = (cfgIds && cfgIds.length) ? cfgIds : envIds
      if (!ids.length || cfg?.weekly?.enabled === false) {
        try { const logger = require('../utils/logger'); logger.info('週報略過：無 chatId 或已停用', { enabled: cfg?.weekly?.enabled !== false, idCount: ids.length }) } catch (_) {}
        return
      }
      const users = await User.find({ enabled: true }).select('_id displayName uid exchange').lean()
      const { rangeText, mondayKey, sundayKey } = weekRangeInTz(LAST_TZ)
      const lines = []
      lines.push(`📅 週盈虧結算（${rangeText}）`)
      const WeeklyStats = require('../models/WeeklyStats')
      for (const u of users) {
        try {
          const ex = String(u.exchange||'').toLowerCase()
          let data = null
          if (ex === 'okx') data = await getOkxWeekly(u._id).catch(() => null)
          else if (ex === 'binance') data = await getBinanceWeekly(u._id).catch(() => null)
          if (!data) continue
          // 有自定義用戶名：顯示「斜體用戶名｜UID」；無則只顯示 UID
          const uidText = u.uid || String(u._id)
          const userLine = u.displayName ? `_${u.displayName}_｜${uidText}` : uidText
          // 不做四舍五入，保留原始數值
          const pnl = Number(data.pnlWeek||0)
          const comm = Number(pnl) * percent
          // 數值加粗體，保留小數點後2位
          const pnlText = pnl>0?`*+ ${pnl.toFixed(2)}*`:pnl<0?`*- ${Math.abs(pnl).toFixed(2)}*`:`*0.00*`
          const commText = comm>0?`*+ ${comm.toFixed(2)}*`:comm<0?`*- ${Math.abs(comm).toFixed(2)}*`:`*0.00*`
          lines.push(userLine)
          lines.push(`週盈虧 ${pnlText} USDT｜週抽傭 ${commText} USDT`)
          // 固化寫入 WeeklyStats（upsert）
          try {
            await WeeklyStats.updateOne(
              { user: u._id, weekStart: mondayKey },
              { $set: { weekEnd: sundayKey, pnlWeek: pnl, commissionWeek: comm, realizedWeek: Number(data.realizedWeek||0), feeWeek: Number(data.feeWeek||0), fundingWeek: Number(data.fundingWeek||0) } },
              { upsert: true }
            )
          } catch (_) {}
        } catch (_) {}
      }
      if (lines.length <= 1) {
        try { const logger = require('../utils/logger'); logger.info('週報略過：本週無可用統計') } catch (_) {}
        return
      }
      const text = lines.join('\n')
      const dateKey = `WEEKLY:${mondayKey}`
      for (const chatId of ids) {
        try { const logger = require('../utils/logger'); logger.info('週報已入佇列', { chatId, dateKey }) } catch (_) {}
        await enqueueDaily({ chatIds: [chatId], text, dateKey }).catch(() => {})
      }
    } catch (_) {}
  }
  setInterval(tick, 60 * 1000)
  setTimeout(tick, 15000)
})();

// 每小時 05 分對帳刷新（提升本日/7日/30日準確度）
;(function scheduleHourlyReconcile(){
  const TZ = process.env.TZ || 'Asia/Taipei'
  function nowInTz(){
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date())
    const o = {}; for (const p of parts) o[p.type] = p.value
    return { hh:Number(o.hour), mm:Number(o.minute) }
  }
  const exLimiters = new Map();
  function getExLimiter(ex){
    const key = String(ex || 'default').toLowerCase();
    if (!exLimiters.has(key)) exLimiters.set(key, new Bottleneck({ minTime: 300, maxConcurrent: 1 }));
    return exLimiters.get(key);
  }
  const globalLimiter = new Bottleneck({ minTime: 150, maxConcurrent: 1 });
  async function tick(){
    try {
      const t = nowInTz()
      if (!(t.mm === 5)) return
      const users = await User.find({ enabled: true })
      for (const u of users) {
        const exLimiter = getExLimiter(u.exchange)
        const ex = String(u.exchange||'').toLowerCase()
        if (ex === 'okx') {
          await globalLimiter.schedule(() => getOkxSummary(u._id, { refresh: true }))
        } else {
          await globalLimiter.schedule(() => exLimiter.schedule(() => aggregateForUser(u)))
        }
      }
    } catch (_) {}
  }
  setInterval(tick, 60 * 1000)
})();







