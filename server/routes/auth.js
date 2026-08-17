const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const { register, login, forgotPassword, resetPassword, changePassword, acceptRules } = require('../controllers/authController');

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minut; per IP — kancelář za NAT sdílí rozpočet
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Příliš mnoho požadavků. Zkuste to znovu za 15 minut.' },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hodina; per IP — kancelář za NAT sdílí rozpočet
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Příliš mnoho pokusů o reset hesla. Zkuste to znovu za hodinu.' },
});

const changePwLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Příliš mnoho pokusů o změnu hesla. Zkuste to znovu za hodinu.' },
});

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.post('/change-password', authenticate, changePwLimiter, changePassword);
router.post('/accept-rules', authenticate, acceptRules);

module.exports = router;
