const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const requestLogger = require('./middleware/requestLogger');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');
const { query } = require('./config/db');

const app = express();

app.disable('x-powered-by');
// Render (and most PaaS) terminate TLS in front of the app; trust their proxy
// so req.ip and secure cookies behave correctly.
app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(requestLogger);

// Liveness probe (kept outside the rate limiter so health checks never throttle).
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'healthflow-api', time: new Date().toISOString() });
});

// Readiness probe: verifies the database is reachable.
app.get('/api/ready', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ready', database: 'up' });
  } catch (err) {
    res.status(503).json({ status: 'unavailable', database: 'down' });
  }
});

const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_MAX) || 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { message: 'Too many requests. Please slow down.' } },
});

app.use('/api', apiLimiter);
app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
