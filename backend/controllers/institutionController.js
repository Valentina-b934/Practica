const asyncHandler = require('express-async-handler');
const Institution = require('../models/Institution');
const Item = require('../models/Item');
const Match = require('../models/Match');

// @route GET /api/institutions
const listInstitutions = asyncHandler(async (req, res) => {
  const institutions = await Institution.find({ active: true }).populate('city');
  res.json(institutions);
});

// @route POST /api/institutions  (admin)
const createInstitution = asyncHandler(async (req, res) => {
  const institution = await Institution.create(req.body);
  res.status(201).json(institution);
});

// @route PUT /api/institutions/:id (admin o la propia institucion)
const updateInstitution = asyncHandler(async (req, res) => {
  const institution = await Institution.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(institution);
});

// @route GET /api/institutions/:id/items -> reportes de la sede
const institutionItems = asyncHandler(async (req, res) => {
  const items = await Item.find({ institution: req.params.id })
    .populate('city category')
    .populate('user', '-password')
    .sort('-createdAt');
  res.json(items);
});

// @route GET /api/institutions/:id/stats -> estadisticas de la sede
const institutionStats = asyncHandler(async (req, res) => {
  const institutionId = req.params.id;

  const [total, perdidos, encontrados, recuperados, enProceso] = await Promise.all([
    Item.countDocuments({ institution: institutionId }),
    Item.countDocuments({ institution: institutionId, type: 'perdido' }),
    Item.countDocuments({ institution: institutionId, type: 'encontrado' }),
    Item.countDocuments({ institution: institutionId, status: 'recuperado' }),
    Item.countDocuments({ institution: institutionId, status: 'en_proceso' }),
  ]);

  res.json({ total, perdidos, encontrados, recuperados, enProceso });
});

module.exports = {
  listInstitutions,
  createInstitution,
  updateInstitution,
  institutionItems,
  institutionStats,
};
