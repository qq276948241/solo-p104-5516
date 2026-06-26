# 社区生鲜团购系统 · 大白话说明

## 一、这系统是干啥的

小区里有个"团长"（一般是小区里开店的、或者热心邻居），每天在群里发个生鲜团购链接：

> "今天团草莓，原价 29.9，团购价 19.9，明天下午 4 点到小区便利店自提，只剩 50 份了！"

邻居们看到了就下单付钱，第二天去自提点拿货。整个流程就这么简单。

**技术栈**：Node.js + Express + MySQL，登录用 JWT。不搞微服务不搞消息队列，单项目跑起来就行。

---

## 二、三个模块挨个说

### 模块 1：用户（谁能干嘛）

**干啥用的**：区分"团长"和"邻居"。团长能发团购、看订单、导出表格；邻居只能浏览和下单。

**文件串起来的流程**：

```
请求进来
   ↓
[middleware/auth.js]  取 Authorization 头里的 Bearer token，解析出用户 id，查库把用户信息挂到 req.user 上
   ↓
[middleware/auth.js]  requireLeader 守卫：检查 role===1 且 role_approved===1，不是就拦
   ↓
[routes/userRoutes.js]  路由分发到具体方法
   ↓
[controllers/userController.js]  真正的业务逻辑
```

**关键字段**（在 `users` 表里）：

| 字段 | 意思 |
|------|------|
| `role=0` | 普通邻居 |
| `role=1` 但 `role_approved=0` | 申请了当团长，但还没被审核通过 |
| `role=1` 且 `role_approved=1` | 正式团长，能发团购 |

**核心方法**（都在 [userController.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/controllers/userController.js)）：

- `register` / `login`：注册登录，返回 JWT token
- `applyLeader`：用户点"我要当团长"，role 变 1，待审核
- `approveLeader` / `rejectLeader`：已有团长审核新团长（审核权在已通过的团长手里）

---

### 模块 2：团购（团长发的商品）

**干啥用的**：团长发单、改单、关单；邻居看有哪些团在开、哪些已经结束了。

**文件串起来的流程**：

```
请求 → [middleware/auth.js] → [routes/groupBuyRoutes.js] → [controllers/groupBuyController.js]
```

**关键状态**（在 `group_buys` 表里的 `status` 字段）：

| 状态值 | 意思 |
|--------|------|
| `status=1` | 进行中（邻居能下单） |
| `status=2` | 手动关掉了（团长主动关的） |
| `status=3` | 到期结束了 |

**关键规则**：

