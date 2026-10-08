const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const { protect, optionalAuth } = require('../middleware/auth');
const { reportCreateLimiter } = require('../middleware/rateLimiters');
const {
  createLostItem,
  createFoundItem,
  listItems,
  myItems,
  getItem,
  updateItemStatus,
  deleteItem,
} = require('../controllers/itemController');

router.get('/', listItems); // publico: buscar/consultar coincidencias
router.get('/mine', protect, myItems);
router.get('/:id', optionalAuth, getItem);

router.post('/perdido', protect, reportCreateLimiter, upload.uploadImage, createLostItem);
router.post('/encontrado', protect, reportCreateLimiter, upload.uploadImage, createFoundItem);

router.put('/:id/status', protect, updateItemStatus);
router.delete('/:id', protect, deleteItem);

module.exports = router;