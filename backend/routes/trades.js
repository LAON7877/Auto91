// 繁體中文註釋
// 交易紀錄路由

const express = require('express');
const router = express.Router();
const { listTrades } = require('../controllers/tradeController');
const { listSummaries } = require('../controllers/accountController');
const { getDaily } = require('../controllers/dailyController');

router.get('/', listTrades);
router.get('/summaries', listSummaries);
router.get('/daily', getDaily);

module.exports = router;



