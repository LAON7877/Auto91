// 繁體中文註釋
// Alerts 預設常數（可被環境變數或使用者偏好覆寫）

module.exports.DEFAULT_PREFS = {
  fills: true,       // 成交通知
  daily: true,       // 日結通知
  acctPos: true,     // 風控告警（預設開啟）
  riskOps: false,    // 系統告警（預設關閉）
  thresholds: {
    // 風控規則分級門檻
    // 未實現虧損：百分比 + 體量分級金額地板（最終採 max(百分比×錢包, 地板)）
    pnlWarnPctWallet: 0.01,     // 1%
    pnlCriticalPctWallet: 0.02, // 2%
    pnlFloors: [
      { maxWallet: 2000, warn: 100, critical: 300 },
      { maxWallet: 10000, warn: 200, critical: 600 },
      { maxWallet: Infinity, warn: 1000, critical: 3000 },
    ],

    // 強平距離（比率）：
    liqWarnRatio: 0.20,       // 20%
    liqCriticalRatio: 0.10,   // 10%
    liqSevereRatio: 0.05,     // 5%

    // 保證金餘額（可用/保證金）：
    marginWarnRatio: 0.20,    // 20%
    marginCriticalRatio: 0.10,// 10%

    // 日內已實現虧損：百分比 + 體量分級金額地板（最終採 max(百分比×錢包, 地板)）
    realizedWarnPctWallet: 0.02,  // 2%
    realizedCriticalPctWallet: 0.05, // 5%
    realizedFloors: [
      { maxWallet: 2000, warn: 200, critical: 500 },
      { maxWallet: 10000, warn: 400, critical: 1000 },
      { maxWallet: Infinity, warn: 2000, critical: 5000 },
    ],
    // 保留舊鍵，避免相容性問題（不再使用）
    liqProximityPct: 3,
    leverageChangePct: 15,
    balanceDropPct: 20,
    // 風控/系統
    wsStaleSec: 90,           // 私有 WS 過舊秒數
  },
  quietHours: null,  // { start:'23:00', end:'07:00' } 可選
}