- 团长只能改**自己发的**、**进行中的**、**还没人下单**的团——改价格改库存都行，但一旦有人付了钱就不能动了
- 校验逻辑在 [validateGroupBuyFields](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/controllers/groupBuyController.js#L3-L31) 这个函数里，create 和 update 都调用它

**核心方法**（都在 [groupBuyController.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/controllers/groupBuyController.js)）：

- `create`：发新团
- `list`：邻居看列表，传 `?status=1` 看进行中，`?status=2` 看已结束
- `update`：改团（价格/库存/自提时间，用 SELECT FOR UPDATE 加行锁防并发）
- `close`：手动关团
- `listMine`：团长看自己发过的所有团

---

### 模块 3：订单（邻居买东西）

**干啥用的**：下单、付款、自提确认、超时自动取消、团长导出表格对账。

**文件串起来的流程**：

```
请求 → [middleware/auth.js] → [routes/orderRoutes.js] → [controllers/orderController.js]
```

**状态机**（在 `orders` 表里的 `status` 字段）：

```
待付款(0) ——付款成功→ 已付款(1) ——确认自提→ 已自提(2)
   ↓
15分钟没付钱 / 用户主动取消 → 已取消(3)
```

**防超卖（最关键的机制）**：

下单时在 [orderController.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/controllers/orderController.js) 的 `create` 方法里：

1. 开启事务
2. `SELECT ... FOR UPDATE` 把这行团购锁住，别人同时下单就得等
3. 检查库存够不够
4. `UPDATE group_buys SET stock = stock - ? WHERE id = ? AND stock >= ?` 原子扣减
5. 再查一遍库存确保不是负数（双重保险）
6. 插订单记录
7. 提交事务

**15分钟自动关单**：

[app.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/app.js#L24-L26) 里用 `node-cron` 每分钟跑一次 [autoCancelExpired](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/controllers/orderController.js#L231-L261)，把所有 `status=0 且 created_at < NOW()-15分钟` 的订单批量改成 `status=3`，同时把库存还回去。

**导出 CSV**：

团长调用 `/api/order/leader/export?date=2026-06-26`，会查当天所有属于他的团购的订单，生成带 BOM 头的 CSV（Excel 打开中文不乱码），字段包括：订单号、昵称、手机号、商品、数量、总价、备注、状态、下单时间。

---

## 三、完整流程文字图

从一个新用户注册到最后拿货，整条链路是这样的：

```
1. 用户注册
   POST /api/user/register
   → 存 users 表（role=0, role_approved=0）
   → 返回 token

2. （可选）申请团长
   POST /api/user/apply-leader
   → role 变 1，role_approved 还是 0（待审核）
   → 已有团长审核通过 PUT /api/user/approve-leader/:id
   → role_approved 变 1，正式团长

3. 团长发团购
   POST /api/group-buy
   → 存 group_buys 表（status=1, leader_id=当前用户）

4. 团长改团购（可选，仅限还没人下单时）
   PUT /api/group-buy/:id
   → SELECT FOR UPDATE 锁行 → 校验没订单 → UPDATE

5. 邻居浏览团购
   GET /api/group-buy?status=1
   → 看所有进行中的团

6. 邻居下单
   POST /api/order  { groupBuyId, quantity, remark }
   → 事务 + FOR UPDATE 锁团购行
   → 原子扣减库存
   → 插入 orders 表（status=0）
   → 返回订单号和总价，提醒 15 分钟内付款

7. 邻居付款
   PUT /api/order/:id/pay
   → 先检查有没有超时（15分钟）
   → 超时了就自动取消，库存还回去
   → 没超时就 status 变 1（已付款）

┌─────────────────────────────────────────┐
│ 【后台定时任务】每分钟跑一次              │
│ 扫所有 status=0 且创建超过 15 分钟的订单   │
│ 批量 status=3，库存 + 回去                │
└─────────────────────────────────────────┘

8. 第二天邻居去自提点拿货
   团长确认货给了 → 邻居点确认自提
   PUT /api/order/:id/pickup
   → status 变 2（已自提），交易完成

9. 团长晚上对账
   GET /api/order/leader/export?date=2026-06-26
   → 下载当天所有订单的 CSV 表格

10. 邻居查自己买过啥
    GET /api/order/my
    → 看历史订单
```

---

## 四、项目文件清单（按用途分）

| 类别 | 文件 | 干啥的 |
|------|------|--------|
| 入口 | [app.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/app.js) | 起服务、挂路由、启动定时任务 |
| 配置 | [.env](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/.env) | 数据库地址、JWT 密钥、端口 |
| 数据库 | [config/db.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/config/db.js) | MySQL 连接池 |
| 建表脚本 | [scripts/init-db.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/scripts/init-db.js) | 跑 `npm run init-db` 建库建表 |
| 鉴权中间件 | [middleware/auth.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/middleware/auth.js) | 解析 JWT、校验团长权限 |
| JWT 工具 | [utils/jwt.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/utils/jwt.js) | 生成/校验 token |
| 路由×3 | [routes/userRoutes.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/routes/userRoutes.js) | 用户模块路由 |
| | [routes/groupBuyRoutes.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/routes/groupBuyRoutes.js) | 团购模块路由 |
| | [routes/orderRoutes.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/routes/orderRoutes.js) | 订单模块路由 |
| 控制器×3 | [controllers/userController.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/controllers/userController.js) | 用户业务逻辑 |
| | [controllers/groupBuyController.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/controllers/groupBuyController.js) | 团购业务逻辑 |
| | [controllers/orderController.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo104/project104/controllers/orderController.js) | 订单业务逻辑 |

---

## 五、怎么跑起来

```bash
# 1. 装依赖
npm install

# 2. 改 .env 里的数据库密码

# 3. 建库建表
npm run init-db

# 4. 启动服务
npm start
# 监听 3000 端口
```

完事。
