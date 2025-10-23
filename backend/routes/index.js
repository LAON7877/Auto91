// 繁體中文註釋
// API 總路由匯集

const express = require('express');
const router = express.Router();

const tunnelRoutes = require('./tunnels');
const userRoutes = require('./users');
const tradeRoutes = require('./trades');
const signalRoutes = require('./signals');
const accountRoutes = require('./accounts');
const metricsRoutes = require('./metrics');
const adminRoutes = require('./admin');
const okxRoutes = require('./okx');
const binanceRoutes = require('./binance');

router.use('/tunnels', tunnelRoutes);
router.use('/users', userRoutes);
router.use('/trades', tradeRoutes);
router.use('/signal', signalRoutes);
router.use('/accounts', accountRoutes);
router.use('/metrics', metricsRoutes);
router.use('/admin', adminRoutes);
router.use('/okx', okxRoutes);
router.use('/binance', binanceRoutes);

module.exports = router;



