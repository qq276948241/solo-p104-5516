const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { generateToken } = require('../utils/jwt');

exports.register = async (req, res) => {
  const { phone, password, nickname } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ code: 400, msg: '手机号和密码不能为空' });
  }
  try {
    const [exist] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (exist.length > 0) {
      return res.status(409).json({ code: 409, msg: '手机号已注册' });
    }
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (phone, password, nickname) VALUES (?, ?, ?)',
      [phone, hash, nickname || '']
    );
    const token = generateToken({ id: result.insertId });
    res.json({ code: 0, msg: '注册成功', data: { token, userId: result.insertId } });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '注册失败', error: err.message });
  }
};

exports.login = async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ code: 400, msg: '手机号和密码不能为空' });
  }
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '用户不存在' });
    }
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ code: 401, msg: '密码错误' });
    }
    const token = generateToken({ id: user.id });
    res.json({
      code: 0,
      msg: '登录成功',
      data: {
        token,
        userId: user.id,
        nickname: user.nickname,
        role: user.role,
        roleApproved: user.role_approved,
      },
    });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '登录失败', error: err.message });
  }
};

exports.applyLeader = async (req, res) => {
  try {
    const userId = req.user.id;
    await pool.query('UPDATE users SET role = 1, role_approved = 0 WHERE id = ?', [userId]);
    res.json({ code: 0, msg: '已申请团长，等待审核' });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '申请失败', error: err.message });
  }
};

exports.listPendingLeaders = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, phone, nickname, created_at FROM users WHERE role = 1 AND role_approved = 0'
    );
    res.json({ code: 0, data: rows });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '查询失败', error: err.message });
  }
};

exports.approveLeader = async (req, res) => {
  try {
    const { userId } = req.params;
    const [rows] = await pool.query('SELECT role, role_approved FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '用户不存在' });
    }
    if (rows[0].role !== 1) {
      return res.status(400).json({ code: 400, msg: '该用户未申请团长' });
    }
    if (rows[0].role_approved === 1) {
      return res.status(400).json({ code: 400, msg: '该用户已是审核通过的团长' });
    }
    await pool.query('UPDATE users SET role_approved = 1 WHERE id = ?', [userId]);
    res.json({ code: 0, msg: '团长审核通过' });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '审核失败', error: err.message });
  }
};

exports.rejectLeader = async (req, res) => {
  try {
    const { userId } = req.params;
    const [rows] = await pool.query('SELECT role, role_approved FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '用户不存在' });
    }
    await pool.query('UPDATE users SET role = 0, role_approved = 0 WHERE id = ?', [userId]);
    res.json({ code: 0, msg: '已拒绝团长申请' });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '操作失败', error: err.message });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, phone, nickname, role, role_approved, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '用户不存在' });
    }
    res.json({ code: 0, data: rows[0] });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '查询失败', error: err.message });
  }
};
