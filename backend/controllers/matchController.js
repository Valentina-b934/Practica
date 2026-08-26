const asyncHandler = require('express-async-handler');
const Match = require('../models/Match');
const Item = require('../models/Item');
const Notification = require('../models/Notification');

/**
 * BUG DE SEGURIDAD CORREGIDO:
 * `confirmMatch` y `rejectMatch` solo estaban protegidas por `protect`
 * (exigir estar logueado), pero no verificaban que el usuario autenticado
 * fuera una de las dos personas realmente involucradas en la coincidencia
 * (quien reporto el objeto perdido o quien reporto el encontrado). Eso
 * significa que CUALQUIER usuario logueado del sistema podia confirmar o
 * rechazar coincidencias ajenas conociendo (o adivinando) el id del
 * match, lo cual podia usarse para sabotear procesos de recuperacion de
 * otras personas o para forzar la apertura de un chat en el que no
 * deberia participar. Esta funcion centraliza esa validacion (igual que
 * ya se hacia correctamente en `messageController.loadAuthorizedMatch`).
 */
function assertUserIsInvolved(req, res, match) {
  const uid = String(req.user._id);
  const lostUserId = String(match.lostItem.user?._id || match.lostItem.user);
  const foundUserId = String(match.foundItem.user?._id || match.foundItem.user);
  const isAdmin = req.user.role === 'admin';

  if (uid !== lostUserId && uid !== foundUserId && !isAdmin) {
    res.status(403);
    throw new Error('No tienes permiso para confirmar o rechazar esta coincidencia');
  }
}

// @route GET /api/matches/item/:itemId  -> coincidencias sugeridas para un reporte
/**
 * BUG DE PRIVACIDAD CORREGIDO:
 * Este endpoint solo exigia `protect` (estar logueado), pero no
 * verificaba que el usuario tuviera alguna relacion con el reporte
 * consultado. Eso permitia que CUALQUIER usuario autenticado del
 * sistema consultara `/api/matches/item/:itemId` para el reporte de
 * OTRA persona (por ejemplo, abriendo el detalle de un reporte publico
 * ajeno) y viera el desglose completo de sus coincidencias de IA: foto,
 * descripcion, ciudad y porcentaje de similitud del objeto de la otra
 * parte involucrada, sin tener ninguna relacion con ese reporte.
 *
 * Ahora la visibilidad se limita asi:
 *   - El dueño del reporte, un administrador, o el personal de la
 *     institucion asociada al reporte -> ven TODAS las coincidencias
 *     sugeridas para ese reporte (comportamiento normal de "Mis
 *     reportes" / panel de institucion).
 *   - Cualquier otro usuario -> solo puede ver, de esa lista, las
 *     coincidencias en las que EL MISMO participa como dueño del objeto
 *     contrario (porque entro a este reporte desde una coincidencia que
 *     le fue notificada a el). Nunca ve coincidencias de terceros con
 *     quienes no tiene ninguna relacion.
 *   - Si no aplica ninguno de los casos anteriores, se responde 403.
 */
const getMatchesForItem = asyncHandler(async (req, res) => {
  const item = await Item.findById(req.params.itemId);
  if (!item) {
    res.status(404);
    throw new Error('Reporte no encontrado');
  }

  const uid = String(req.user._id);
  const isOwner = String(item.user) === uid;
  const isAdmin = req.user.role === 'admin';
  const isInstitutionStaff =
    req.user.role === 'institucion' &&
    item.institution &&
    String(item.institution) === String(req.user.institution);

  let matches = await Match.find({
    $or: [{ lostItem: req.params.itemId }, { foundItem: req.params.itemId }],
  })
    .populate({ path: 'lostItem', populate: ['city', 'category', { path: 'user', select: '-password' }] })
    .populate({ path: 'foundItem', populate: ['city', 'category', { path: 'user', select: '-password' }] })
    .sort('-score');

  if (!isOwner && !isAdmin && !isInstitutionStaff) {
    matches = matches.filter((m) => {
      const lostUserId = String(m.lostItem.user?._id || m.lostItem.user);
      const foundUserId = String(m.foundItem.user?._id || m.foundItem.user);
      return lostUserId === uid || foundUserId === uid;
    });

    if (matches.length === 0) {
      res.status(403);
      throw new Error('No tienes permiso para ver las coincidencias de este reporte');
    }
  }

  res.json(matches);
});

// @route POST /api/matches/:id/confirm  -> el usuario confirma que SI es su objeto
const confirmMatch = asyncHandler(async (req, res) => {
  const match = await Match.findById(req.params.id).populate('lostItem foundItem');
  if (!match) {
    res.status(404);
    throw new Error('Coincidencia no encontrada');
  }
  assertUserIsInvolved(req, res, match);

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
  assertUserIsInvolved(req, res, match);
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
