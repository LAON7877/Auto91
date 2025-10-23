// 繁體中文註釋
// 通道路由

const express = require('express');
const router = express.Router();
const { listTunnels, createTunnel, updateTunnel, deleteTunnel } = require('../controllers/tunnelController');

router.get('/', listTunnels);
router.post('/', createTunnel);
router.put('/:id', updateTunnel);
router.delete('/:id', deleteTunnel);

module.exports = router;



