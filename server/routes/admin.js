const { Router } = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getPendingRegistrations, getRejectedRegistrations, approveRegistration, rejectRegistration } = require('../controllers/adminController');

const router = Router();

router.get('/registrations/pending',        authenticate, requireAdmin, getPendingRegistrations);
router.get('/registrations/rejected',       authenticate, requireAdmin, getRejectedRegistrations);
router.post('/registrations/:id/approve',   authenticate, requireAdmin, approveRegistration);
router.post('/registrations/:id/reject',    authenticate, requireAdmin, rejectRegistration);

module.exports = router;
