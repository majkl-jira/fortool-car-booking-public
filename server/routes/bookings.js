const { Router } = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const {
  getAllBookings,
  getMyBookings,
  createBooking,
  updateBooking,
  deleteBooking,
} = require('../controllers/bookingController');

const router = Router();

// Rate limiter per uživatel (keyGenerator vyžaduje aby authenticate běžel dřív)
const createBookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hodina
  max: 10,
  skip: (req) => req.user?.isAdmin === true,
  keyGenerator: (req) => {
    if (req.user?.id) return `user:${req.user.id}`;
    return ipKeyGenerator(req.ip);
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Příliš mnoho rezervací. Maximálně 10 za hodinu.' },
});

router.get('/', authenticate, getAllBookings);
router.get('/mine', authenticate, getMyBookings);
router.post('/', authenticate, createBookingLimiter, createBooking);
router.put('/:id', authenticate, updateBooking);
router.delete('/:id', authenticate, deleteBooking);

module.exports = router;
