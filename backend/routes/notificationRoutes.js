const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { myNotifications, markAsRead } = require('../controllers/notificationController');

router.get('/', protect, myNotifications);
router.put('/:id/read', protect, markAsRead);

module.exports = router;
