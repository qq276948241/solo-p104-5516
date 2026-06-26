require('dotenv').config();
const mysql = require('mysql2/promise');

async function initDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
  });

  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'community_groupbuy'}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.query(`USE \`${process.env.DB_NAME || 'community_groupbuy'}\``);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      phone VARCHAR(20) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      nickname VARCHAR(50) NOT NULL DEFAULT '',
      role TINYINT NOT NULL DEFAULT 0 COMMENT '0=普通用户,1=团长',
      role_approved TINYINT NOT NULL DEFAULT 0 COMMENT '团长身份是否审核通过 0=未审核/待审核,1=已通过',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS group_buys (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      leader_id INT UNSIGNED NOT NULL,
      title VARCHAR(200) NOT NULL,
      original_price DECIMAL(10,2) NOT NULL,
      group_price DECIMAL(10,2) NOT NULL,
      pickup_time VARCHAR(100) NOT NULL COMMENT '自提时间描述',
      stock INT UNSIGNED NOT NULL DEFAULT 0,
      status TINYINT NOT NULL DEFAULT 1 COMMENT '1=进行中,2=已结束(手动关),3=已结束(到期)',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_leader (leader_id),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      order_no VARCHAR(32) NOT NULL UNIQUE,
      user_id INT UNSIGNED NOT NULL,
      group_buy_id INT UNSIGNED NOT NULL,
      quantity INT UNSIGNED NOT NULL DEFAULT 1,
      total_price DECIMAL(10,2) NOT NULL,
      remark VARCHAR(500) NOT NULL DEFAULT '' COMMENT '备注',
      status TINYINT NOT NULL DEFAULT 0 COMMENT '0=待付款,1=已付款,2=已自提,3=已取消',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_group_buy (group_buy_id),
      INDEX idx_status (status),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.end();
  console.log('Database and tables created successfully.');
}

initDatabase().catch((err) => {
  console.error('Init DB error:', err);
  process.exit(1);
});
