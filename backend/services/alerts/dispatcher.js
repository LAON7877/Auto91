// 繁體中文註釋
// Alerts 分發器：將告警發到 Telegram（未來可擴充到 Email/Slack）

const { enqueueDaily, enqueueHourly, enqueueWindowed } = require('../telegram')

async function sendTelegram({ chatIds, text, userId }) {
  const dateKey = new Date().toISOString().slice(0,10)
  await enqueueDaily({ chatIds, text, dateKey, userId })
}

module.exports = { sendTelegram }

async function sendTelegramHourly({ chatIds, text, userId, hourKey, scopeKey }) {
  await enqueueHourly({ chatIds, text, userId, hourKey, scopeKey })
}

module.exports.sendTelegramHourly = sendTelegramHourly

async function sendTelegramWindowed({ chatIds, text, userId, windowKey, scopeKey }) {
  await enqueueWindowed({ chatIds, text, userId, windowKey, scopeKey })
}

module.exports.sendTelegramWindowed = sendTelegramWindowed





