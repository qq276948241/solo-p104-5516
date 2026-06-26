const pool = require('../config/db');

function generateOrderNo() {
  const now = new Date();
  const ts = now.getFullYear().toString()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0')
    + String(now.getSeconds()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return ts + rand;
}

exports.create = async (req, res) => {
  const { groupBuyId, quantity, remark } = req.body;
  const qty = Math.max(1, Number(quantity) || 1);

  if (!groupBuyId) {
    return res.status(400).json({ code: 400, msg: '缺少团购ID' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [gbRows] = await conn.query(
      'SELECT * FROM group_buys WHERE id = ? AND status = 1 FOR UPDATE',
      [groupBuyId]
    );
    if (gbRows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ code: 400, msg: '团购不存在或已结束' });
    }
    const gb = gbRows[0];

    if (gb.stock < qty) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ code: 400, msg: '库存不足' });
    }

    await conn.query(
      'UPDATE group_buys SET stock = stock - ? WHERE id = ? AND stock >= ?',
      [qty, groupBuyId, qty]
    );
    const [check] = await conn.query('SELECT stock FROM group_buys WHERE id = ?', [groupBuyId]);
    if (check[0].stock < 0) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ code: 400, msg: '库存不足(并发)' });
    }

    const orderNo = generateOrderNo();
    const totalPrice = (parseFloat(gb.group_price) * qty).toFixed(2);

    const [result] = await conn.query(
      'INSERT INTO orders (order_no, user_id, group_buy_id, quantity, total_price, remark, status) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [orderNo, req.user.id, groupBuyId, qty, totalPrice, remark || '']
    );

    await conn.commit();
    conn.release();

    res.json({
      code: 0,
      msg: '下单成功，请15分钟内付款',
      data: { orderId: result.insertId, orderNo, totalPrice },
    });
  } catch (err) {
    await conn.rollback();
    conn.release();
    res.status(500).json({ code: 500, msg: '下单失败', error: err.message });
  }
};

exports.pay = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT * FROM orders WHERE id = ? AND user_id = ? FOR UPDATE',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ code: 404, msg: '订单不存在' });
    }
    const order = rows[0];
    if (order.status !== 0) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ code: 400, msg: '订单状态不允许付款' });
    }
    const created = new Date(order.created_at).getTime();
    const now = Date.now();
    if (now - created > 15 * 60 * 1000) {
      await conn.query('UPDATE orders SET status = 3 WHERE id = ?', [order.id]);
      await conn.query(
        'UPDATE group_buys SET stock = stock + ? WHERE id = ?',
        [order.quantity, order.group_buy_id]
      );
      await conn.rollback();
      conn.release();
      return res.status(400).json({ code: 400, msg: '已超时，订单已取消' });
    }
    await conn.query('UPDATE orders SET status = 1 WHERE id = ?', [order.id]);
    await conn.commit();
    conn.release();
    res.json({ code: 0, msg: '付款成功' });
  } catch (err) {
    await conn.rollback();
    conn.release();
    res.status(500).json({ code: 500, msg: '付款失败', error: err.message });
  }
};

exports.pickup = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '订单不存在' });
    }
    if (rows[0].status !== 1) {
      return res.status(400).json({ code: 400, msg: '订单状态不允许自提确认' });
    }
    await pool.query('UPDATE orders SET status = 2 WHERE id = ?', [req.params.id]);
    res.json({ code: 0, msg: '已确认自提' });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '操作失败', error: err.message });
  }
};

exports.cancel = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT * FROM orders WHERE id = ? AND user_id = ? FOR UPDATE',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ code: 404, msg: '订单不存在' });
    }
    if (rows[0].status !== 0) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ code: 400, msg: '只能取消待付款订单' });
    }
    await conn.query('UPDATE orders SET status = 3 WHERE id = ?', [req.params.id]);
    await conn.query(
      'UPDATE group_buys SET stock = stock + ? WHERE id = ?',
      [rows[0].quantity, rows[0].group_buy_id]
    );
    await conn.commit();
    conn.release();
    res.json({ code: 0, msg: '订单已取消' });
  } catch (err) {
    await conn.rollback();
    conn.release();
    res.status(500).json({ code: 500, msg: '取消失败', error: err.message });
  }
};

