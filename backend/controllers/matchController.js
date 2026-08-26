const asyncHandler = require('express-async-handler');
const Match = require('../models/Match');
const Item = require('../models/Item');
const Notification = require('../models/Notification');

// @route GET /api/matches/item/:itemId  -> coincidencias sugeridas para un reporte
const getMatchesForItem = asyncHandler(async (req, res) => {
  const matches = await Match.find({
    $or: [{ lostItem: req.params.itemId }, { foundItem: req.params.itemId }],
  })
    .populate({ path: 'lostItem', populate: ['city', 'category', { path: 'user', select: '-password' }] })
    .populate({ path: 'foundItem', populate: ['city', 'category', { path: 'user', select: '-password' }] })
    .sort('-score');

  res.json(matches);
});

/**
 * Verifica que el usuario autenticado sea el dueño del reporte "perdido"
 * o del reporte "encontrado" involucrados en el match (o admin).
 * SEGURIDAD: sin esta validacion, cualquier usuario logueado podia
 * confirmar o rechazar coincidencias entre otras dos personas -que ni
 * siquiera le pertenecian- y forzar el estado que habilita el chat
 * usuario-usuario, algo que rompe el modelo de seguridad del sistema.
 */
function assertUserIsPartOfMatch(req, res, match) {
  const uid = String(req.user._id);
  const isInvolved = uid === String(match.lostItem.user) || uid === String(match.foundItem.user);
  if (!isInvolved && req.user.role !== 'admin') {
    res.status(403);
    throw new Error('No tienes permiso para actuar sobre esta coincidencia');
  }
}

// @route POST /api/matches/:id/confirm  -> el usuario confirma que SI es su objeto
const confirmMatch = asyncHandler(async (req, res) => {
  const match = await Match.findById(req.params.id).populate('lostItem foundItem');
  if (!match) {
    res.status(404);
    throw new Error('Coincidencia no encontrada');
  }

  assertUserIsPartOfMatch(req, res, match);

  match.status = 'confirmada_usuario';
  await match.save();

  await Item.findByIdAndUpdate(match.lostItem._id, { status: 'en_proceso' });
  await Item.findByIdAndUpdate(match.foundItem._id, { status: 'en_proceso' });

  // Notifica a la institucion asociada (si existe) para validar la entrega
  if (match.foundItem.institution) {
    // Se podria buscar el usuario institucional; se deja como notificacion general
  }

  res.json({ message: 'Coincidencia confirmada. Inicia el proceso de recuperacion.', match });
});

// @route POST /api/matches/:id/reject
const rejectMatch = asyncHandler(async (req, res) => {
  const match = await Match.findById(req.params.id).populate('lostItem foundItem');
  if (!match) {
    res.status(404);
    throw new Error('Coincidencia no encontrada');
  }

  assertUserIsPartOfMatch(req, res, match);

  match.status = 'rechazada';
  await match.save();
  res.json({ message: 'Coincidencia rechazada', match });
});

// @route POST /api/matches/:id/validate -> la institucion valida la entrega fisica
const validateMatchByInstitution = asyncHandler(async (req, res) => {
  const match = await Match.findById(req.params.id).populate('lostItem foundItem');
  if (!match) {
    res.status(404);
    throw new Error('Coincidencia no encontrada');
  }

  match.status = 'validada_institucion';
  await match.save();

  await Item.findByIdAndUpdate(match.lostItem._id, { status: 'recuperado' });
  await Item.findByIdAndUpdate(match.foundItem._id, { status: 'recuperado' });

  await Notification.create({
    user: match.lostItem.user,
    type: 'recuperacion',
    title: 'Objeto recuperado',
    message: `Tu objeto "${match.lostItem.title}" fue marcado como recuperado. ¡Felicidades!`,
    relatedItem: match.foundItem._id,
    relatedMatch: match._id,
  });

  res.json({ message: 'Entrega validada, objeto marcado como recuperado', match });
});

module.exports = { getMatchesForItem, confirmMatch, rejectMatch, validateMatchByInstitution };
