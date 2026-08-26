const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/roles');
const {
  getMatchesForItem,
  confirmMatch,
  rejectMatch,
  validateMatchByInstitution,
} = require('../controllers/matchController');

router.get('/item/:itemId', protect, getMatchesForItem);
router.post('/:id/confirm', protect, confirmMatch);
router.post('/:id/reject', protect, rejectMatch);
router.post('/:id/validate', protect, authorize('institucion', 'admin'), validateMatchByInstitution);

module.exports = router;
