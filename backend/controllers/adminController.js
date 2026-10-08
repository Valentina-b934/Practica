const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Item = require('../models/Item');
const Institution = require('../models/Institution');
const City = require('../models/City');
const Match = require('../models/Match');
const { rescanAllMatches } = require('../services/aiMatching');
const { isValidObjectId, cleanString } = require('../utils/validators');

const ROLES = ['usuario', 'institucion', 'admin'];
const MODERATION_STATUSES = ['pendiente', 'aprobado', 'rechazado'];

// @route GET /api/admin/users
const listUsers = asyncHandler(async (req, res) => {
  const users = await User.find().select('-password').populate('city institution').sort('-createdAt');
  res.json(users);
});

// @route PUT /api/admin/users/:id  -> activar/desactivar o cambiar rol
// Se valida el rol (antes se guardaba cualquier texto) y un administrador
// no puede desactivarse ni quitarse el rol a si mismo (evita quedarse sin
// ningun administrador por error).
const updateUser = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    res.status(404);
    throw new Error('Usuario no encontrado');
  }
  const { active, role } = req.body;
  const update = {};
  if (typeof active === 'boolean') update.active = active;
  if (role !== undefined) {
    if (!ROLES.includes(role)) {
      res.status(400);
      throw new Error('Rol no válido');
    }
    update.role = role;
  }

  if (String(req.params.id) === String(req.user._id) && (update.active === false || (update.role && update.role !== 'admin'))) {
    res.status(400);
    throw new Error('No puedes desactivar ni cambiar el rol de tu propia cuenta de administrador.');
  }

  const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).select('-password');
  if (!user) {
    res.status(404);
    throw new Error('Usuario no encontrado');
  }
  res.json(user);
});

// @route GET /api/admin/stats -> panel general del sistema
const globalStats = asyncHandler(async (req, res) => {
  const [
    totalUsers,
    totalInstitutions,
    totalCities,
    totalItems,
    totalLost,
    totalFound,
    totalRecovered,
    totalMatches,
    pendingModeration,
  ] = await Promise.all([
    User.countDocuments(),
    Institution.countDocuments(),
    City.countDocuments(),
    Item.countDocuments(),
    Item.countDocuments({ type: 'perdido' }),
    Item.countDocuments({ type: 'encontrado' }),
    Item.countDocuments({ status: 'recuperado' }),
    Match.countDocuments(),
    Item.countDocuments({ 'moderation.status': 'pendiente' }),
  ]);

  // Reportes por ciudad, para comparar entre ciudades de Colombia
  const byCity = await Item.aggregate([
    { $group: { _id: '$city', total: { $sum: 1 } } },
    { $lookup: { from: 'cities', localField: '_id', foreignField: '_id', as: 'city' } },
    { $unwind: '$city' },
    { $project: { _id: 0, city: '$city.name', total: 1 } },
    { $sort: { total: -1 } },
  ]);

  res.json({
    totalUsers,
    totalInstitutions,
    totalCities,
    totalItems,
    totalLost,
    totalFound,
    totalRecovered,
    totalMatches,
    pendingModeration,
    byCity,
  });
});

// @route GET /api/admin/moderation -> reportes pendientes de moderar
const pendingItems = asyncHandler(async (req, res) => {
  const items = await Item.find({ 'moderation.status': 'pendiente' })
    .select('-textVector -imageHash -imageColorProfile')
    .populate('city category')
    .populate('user', 'name email')
    .sort('-createdAt');
  res.json(items);
});

// @route PUT /api/admin/moderation/:id -> aprobar/rechazar contenido
const moderateItem = asyncHandler(async (req, res) => {
  const { status } = req.body; // status: aprobado | rechazado | pendiente
  if (!MODERATION_STATUSES.includes(status)) {
    res.status(400);
    throw new Error('Estado de moderación no válido');
  }
  const reason = cleanString(req.body.reason, 300);
  const item = isValidObjectId(req.params.id)
    ? await Item.findByIdAndUpdate(
      req.params.id,
      { moderation: { status, reason, reviewedBy: req.user._id } },
      { new: true }
    ).select('-textVector -imageHash -imageColorProfile')
    : null;
  if (!item) {
    res.status(404);
    throw new Error('Reporte no encontrado');
  }
  res.json(item);
});

// @route POST /api/admin/rescan-matches -> vuelve a evaluar TODOS los reportes con el algoritmo actual
const rescanMatches = asyncHandler(async (req, res) => {
  const result = await rescanAllMatches();
  res.json({ message: 'Reescaneo completado', ...result });
});

module.exports = { listUsers, updateUser, globalStats, pendingItems, moderateItem, rescanMatches };