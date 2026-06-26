const express = require('express');
const router = express.Router();
const { auth, requireLeader } = require('../middleware/auth');
const orderCtrl = require('../controllers/orderController');

router.post('/', auth, orderCtrl.create);
router.get('/my', auth, orderCtrl.myOrders);
router.get('/leader/list', auth, requireLeader, orderCtrl.leaderOrders);
router.get('/leader/export', auth, requireLeader, orderCtrl.exportCsv);
router.get('/:id', auth, orderCtrl.getOne);
router.put('/:id/pay', auth, orderCtrl.pay);
router.put('/:id/pickup', auth, orderCtrl.pickup);
router.put('/:id/cancel', auth, orderCtrl.cancel);

module.exports = router;
