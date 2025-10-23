// 繁體中文註釋
// 快照排程器：批次（每分鐘）分批同步用戶（一次性 REST 快照 + PnL/費用回補）

const Bottleneck = require('bottleneck')
const User = require('../models/User')
const { coldStartSnapshotForUser } = require('./accountMonitor')
const { aggregateForUser } = require('./pnlAggregator')

// 全域與每交易所節流（與 accountMonitor 內一致即可）
const limiterGlobal = new Bottleneck({ minTime: 200, maxConcurrent: 2 })
const limiterEx = new Map()
function getLimiter(ex) {
  if (!limiterEx.has(ex)) limiterEx.set(ex, new Bottleneck({ minTime: 250, maxConcurrent: 1 }))
  return limiterEx.get(ex)
}

// 簡易優先佇列
const queue = [] // { userId, priority: 0|1 }
const inflight = new Set()
let roundRobinIndex = 0

function enqueueUser(userId, priority = 0) {
  if (!queue.find(q => q.userId === String(userId))) queue.push({ userId: String(userId), priority })
}

async function doSnapshotSync(user) {
  // 使用 coldStart + 單次 PnL 回補
  await coldStartSnapshotForUser(user)
  try { await aggregateForUser(user) } catch (_) {}
}

async function workerOnce() {
  // 取最高優先項目
  queue.sort((a,b) => b.priority - a.priority)
  const task = queue.shift()
  if (!task) return
  const userId = task.userId
  if (inflight.has(userId)) return
  inflight.add(userId)
  try {
    const user = await User.findById(userId)
    if (user && user.enabled) {
      const exLimiter = getLimiter(user.exchange)
      await limiterGlobal.schedule(() => exLimiter.schedule(() => doSnapshotSync(user)))
    }
  } catch (_) {}
  finally { inflight.delete(userId) }
}

let timer = null
async function initSnapshotScheduler({ batchSize = 5, intervalMs = 60000 } = {}) {
  if (timer) return
  async function tick() {
    try {
      const users = await User.find({ enabled: true }).sort({ createdAt: 1 })
      // 將本輪的 batch 放到佇列尾端
      for (let i = 0; i < batchSize && users.length; i++) {
        const idx = (roundRobinIndex + i) % users.length
        enqueueUser(users[idx]._id, 0)
      }
      roundRobinIndex = (roundRobinIndex + batchSize) % (users.length || 1)
    } catch (_) {}
    // 消化佇列（限制並發）
    for (let i = 0; i < 3; i++) { // 每輪嘗試處理數個任務
      // eslint-disable-next-line no-await-in-loop
      await workerOnce()
    }
  }
  timer = setInterval(tick, intervalMs)
  await tick()
}

module.exports = { initSnapshotScheduler, enqueueUser }






















