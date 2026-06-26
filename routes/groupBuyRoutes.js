const express = require('express');
const router = express.Router();
const { auth, requireLeader } = require('../middleware/auth');
const gbCtrl = require('../controllers/groupBuyController');

router.post('/', auth, requireLeader, gbCtrl.create);
router.get('/', auth, gbCtrl.list);
router.get('/mine', auth, requireLeader, gbCtrl.listMine);
router.get('/:id', auth, gbCtrl.getOne);
router.put('/:id/close', auth, requireLeader, gbCtrl.close);

module.exports = router;
