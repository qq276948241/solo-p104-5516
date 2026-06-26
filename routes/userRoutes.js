const express = require('express');
const router = express.Router();
const { auth, requireLeader } = require('../middleware/auth');
const userCtrl = require('../controllers/userController');

router.post('/register', userCtrl.register);
router.post('/login', userCtrl.login);
router.get('/profile', auth, userCtrl.getProfile);
router.post('/apply-leader', auth, userCtrl.applyLeader);
router.get('/pending-leaders', auth, requireLeader, userCtrl.listPendingLeaders);
router.put('/approve-leader/:userId', auth, requireLeader, userCtrl.approveLeader);
router.put('/reject-leader/:userId', auth, requireLeader, userCtrl.rejectLeader);

module.exports = router;
