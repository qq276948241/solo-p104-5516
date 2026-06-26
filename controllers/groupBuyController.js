const pool = require('../config/db');

exports.create = async (req, res) => {
  const { title, originalPrice, groupPrice, pickupTime, stock } = req.body;
  if (!title || !originalPrice || !groupPrice || !pickupTime || stock === undefined) {
    return res.status(400).json({ code: 400, msg: '缺少必填字段' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO group_buys (leader_id, title, original_price, group_price, pickup_time, stock) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, title, originalPrice, groupPrice, pickupTime, stock]
    );
    const [rows] = await pool.query('SELECT * FROM group_buys WHERE id = ?', [result.insertId]);
    res.json({ code: 0, msg: '发布成功', data: rows[0] });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '发布失败', error: err.message });
  }
};

exports.list = async (req, res) => {
  const { status } = req.query;
  try {
    let sql = `
      SELECT gb.*, u.nickname AS leader_name
      FROM group_buys gb
      JOIN users u ON gb.leader_id = u.id
    `;
    const params = [];
    if (status !== undefined) {
      sql += ' WHERE gb.status = ?';
      params.push(Number(status));
    }
    sql += ' ORDER BY gb.created_at DESC';
    const [rows] = await pool.query(sql, params);
    res.json({ code: 0, data: rows });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '查询失败', error: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT gb.*, u.nickname AS leader_name
       FROM group_buys gb
       JOIN users u ON gb.leader_id = u.id
       WHERE gb.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '团购不存在' });
    }
    res.json({ code: 0, data: rows[0] });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '查询失败', error: err.message });
  }
};

exports.close = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT * FROM group_buys WHERE id = ? AND leader_id = ? FOR UPDATE',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ code: 404, msg: '团购不存在或非本人发布' });
    }
    if (rows[0].status !== 1) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ code: 400, msg: '该团购已结束' });
    }
    await conn.query('UPDATE group_buys SET status = 2 WHERE id = ?', [req.params.id]);
    const [updated] = await conn.query('SELECT * FROM group_buys WHERE id = ?', [req.params.id]);
    await conn.commit();
    conn.release();
    res.json({ code: 0, msg: '团购已手动关闭', data: updated[0] });
  } catch (err) {
    await conn.rollback();
    conn.release();
    res.status(500).json({ code: 500, msg: '操作失败', error: err.message });
  }
};

exports.update = async (req, res) => {
  const { originalPrice, groupPrice, pickupTime, stock } = req.body;
  if (
    originalPrice === undefined &&
    groupPrice === undefined &&
    pickupTime === undefined &&
    stock === undefined
  ) {
    return res.status(400).json({ code: 400, msg: '至少传一个要改的字段' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT * FROM group_buys WHERE id = ? AND leader_id = ? FOR UPDATE',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ code: 404, msg: '团购不存在或非本人发布' });
    }
    const gb = rows[0];
    if (gb.status !== 1) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ code: 400, msg: '只允许编辑进行中的团购' });
    }
    const [orderCount] = await conn.query(
      'SELECT COUNT(*) AS cnt FROM orders WHERE group_buy_id = ? AND status != 3',
      [req.params.id]
    );
    if (orderCount[0].cnt > 0) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ code: 400, msg: '已有邻居下单，不允许再改' });
    }
    const sets = [];
    const params = [];
    if (originalPrice !== undefined) {
      sets.push('original_price = ?');
      params.push(originalPrice);
    }
    if (groupPrice !== undefined) {
      sets.push('group_price = ?');
      params.push(groupPrice);
    }
    if (pickupTime !== undefined) {
      sets.push('pickup_time = ?');
      params.push(pickupTime);
    }
    if (stock !== undefined) {
      sets.push('stock = ?');
      params.push(Number(stock));
    }
    params.push(req.params.id);
    await conn.query(`UPDATE group_buys SET ${sets.join(', ')} WHERE id = ?`, params);
    const [updated] = await conn.query('SELECT * FROM group_buys WHERE id = ?', [req.params.id]);
    await conn.commit();
    conn.release();
    res.json({ code: 0, msg: '修改成功', data: updated[0] });
  } catch (err) {
    await conn.rollback();
    conn.release();
    res.status(500).json({ code: 500, msg: '修改失败', error: err.message });
  }
};

exports.listMine = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM group_buys WHERE leader_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ code: 0, data: rows });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '查询失败', error: err.message });
  }
};
