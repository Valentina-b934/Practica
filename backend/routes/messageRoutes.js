const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getConversations, getMessages, sendMessage } = require('../controllers/messageController');

router.get('/conversations', protect, getConversations);
router.get('/:matchId', protect, getMessages);
router.post('/:matchId', protect, sendMessage);

module.exports = router;
