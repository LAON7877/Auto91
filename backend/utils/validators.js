// 繁體中文註釋
// 基本輸入驗證工具

function isValidLeverage(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 100;
}

function isValidRiskPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 100;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isExchange(value) {
  return value === 'binance' || value === 'okx';
}

function isMarginMode(value) {
  return value === 'cross' || value === 'isolated';
}

function isValidDateValue(value) {
  if (!value) return true; // 允許空值代表不限制
  const d = new Date(value);
  return !isNaN(d.getTime());
}

module.exports = {
  isValidLeverage,
  isValidRiskPercent,
  isNonEmptyString,
  isExchange,
  isMarginMode,
  isValidDateValue,
};


