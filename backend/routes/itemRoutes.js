const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const { protect } = require('../middleware/auth');
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
router.get('/:id', getItem);

router.post('/perdido', protect, upload.uploadImage, createLostItem);
router.post('/encontrado', protect, upload.uploadImage, createFoundItem);

router.put('/:id/status', protect, updateItemStatus);
router.delete('/:id', protect, deleteItem);

module.exports = router;
