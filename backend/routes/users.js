// 繁體中文註釋
// 使用者路由

const express = require('express');
const router = express.Router();
const { listUsers, createUser, updateUser, deleteUser, updateUserTgPrefs } = require('../controllers/userController');

router.get('/', listUsers);
router.post('/', createUser);
router.patch('/:id/tg-prefs', updateUserTgPrefs);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

module.exports = router;
















