const fs = require('fs');
const path = require('path');
const asyncHandler = require('express-async-handler');
const Item = require('../models/Item');
const Match = require('../models/Match');
const City = require('../models/City');
const { buildTextVector } = require('../services/textAnalysis');
const { computeImageHash, computeColorProfile } = require('../services/imageAnalysis');
const { findMatchesForItem } = require('../services/aiMatching');

/**
 * Crea un reporte (perdido o encontrado). Comparte logica porque
 * el flujo de IA es identico para ambos tipos.
 */
const createItem = (type) =>
  asyncHandler(async (req, res) => {
    const { title, description, color, brand, place, date, city, category } = req.body;

    // La fotografia es OBLIGATORIA: el motor de IA usa la imagen (hash
    // perceptual + perfil de color) como una de sus 6 caracteristicas de
    // comparacion, y el portal se basa en identificacion visual. Se valida
    // aqui tambien en el backend (no solo en el formulario) porque el
    // frontend nunca es una fuente confiable de validacion por si sola:
    // cualquiera podria llamar a este endpoint directamente sin pasar
    // por el formulario.
    if (!req.file) {
      res.status(400);
      throw new Error('La fotografía del objeto es obligatoria para crear un reporte.');
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    const buffer = fs.readFileSync(req.file.path);
    const imageHash = await computeImageHash(buffer);
    const imageColorProfile = await computeColorProfile(buffer);

    if (!imageHash) {
      // La imagen se subio pero no se pudo procesar (archivo corrupto,
      // formato no soportado por sharp, etc.): no dejamos crear el reporte
      // sin huella visual, porque rompería silenciosamente el matching.
      fs.existsSync(req.file.path) && fs.unlinkSync(req.file.path);
      res.status(400);
      throw new Error('No se pudo procesar la fotografía. Intenta con otra imagen JPG, PNG o WEBP.');
    }

    const item = new Item({
      type,
      user: req.user._id,
      institution: req.user.institution || req.body.institution || null,
      city,
      category,
      title,
      description,
      color,
      brand,
      place,
      date,
      imageUrl,
      imageHash,
      imageColorProfile,
    });

    // Vector de texto generado por IA (PLN)
    item.textVector = buildTextVector(item);

    await item.save();

    // Dispara el motor de coincidencias en segundo plano logico (await para MVP)
    const matches = await findMatchesForItem(item);

    res.status(201).json({
      item,
      matchesFound: matches.length,
    });
  });

const createLostItem = createItem('perdido');
const createFoundItem = createItem('encontrado');

// @route GET /api/items?city=&department=&category=&type=&q=
const listItems = asyncHandler(async (req, res) => {
  const { city, department, category, type, q, status } = req.query;
  const filter = { 'moderation.status': 'aprobado' };

  if (city) {
    filter.city = city;
  } else if (department) {
    // Sin ciudad especifica pero con departamento: buscamos todas las
    // ciudades de ese departamento y filtramos por cualquiera de ellas.
    const citiesInDept = await City.find({ department }).select('_id');
    filter.city = { $in: citiesInDept.map((c) => c._id) };
  }

  if (category) filter.category = category;
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (q) filter.$or = [
    { title: { $regex: q, $options: 'i' } },
    { description: { $regex: q, $options: 'i' } },
  ];

  const items = await Item.find(filter)
    .populate('city category user institution', '-password')
    .sort('-createdAt')
    .limit(100);

  res.json(items);
});

// @route GET /api/items/mine
const myItems = asyncHandler(async (req, res) => {
  const items = await Item.find({ user: req.user._id })
    .populate('city category institution')
    .sort('-createdAt');
  res.json(items);
});

// @route GET /api/items/:id
const getItem = asyncHandler(async (req, res) => {
  const item = await Item.findById(req.params.id).populate('city category institution').populate('user', '-password');
  if (!item) {
    res.status(404);
    throw new Error('Reporte no encontrado');
  }
  res.json(item);
});

// @route PUT /api/items/:id/status  (dueño, institucion o admin)
const updateItemStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const item = await Item.findById(req.params.id);
  if (!item) {
    res.status(404);
    throw new Error('Reporte no encontrado');
  }

  const isOwner = String(item.user) === String(req.user._id);
  const isInstitutionStaff =
    req.user.role === 'institucion' && String(item.institution) === String(req.user.institution);
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isInstitutionStaff && !isAdmin) {
    res.status(403);
    throw new Error('No tienes permisos para modificar este reporte');
  }

  item.status = status;
  await item.save();
  res.json(item);
});

// @route DELETE /api/items/:id
const deleteItem = asyncHandler(async (req, res) => {
  const item = await Item.findById(req.params.id);
  if (!item) {
    res.status(404);
    throw new Error('Reporte no encontrado');
  }
  const isOwner = String(item.user) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin') {
    res.status(403);
    throw new Error('No tienes permisos para eliminar este reporte');
  }

  if (item.imageUrl) {
    const filePath = path.join(__dirname, '..', item.imageUrl);
    fs.existsSync(filePath) && fs.unlinkSync(filePath);
  }

  await Match.deleteMany({ $or: [{ lostItem: item._id }, { foundItem: item._id }] });
  await item.deleteOne();
  res.json({ message: 'Reporte eliminado' });
});

module.exports = {
  createLostItem,
  createFoundItem,
  listItems,
  myItems,
  getItem,
  updateItemStatus,
  deleteItem,
};
