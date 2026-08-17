const { Router } = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  getVehicles,
  getVehiclesAdmin,
  getVehicle,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  getFutureBookings,
  cancelFutureBookings,
} = require('../controllers/vehicleController');

const router = Router();

router.get('/', getVehicles);
// před '/:id', jinak by „admin" spolkl parametr id
router.get('/admin', authenticate, requireAdmin, getVehiclesAdmin);
router.get('/:id', getVehicle);
router.get('/:id/bookings/future', authenticate, requireAdmin, getFutureBookings);
router.post('/:id/bookings/cancel-future', authenticate, requireAdmin, cancelFutureBookings);
router.post('/', authenticate, requireAdmin, createVehicle);
router.put('/:id', authenticate, requireAdmin, updateVehicle);
router.delete('/:id', authenticate, requireAdmin, deleteVehicle);

module.exports = router;
