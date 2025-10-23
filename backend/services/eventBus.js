// 繁體中文註釋
// 簡易事件匯流層，避免模組之間循環相依：
// - 前端廣播：'frontend:broadcast', payload
// - 帳戶摘要更新：'account:update', { user, summary, positions }

const EventEmitter = require('events')

class TradingBotBus extends EventEmitter {}

const bus = new TradingBotBus()

module.exports = bus






















