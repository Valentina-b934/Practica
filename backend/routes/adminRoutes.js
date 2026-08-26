const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/roles');
const {
  listUsers,
  updateUser,
  globalStats,
  pendingItems,
  moderateItem,
  rescanMatches,
} = require('../controllers/adminController');

router.use(protect, authorize('admin'));

router.get('/users', listUsers);
router.put('/users/:id', updateUser);
router.get('/stats', globalStats);
router.get('/moderation', pendingItems);
router.put('/moderation/:id', moderateItem);
router.post('/rescan-matches', rescanMatches);

module.exports = router;
