const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { EMAIL_PATTERN } = require('../middleware/validate');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { message: 'Too many login attempts. Try again later.' } },
});

router.post(
  '/login',
  loginLimiter,
  validateBody({
    email: { type: 'string', required: true, pattern: EMAIL_PATTERN, patternMessage: 'must be a valid email' },
    password: { type: 'string', required: true, minLength: 1 },
  }),
  c.login
);

router.post('/logout', c.logout);

router.get('/me', requireAuth, c.me);

router.patch(
  '/password',
  requireAuth,
  validateBody({
    current_password: { type: 'string', required: true, minLength: 1 },
    new_password: { type: 'string', required: true, minLength: 8, maxLength: 200 },
  }),
  c.changePassword
);

module.exports = router;
