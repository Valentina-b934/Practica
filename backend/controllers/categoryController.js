const asyncHandler = require('express-async-handler');
const Category = require('../models/Category');
const { cleanString, isValidObjectId } = require('../utils/validators');
const { PET_NAME_PATTERN } = require('../config/categories');

/**
 * Solo campos conocidos. El icono debe ser una clase de bootstrap-icons
 * (bi-xxx): se valida porque se inserta en el HTML del frontend.
 * No se permite (re)crear una categoria de mascotas/animales: el sistema
 * trabaja unicamente con objetos.
 */
function pickCategoryFields(body, res) {
  const data = {};
  if (body.name !== undefined) {
    data.name = cleanString(body.name, 60);
    if (data.name.length < 3) {
      res.status(400);
      throw new Error('El nombre de la categoría es demasiado corto.');
    }
    if (PET_NAME_PATTERN.test(data.name)) {
      res.status(400);
      throw new Error('El sistema solo gestiona objetos: no se permiten categorías de mascotas o animales.');
    }
  }
  if (body.icon !== undefined) {
    const icon = cleanString(body.icon, 40) || 'bi-box-seam';
    if (!/^bi-[a-z0-9-]+$/.test(icon)) {
      res.status(400);
      throw new Error('El icono debe ser una clase de bootstrap-icons, por ejemplo bi-wallet2.');
    }
    data.icon = icon;
  }
  if (typeof body.active === 'boolean') data.active = body.active;
  return data;
}

const listCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ active: true }).sort('name');
  res.json(categories);
});

const createCategory = asyncHandler(async (req, res) => {
  const category = await Category.create(pickCategoryFields(req.body, res));
  res.status(201).json(category);
});

const updateCategory = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    res.status(404);
    throw new Error('Categoría no encontrada');
  }
  const category = await Category.findByIdAndUpdate(req.params.id, pickCategoryFields(req.body, res), { new: true, runValidators: true });
  if (!category) {
    res.status(404);
    throw new Error('Categoría no encontrada');
  }
  res.json(category);
});

const deleteCategory = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    res.status(404);
    throw new Error('Categoría no encontrada');
  }
  await Category.findByIdAndUpdate(req.params.id, { active: false });
  res.json({ message: 'Categoria desactivada' });
});

module.exports = { listCategories, createCategory, updateCategory, deleteCategory };