exports.myOrders = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT o.*, gb.title AS group_buy_title, gb.group_price, gb.pickup_time
       FROM orders o
       JOIN group_buys gb ON o.group_buy_id = gb.id
       WHERE o.user_id = ?
       ORDER BY o.created_at DESC`,
      [req.user.id]
    );
    res.json({ code: 0, data: rows });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '查询失败', error: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT o.*, gb.title AS group_buy_title, gb.group_price, gb.pickup_time
       FROM orders o
       JOIN group_buys gb ON o.group_buy_id = gb.id
       WHERE o.id = ? AND o.user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '订单不存在' });
    }
    res.json({ code: 0, data: rows[0] });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '查询失败', error: err.message });
  }
};

exports.exportCsv = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().slice(0, 10);

    const [groupBuys] = await pool.query(
      'SELECT id FROM group_buys WHERE leader_id = ?',
      [req.user.id]
    );
    if (groupBuys.length === 0) {
      return res.json({ code: 0, data: '' });
    }
    const gbIds = groupBuys.map((g) => g.id);

    const [rows] = await pool.query(
      `SELECT o.order_no, u.nickname, u.phone, gb.title, o.quantity, o.total_price,
              o.remark, o.status,
              CASE o.status
                WHEN 0 THEN '待付款'
                WHEN 1 THEN '已付款'
                WHEN 2 THEN '已自提'
                WHEN 3 THEN '已取消'
              END AS status_text,
              o.created_at
       FROM orders o
       JOIN users u ON o.user_id = u.id
       JOIN group_buys gb ON o.group_buy_id = gb.id
       WHERE o.group_buy_id IN (?) AND DATE(o.created_at) = ?
       ORDER BY o.created_at ASC`,
      [gbIds, targetDate]
    );

    const BOM = '\uFEFF';
    let csv = BOM + '订单号,昵称,手机号,商品,数量,总价,备注,状态,下单时间\n';
    for (const r of rows) {
      csv += [
        r.order_no,
        r.nickname,
        r.phone,
        r.title,
        r.quantity,
        r.total_price,
        '"' + (r.remark || '').replace(/"/g, '""') + '"',
        r.status_text,
        r.created_at.toISOString().replace('T', ' ').slice(0, 19),
      ].join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="orders_${targetDate}.csv"`
    );
    res.send(csv);
  } catch (err) {
    res.status(500).json({ code: 500, msg: '导出失败', error: err.message });
  }
};

exports.leaderOrders = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().slice(0, 10);

    const [groupBuys] = await pool.query(
      'SELECT id FROM group_buys WHERE leader_id = ?',
      [req.user.id]
    );
    if (groupBuys.length === 0) {
      return res.json({ code: 0, data: [] });
    }
    const gbIds = groupBuys.map((g) => g.id);

    const [rows] = await pool.query(
      `SELECT o.*, u.nickname, u.phone, gb.title AS group_buy_title
       FROM orders o
       JOIN users u ON o.user_id = u.id
       JOIN group_buys gb ON o.group_buy_id = gb.id
       WHERE o.group_buy_id IN (?) AND DATE(o.created_at) = ?
       ORDER BY o.created_at DESC`,
      [gbIds, targetDate]
    );
    res.json({ code: 0, data: rows });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '查询失败', error: err.message });
  }
};

exports.autoCancelExpired = async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id, group_buy_id, quantity FROM orders
       WHERE status = 0 AND created_at < NOW() - INTERVAL 15 MINUTE
       FOR UPDATE`
    );
    if (rows.length === 0) {
      await conn.commit();
      conn.release();
      return;
    }
    const ids = rows.map((r) => r.id);
    await conn.query('UPDATE orders SET status = 3 WHERE id IN (?)', [ids]);
    for (const r of rows) {
      await conn.query(
        'UPDATE group_buys SET stock = stock + ? WHERE id = ?',
        [r.quantity, r.group_buy_id]
      );
    }
    await conn.commit();
    conn.release();
    console.log(`[auto-cancel] cancelled ${rows.length} expired orders`);
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('[auto-cancel] error:', err.message);
  }
};
