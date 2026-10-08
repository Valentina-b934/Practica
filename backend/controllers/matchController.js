const asyncHandler = require('express-async-handler');
const Match = require('../models/Match');
const Item = require('../models/Item');
const Notification = require('../models/Notification');
const { isValidObjectId } = require('../utils/validators');
const { isValidMatchScore, isChatEnabled, toPercent } = require('../utils/matchRules');
const { shortName } = require('./itemController');

// Solo el nombre del otro usuario: nunca su correo ni su telefono
const ITEM_POPULATE = (path) => ({
  path,
  select: '-textVector -imageHash -imageColorProfile',
  populate: ['city', 'category', { path: 'user', select: 'name' }],
});

function serializeMatch(match) {
  const obj = match.toObject();
  for (const key of ['lostItem', 'foundItem']) {
    if (obj[key]?.user && typeof obj[key].user === 'object') {
      obj[key].user = { _id: obj[key].user._id, name: shortName(obj[key].user.name) };
    }
    if (obj[key]) delete obj[key].moderation;
  }
  obj.percent = toPercent(match.score);
  obj.chatAvailable = isChatEnabled(match);
  return obj;
}

async function loadMatch(req, res) {
  const match = isValidObjectId(req.params.id) ? await Match.findById(req.params.id).populate('lostItem foundItem') : null;
  if (!match || !match.lostItem || !match.foundItem) {
    res.status(404);
    throw new Error('Coincidencia no encontrada');
  }
  return match;
}

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
 * Visibilidad:
 *   - El dueño del reporte, un administrador, o el personal de la
 *     institucion asociada al reporte -> ven TODAS las coincidencias
 *     validas sugeridas para ese reporte.
 *   - Cualquier otro usuario -> solo las coincidencias en las que EL MISMO
 *     participa como dueño del objeto contrario. Nunca ve coincidencias de
 *     terceros con quienes no tiene ninguna relacion.
 *   - Si no aplica ninguno de los casos anteriores, se responde 403.
 *
 * Solo se devuelven coincidencias VALIDAS (> 70 %). Las que existieran en
 * la base de datos con un porcentaje menor o igual (por ejemplo, creadas
 * con un umbral antiguo) no se muestran a los usuarios.
 */
const getMatchesForItem = asyncHandler(async (req, res) => {
  const item = isValidObjectId(req.params.itemId) ? await Item.findById(req.params.itemId) : null;
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
    $or: [{ lostItem: item._id }, { foundItem: item._id }],
  })
    .populate(ITEM_POPULATE('lostItem'))
    .populate(ITEM_POPULATE('foundItem'))
    .sort('-score');

  matches = matches.filter((m) => m.lostItem && m.foundItem && isValidMatchScore(m.score));

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

  res.json(matches.map(serializeMatch));
});

// @route POST /api/matches/:id/confirm  -> el usuario confirma que SI es su objeto
const confirmMatch = asyncHandler(async (req, res) => {
  const match = await loadMatch(req, res);
  assertUserIsInvolved(req, res, match);

  if (!isValidMatchScore(match.score)) {
    res.status(400);
    throw new Error('Esta coincidencia no supera el 70 % de similitud y no puede confirmarse.');
  }

  match.status = 'confirmada_usuario';
  await match.save();

  await Item.findByIdAndUpdate(match.lostItem._id, { status: 'en_proceso' });
  await Item.findByIdAndUpdate(match.foundItem._id, { status: 'en_proceso' });

  res.json({ message: 'Coincidencia confirmada. Inicia el proceso de recuperacion.', match: { _id: match._id, status: match.status } });
});

// @route POST /api/matches/:id/reject  -> al rechazarla, el chat se cierra
const rejectMatch = asyncHandler(async (req, res) => {
  const match = await loadMatch(req, res);
  assertUserIsInvolved(req, res, match);
  match.status = 'rechazada';
  await match.save();
  res.json({ message: 'Coincidencia rechazada', match: { _id: match._id, status: match.status } });
});

// @route POST /api/matches/:id/validate -> la institucion valida la entrega fisica
/**
 * BUG DE AUTORIZACION CORREGIDO: antes CUALQUIER cuenta con rol
 * "institucion" podia marcar como recuperado un objeto de OTRA institucion
 * (o sin institucion) solo conociendo el id de la coincidencia. Ahora solo
 * puede hacerlo el personal de la institucion asociada a alguno de los dos
 * reportes, o un administrador.
 */
const validateMatchByInstitution = asyncHandler(async (req, res) => {
  const match = await loadMatch(req, res);

  if (req.user.role !== 'admin') {
    const myInstitution = String(req.user.institution || '');
    const related = [match.lostItem.institution, match.foundItem.institution].filter(Boolean).map(String);
    if (!myInstitution || !related.includes(myInstitution)) {
      res.status(403);
      throw new Error('Solo la institución asociada a este objeto puede validar la entrega.');
    }
  }
  if (match.status === 'rechazada' || !isValidMatchScore(match.score)) {
    res.status(400);
    throw new Error('No se puede validar la entrega de una coincidencia rechazada o no válida.');
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

  res.json({ message: 'Entrega validada, objeto marcado como recuperado', match: { _id: match._id, status: match.status } });
});

module.exports = { getMatchesForItem, confirmMatch, rejectMatch, validateMatchByInstitution };