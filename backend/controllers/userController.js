// 繁體中文註釋
// 使用者 CRUD 控制器

const User = require('../models/User');
const { isValidLeverage, isValidRiskPercent, isExchange, isMarginMode, isNonEmptyString, isValidDateValue } = require('../utils/validators');
const { ensureSubscriptionForUser } = require('../services/marketWs');
const { ensureAccountMonitorForUser, applyExternalAccountUpdate, removeUserFromMonitor } = require('../services/accountMonitor');
const AccountSnapshot = require('../models/AccountSnapshot');
const { connectUserStream: connectBinancePrivate } = require('../services/wsPrivate/binancePrivate');
const { connectPrivate: connectOkxPrivate } = require('../services/wsPrivate/okxPrivate');
const bus = require('../services/eventBus');
const Tunnel = require('../models/Tunnel');
const { bumpBySuffix } = require('../services/signalConfigVersion');

async function listUsers(req, res, next) {
  try {
    const users = await User.find().populate('selectedTunnel');
    res.json(users);
  } catch (err) {
    next(err);
  }
}

async function createUser(req, res, next) {
  try {
    const { name, exchange, apiKey, apiSecret, apiPassphrase, uid, pair, marginMode, leverage, riskPercent, selectedTunnel, subscriptionEnd, telegramIds, reservedFunds, fixedFunds } = req.body;
    if (!isExchange(exchange)) throw new Error('不支援的交易所，僅支援 binance/okx');
    if (!isValidLeverage(leverage)) throw new Error('槓桿需為 1-100 的整數');
    if (!isValidRiskPercent(riskPercent)) throw new Error('風險比需為 1-100 之間');
    if (!isMarginMode(marginMode)) throw new Error('保證金模式僅支援 cross/isolated');
    if (!isNonEmptyString(apiKey) || !isNonEmptyString(apiSecret)) throw new Error('API Key/Secret 不得為空');
    if (!isNonEmptyString(uid)) throw new Error('UID 不得為空');
    if (!['BTC/USDT', 'ETH/USDT'].includes(pair)) throw new Error('僅支援交易對: BTC/USDT 或 ETH/USDT');

    if (!isValidDateValue(subscriptionEnd)) throw new Error('訂閱日期格式錯誤');
    const enc = User.encryptCredentials({ apiKey, apiSecret, apiPassphrase });
    // 兩欄位預處理：空/未定義 → 0；必須為非負數
    const rf = Number(reservedFunds || 0)
    const ff = Number(fixedFunds || 0)
    if (!Number.isFinite(rf) || rf < 0) throw new Error('保留資金需為 >= 0 的數字')
    if (!Number.isFinite(ff) || ff < 0) throw new Error('固定資金需為 >= 0 的數字')
    const user = await User.create({
      name: name || uid,
      exchange,
      ...enc,
      uid,
      pair,
      marginMode,
      leverage,
      riskPercent,
      reservedFunds: rf,
      fixedFunds: ff,
      selectedTunnel: selectedTunnel || null,
      subscriptionEnd: subscriptionEnd ? new Date(subscriptionEnd) : null,
      telegramIds: telegramIds || '',
    });
    // 建立即時行情訂閱
    await ensureSubscriptionForUser(user);
    ensureAccountMonitorForUser(user);
    const creds = user.getDecryptedKeys();
    if (user.exchange === 'binance') connectBinancePrivate(user, creds);
    if (user.exchange === 'okx') connectOkxPrivate(user, creds);
    // 幣安：冷啟快照（若開關開）
    try {
      const { coldStartSnapshotForUser } = require('../services/accountMonitor');
      await coldStartSnapshotForUser(user);
    } catch (_) {}
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
}

async function updateUser(req, res, next) {
  try {
    const { id } = req.params;
    const payload = { ...req.body };
    // reserved/fixed 欄位驗證（若提供）
    if (payload.reservedFunds !== undefined) {
      const rf = Number(payload.reservedFunds)
      if (!Number.isFinite(rf) || rf < 0) throw new Error('保留資金需為 >= 0 的數字')
      payload.reservedFunds = rf
    }
    if (payload.fixedFunds !== undefined) {
      const ff = Number(payload.fixedFunds)
      if (!Number.isFinite(ff) || ff < 0) throw new Error('固定資金需為 >= 0 的數字')
      payload.fixedFunds = ff
    }

    if (payload.exchange && !isExchange(payload.exchange)) throw new Error('不支援的交易所');
    if (payload.leverage !== undefined && !isValidLeverage(payload.leverage)) throw new Error('槓桿需為 1-100');
    if (payload.riskPercent !== undefined && !isValidRiskPercent(payload.riskPercent)) throw new Error('風險比需為 1-100');
    if (payload.marginMode && !isMarginMode(payload.marginMode)) throw new Error('保證金模式錯誤');
    if (payload.pair && !['BTC/USDT', 'ETH/USDT'].includes(payload.pair)) throw new Error('交易對不支援');
    if (payload.subscriptionEnd !== undefined) {
      if (!isValidDateValue(payload.subscriptionEnd)) throw new Error('訂閱日期格式錯誤');
      payload.subscriptionEnd = payload.subscriptionEnd ? new Date(payload.subscriptionEnd) : null;
    }

    // 若更新金鑰
    if (payload.apiKey || payload.apiSecret || payload.apiPassphrase) {
      const apiKey = payload.apiKey || '';
      const apiSecret = payload.apiSecret || '';
      const apiPassphrase = payload.apiPassphrase || '';
      if (!isNonEmptyString(apiKey) || !isNonEmptyString(apiSecret)) throw new Error('API Key/Secret 不得為空');
      const enc = User.encryptCredentials({ apiKey, apiSecret, apiPassphrase });
      payload.apiKeyEnc = enc.apiKeyEnc;
      payload.apiSecretEnc = enc.apiSecretEnc;
      payload.apiPassphraseEnc = enc.apiPassphraseEnc;
      delete payload.apiKey;
      delete payload.apiSecret;
      delete payload.apiPassphrase;
    }

    // 先取當前狀態以判斷是否需要 bump 版本
    const before = await User.findById(id).select('selectedTunnel subscriptionEnd enabled').lean();
    const user = await User.findByIdAndUpdate(id, payload, { new: true }).populate('selectedTunnel');
    if (!user) return res.status(404).json({ error: '使用者不存在' });
    // 立即廣播用戶名稱更新（避免前端等待下一次帳戶推播才更新顯示名稱）
    try {
      bus.emit('frontend:broadcast', {
        type: 'user_updated',
        userId: String(user._id),
        displayName: user.name || user.uid || String(user._id),
        uid: user.uid,
        ts: Date.now(),
      });
    } catch (_) {}
    // 確保行情訂閱存在（若更換交易對或交易所，會自動重新訂閱）
    await ensureSubscriptionForUser(user);
    ensureAccountMonitorForUser(user);
    const creds2 = user.getDecryptedKeys();
    if (user.exchange === 'binance') connectBinancePrivate(user, creds2);
    if (user.exchange === 'okx') connectOkxPrivate(user, creds2);
    // 熱啟快照：儲存後回放最新快照（若有）
    try {
      const snap = await AccountSnapshot.findOne({ user: user._id });
      if (snap && snap.summary) {
        applyExternalAccountUpdate(user, { summary: snap.summary, positions: snap.positions || [] });
      } else {
        // 僅更新 displayName，等待 WS/冷啟快照覆蓋
        applyExternalAccountUpdate(user, { summary: {}, positions: null });
      }
    } catch (_) {}

    // 根據通道/訂閱/啟用狀態改變，提升對應 suffix 的版本，以便去重鍵立即失效
    try {
      const after = { selectedTunnel: user.selectedTunnel?._id || null, subscriptionEnd: user.subscriptionEnd || null, enabled: user.enabled };
      const b = before || { selectedTunnel: null, subscriptionEnd: null, enabled: true };
      const beforeTunnelId = b.selectedTunnel ? String(b.selectedTunnel) : null;
      const afterTunnelId = after.selectedTunnel ? String(after.selectedTunnel) : null;
      let suffixToBump = null;
      if (beforeTunnelId !== afterTunnelId) {
        // 通道變更：對新通道後綴 bump 版本（舊通道不用）
        if (afterTunnelId) {
          const t = await Tunnel.findById(afterTunnelId).select('urlSuffix').lean();
          suffixToBump = t && t.urlSuffix ? String(t.urlSuffix) : null;
        }
      } else {
        // 通道未變，但訂閱或啟用狀態變動也應 bump（若有通道）
        const subChanged = String(b.subscriptionEnd || '') !== String(after.subscriptionEnd || '');
        const enabledChanged = Boolean(b.enabled) !== Boolean(after.enabled);
        if ((subChanged || enabledChanged) && afterTunnelId) {
          const t = await Tunnel.findById(afterTunnelId).select('urlSuffix').lean();
          suffixToBump = t && t.urlSuffix ? String(t.urlSuffix) : null;
        }
      }
      if (suffixToBump) bumpBySuffix(suffixToBump, 'user_update');
    } catch (_) {}
    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function updateUserTgPrefs(req, res, next) {
  try {
    const { id } = req.params;
    const { tgPrefs } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!tgPrefs || typeof tgPrefs !== 'object') return res.status(400).json({ error: 'tgPrefs object required' });
    const doc = await User.findByIdAndUpdate(id, { $set: { tgPrefs } }, { new: true }).select('_id tgPrefs');
    if (!doc) return res.status(404).json({ error: 'User not found' });
    // 清除用戶偏好緩存，確保設置更新後立即生效
    try { 
      const { clearUserCache } = require('../services/alerts/preferences'); 
      clearUserCache(id); 
    } catch (_) {}
    res.json({ ok: true, tgPrefs: doc.tgPrefs || {} });
  } catch (err) { next(err); }
}

async function deleteUser(req, res, next) {
  try {
    const { id } = req.params;
    await User.findByIdAndDelete(id);
    try { await removeUserFromMonitor(id) } catch (_) {}
    // 清理用戶的市場訂閱記錄
    try {
      const { removeUserSubscription } = require('../services/marketWs');
      removeUserSubscription(id);
    } catch (_) {}
    // 冪等保險：再次發送 user_removed（避免 WS 初連重播殘留）
    try {
      const bus = require('../services/eventBus')
      bus.emit('frontend:broadcast', { type: 'user_removed', userId: String(id), ts: Date.now() })
    } catch (_) {}
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { listUsers, createUser, updateUser, deleteUser };
module.exports.updateUserTgPrefs = updateUserTgPrefs;


