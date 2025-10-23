// 繁體中文註釋
// 統一日誌：Winston + morgan stream

const { createLogger, format, transports } = require('winston');

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.timestamp(),
        format.printf(({ level, message, timestamp, ...meta }) => {
          return `${timestamp} [${level}] ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      ),
    }),
  ],
});

logger.stream = {
  write: (message) => logger.info(message.trim()),
};

// lightweight in-memory metrics（滑動時間窗）
const WINDOW_MS = Number(process.env.METRICS_WINDOW_MS || (24 * 60 * 60 * 1000));
const latencies = []; // { t, v }
let orders429Evts = []; // [t]
let rest429Evts = []; // [t]
let wsReconnects = []; // { t, ex }
let reconcileSuccess = []; // [t]
let reconcileFail = []; // [t]

function prune() {
  const cutoff = Date.now() - WINDOW_MS;
  while (latencies.length && latencies[0].t < cutoff) latencies.shift();
  while (orders429Evts.length && orders429Evts[0] < cutoff) orders429Evts.shift();
  while (rest429Evts.length && rest429Evts[0] < cutoff) rest429Evts.shift();
  while (wsReconnects.length && wsReconnects[0].t < cutoff) wsReconnects.shift();
  while (reconcileSuccess.length && reconcileSuccess[0] < cutoff) reconcileSuccess.shift();
  while (reconcileFail.length && reconcileFail[0] < cutoff) reconcileFail.shift();
}

logger.metrics = {
  pushLatency(ms) {
    latencies.push({ t: Date.now(), v: Number(ms) || 0 });
    prune();
  },
  mark429() {
    orders429Evts.push(Date.now());
    prune();
  },
  markRest429() { rest429Evts.push(Date.now()); prune(); },
  markWsReconnect(ex) { wsReconnects.push({ t: Date.now(), ex: String(ex||'') }); prune(); },
  markReconcileSuccess() { reconcileSuccess.push(Date.now()); prune(); },
  markReconcileFail() { reconcileFail.push(Date.now()); prune(); },
  snapshot() {
    prune();
    const vs = latencies.map(x => x.v).sort((a,b)=>a-b);
    const count = vs.length;
    const p95 = count ? vs[Math.floor(count * 0.95)] : 0;
    return {
      orders429: orders429Evts.length,
      rest429: rest429Evts.length,
      wsReconnects: wsReconnects.length,
      reconcileSuccess: reconcileSuccess.length,
      reconcileFail: reconcileFail.length,
      count, p95Ms: p95, windowMs: WINDOW_MS
    };
  }
};

module.exports = logger;




