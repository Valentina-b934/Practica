const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/roles');
const { listCities, createCity, updateCity, deleteCity } = require('../controllers/cityController');

router.get('/', listCities);
router.post('/', protect, authorize('admin'), createCity);
router.put('/:id', protect, authorize('admin'), updateCity);
router.delete('/:id', protect, authorize('admin'), deleteCity);

module.exports = router;
