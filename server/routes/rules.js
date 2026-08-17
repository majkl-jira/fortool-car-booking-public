const { Router } = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getRules, publishRules } = require('../controllers/rulesController');

const router = Router();

router.get('/', authenticate, getRules);
router.post('/', authenticate, requireAdmin, publishRules);

module.exports = router;
