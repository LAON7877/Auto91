// 繁體中文註釋
// 信號解析服務：解析 TradingView JSON，按通道廣播至綁定該通道之使用者

const Tunnel = require('../models/Tunnel');
const User = require('../models/User');
const logger = require('../utils/logger');
const { processSignalForUser } = require('./tradeExecutor');

// 支援的信號格式（範例）：
// {"id":"開多","action":"buy","mp":"long","prevMP":"flat"}
// {"id":"開空","action":"sell","mp":"short","prevMP":"flat"}
// {"id":"平多","action":"sell","mp":"flat","prevMP":"long"}
// {"id":"平空","action":"buy","mp":"flat","prevMP":"short"}
// {"id":"開空","action":"sell","mp":"short","prevMP":"long"}
// {"id":"開多","action":"buy","mp":"long","prevMP":"short"}

function normalizeSignal(body) {
  if (!body || typeof body !== 'object') throw new Error('信號格式錯誤：需要 JSON 物件');
  const { id, action, mp, prevMP } = body;
  if (!id || !action || !mp || !prevMP) throw new Error('信號缺少必要欄位：id/action/mp/prevMP');
  if (!['buy', 'sell'].includes(action)) throw new Error('action 僅支援 buy/sell');
  if (!['long', 'short', 'flat'].includes(mp)) throw new Error('mp 僅支援 long/short/flat');
  if (!['long', 'short', 'flat'].includes(prevMP)) throw new Error('prevMP 僅支援 long/short/flat');
  return { id: id || '', action, mp, prevMP };
}

async function handleSignal({ body, suffix }) {
  const signal = normalizeSignal(body);
  // 找出綁定此 suffix 的通道，並且將信號分發給所有選擇該通道的用戶
  let targetUsers = [];
  if (suffix) {
    const tunnel = await Tunnel.findOne({ urlSuffix: suffix });
    if (!tunnel) throw new Error('通道不存在');
    // 強制從主數據庫讀取最新用戶設置，避免緩存問題
    // 注意：不使用 .lean()，因為 tradeExecutor 需要使用 getDecryptedKeys() 方法
    targetUsers = await User.find({ 
      selectedTunnel: tunnel._id, 
      enabled: true 
    }).select('+leverage +riskPercent +reservedFunds +fixedFunds +marginMode +pair +exchange +uid +name +subscriptionEnd +apiKeyEnc +apiSecretEnc +apiPassphraseEnc');
  } else {
    // 生產安全：禁止廣播（未指定 suffix 一律拒絕）
    throw new Error('缺少通道後綴 suffix，已拒絕廣播');
  }

  logger.info('接收信號，開始分發', { signal, userCount: targetUsers.length, suffix });

  // 受控併發（一次最多 N 個，避免瞬時打爆交易所）
  const maxConcurrency = Number(process.env.SIGNAL_DISPATCH_CONCURRENCY || 5);
  const queueArr = [...targetUsers];
  const results = [];
  async function worker() {
    while (queueArr.length) {
      const user = queueArr.shift();
      try {
        if (user.subscriptionEnd && new Date(user.subscriptionEnd).getTime() < Date.now()) {
          results.push({ user: user._id, ok: false, ignored: true, reason: 'subscription_expired' });
          continue;
        }
        const r = await processSignalForUser(user, signal);
        results.push({ user: user._id, ok: true, result: r });
      } catch (err) {
        logger.error('使用者處理信號失敗', { userId: user._id.toString(), message: err.message });
        results.push({ user: user._id, ok: false, error: err.message });
      }
    }
  }
  const workers = Array.from({ length: Math.min(maxConcurrency, targetUsers.length) }, () => worker());
  await Promise.all(workers);
  return { ok: true, dispatched: results.length, results };
}

module.exports = { handleSignal };


