require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

app.use(helmet());

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));

// DoS ochrana per IP. Kancelář za NAT sdílí jednu IP → limit musí unést
// celý tým najednou VČETNĚ pollingu (10 s tick = 2 req = 12 req/min/uživatel;
// 10 lidí ≈ 1800 req/15 min + interakce). V dev (StrictMode, HMR) se vypíná.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  skip: () => process.env.NODE_ENV !== 'production',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/rules', require('./routes/rules'));
// app.use('/api/users', require('./routes/users'));

app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || 500;
  res.status(status).json({
    message: status < 500 ? (err.message || 'Chyba požadavku.') : 'Interní chyba serveru.',
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
