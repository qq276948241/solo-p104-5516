const { verifyToken } = require('../utils/jwt');
const pool = require('../config/db');

exports.auth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, msg: '未登录' });
  }
  try {
    const decoded = verifyToken(authHeader.split(' ')[1]);
    const [rows] = await pool.query('SELECT id, phone, nickname, role, role_approved FROM users WHERE id = ?', [decoded.id]);
    if (rows.length === 0) {
      return res.status(401).json({ code: 401, msg: '用户不存在' });
    }
    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ code: 401, msg: 'token无效或已过期' });
  }
};

exports.requireLeader = (req, res, next) => {
  if (req.user.role !== 1 || req.user.role_approved !== 1) {
    return res.status(403).json({ code: 403, msg: '需要团长权限' });
  }
  next();
};
