const asyncHandler = require('express-async-handler');
const Category = require('../models/Category');

const listCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ active: true }).sort('name');
  res.json(categories);
});

const createCategory = asyncHandler(async (req, res) => {
  const category = await Category.create(req.body);
  res.status(201).json(category);
});

const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(category);
});

const deleteCategory = asyncHandler(async (req, res) => {
  await Category.findByIdAndUpdate(req.params.id, { active: false });
  res.json({ message: 'Categoria desactivada' });
});

module.exports = { listCategories, createCategory, updateCategory, deleteCategory };
