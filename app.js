require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { autoCancelExpired } = require('./controllers/orderController');
const userRoutes = require('./routes/userRoutes');
const groupBuyRoutes = require('./routes/groupBuyRoutes');
const orderRoutes = require('./routes/orderRoutes');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/user', userRoutes);
app.use('/api/group-buy', groupBuyRoutes);
app.use('/api/order', orderRoutes);

app.get('/api/health', (req, res) => {
  res.json({ code: 0, msg: 'ok', time: new Date().toISOString() });
});

cron.schedule('* * * * *', () => {
  autoCancelExpired().catch(() => {});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
