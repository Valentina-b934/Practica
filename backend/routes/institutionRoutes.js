const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/roles');
const {
  listInstitutions,
  createInstitution,
  updateInstitution,
  institutionItems,
  institutionStats,
} = require('../controllers/institutionController');

router.get('/', listInstitutions);
router.post('/', protect, authorize('admin'), createInstitution);
router.put('/:id', protect, authorize('admin', 'institucion'), updateInstitution);
router.get('/:id/items', protect, authorize('institucion', 'admin'), institutionItems);
router.get('/:id/stats', protect, authorize('institucion', 'admin'), institutionStats);

module.exports = router;
