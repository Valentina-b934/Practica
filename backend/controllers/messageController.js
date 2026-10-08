const asyncHandler = require('express-async-handler');
const Match = require('../models/Match');
const Item = require('../models/Item');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const { isValidObjectId, cleanString } = require('../utils/validators');
const { isChatEnabled, toPercent } = require('../utils/matchRules');
const { detectSensitiveData, describeFindings } = require('../utils/sensitiveData');
const { shortName } = require('./itemController');

/**
 * ================================================================
 * MENSAJERIA INTERNA ENTRE LAS PERSONAS DE UNA COINCIDENCIA
 * ================================================================
 * Reglas:
 *  - La conversacion esta ANCLADA a una coincidencia (Match): una sola
 *    conversacion por par perdido/encontrado, nunca conversaciones libres
 *    entre usuarios cualesquiera.
 *  - Solo pueden leer/escribir las dos personas involucradas (dueño del
 *    reporte perdido y dueño del encontrado). Ni otros usuarios, ni
 *    cambiando el id en la URL.
 *  - Se habilita cuando la IA genera una coincidencia VALIDA (> 70 %) y
 *    ninguna de las partes la ha rechazado. Al rechazarla, se cierra.
 *
 * Anti-spam / abuso:
 *  - Limite por usuario: 15 mensajes por minuto (middleware messageLimiter).
 *  - Longitud de 1 a 1000 caracteres y limpieza de caracteres invisibles.
 *  - No se permite repetir el mismo mensaje en menos de 1 minuto.
 *  - Maximo 10 mensajes seguidos sin respuesta de la otra persona.
 *  - Una sola notificacion de "nuevo mensaje" pendiente por conversacion
 *    (no se inunda la bandeja de la otra persona).
 *  - Deteccion de datos sensibles (telefono, correo, direccion, documento,
 *    tarjeta...): se advierte y se pide confirmacion; los numeros de
 *    tarjeta se bloquean.
 * ================================================================
 */
const MAX_MESSAGE_LENGTH = 1000;
const MAX_UNANSWERED = parseInt(process.env.CHAT_MAX_UNANSWERED || '10', 10);
const DUPLICATE_WINDOW_MS = 60 * 1000;

/**
 * Carga el match y valida que:
 *  1) exista y sus dos reportes sigan existiendo,
 *  2) el usuario autenticado sea una de las dos personas involucradas,
 *  3) la coincidencia sea valida (> 70 %) y no haya sido rechazada.
 * Devuelve { match, otherUserId } o lanza un error HTTP apropiado.
 */
async function loadAuthorizedMatch(res, matchId, currentUserId) {
  const match = isValidObjectId(matchId) ? await Match.findById(matchId).populate('lostItem foundItem') : null;
  if (!match || !match.lostItem || !match.foundItem) {
    res.status(404);
    throw new Error('Coincidencia no encontrada');
  }

  const lostUserId = String(match.lostItem.user);
  const foundUserId = String(match.foundItem.user);
  const uid = String(currentUserId);

  if (uid !== lostUserId && uid !== foundUserId) {
    res.status(403);
    throw new Error('No tienes permiso para acceder a esta conversacion');
  }

  if (match.status === 'rechazada') {
    res.status(403);
    throw new Error('Esta coincidencia fue rechazada, el chat ya no esta disponible');
  }

  if (!isChatEnabled(match)) {
    res.status(403);
    throw new Error('El chat solo se habilita para coincidencias con más del 70 % de similitud.');
  }

  const otherUserId = uid === lostUserId ? foundUserId : lostUserId;
  return { match, otherUserId };
}

// @route GET /api/messages/conversations
// Lista todas las conversaciones habilitadas para el usuario actual (una por
// cada coincidencia valida en la que participa), con el ultimo mensaje y el
// conteo de mensajes no leidos.
const getConversations = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const uid = String(userId);

  // Se parte de MIS reportes (consulta acotada) en vez de recorrer todas
  // las coincidencias del sistema y filtrarlas en memoria.
  const myItemIds = (await Item.find({ user: userId }).select('_id')).map((i) => i._id);

  const matches = await Match.find({
    status: { $ne: 'rechazada' },
    $or: [{ lostItem: { $in: myItemIds } }, { foundItem: { $in: myItemIds } }],
  })
    .populate({ path: 'lostItem', select: 'title type imageUrl user', populate: { path: 'user', select: 'name' } })
    .populate({ path: 'foundItem', select: 'title type imageUrl user', populate: { path: 'user', select: 'name' } })
    .sort('-updatedAt');

  const myMatches = matches.filter((m) => m.lostItem?.user && m.foundItem?.user && isChatEnabled(m));

  const conversations = await Promise.all(
    myMatches.map(async (m) => {
      const isLostOwner = String(m.lostItem.user._id) === uid;
      const otherUser = isLostOwner ? m.foundItem.user : m.lostItem.user;
      const myItem = isLostOwner ? m.lostItem : m.foundItem;
      const otherItem = isLostOwner ? m.foundItem : m.lostItem;

      const lastMessage = await Message.findOne({ match: m._id }).sort('-createdAt');
      const unreadCount = await Message.countDocuments({ match: m._id, recipient: userId, read: false });

      return {
        matchId: m._id,
        score: m.score,
        percent: toPercent(m.score),
        status: m.status,
        myItem: { _id: myItem._id, title: myItem.title, type: myItem.type, imageUrl: myItem.imageUrl },
        otherItem: { _id: otherItem._id, title: otherItem.title, type: otherItem.type, imageUrl: otherItem.imageUrl },
        otherUser: { _id: otherUser._id, name: shortName(otherUser.name) },
        lastMessage: lastMessage ? { content: lastMessage.content, createdAt: lastMessage.createdAt, sender: lastMessage.sender } : null,
        unreadCount,
      };
    })
  );

  conversations.sort((a, b) => {
    const at = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const bt = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return bt - at;
  });

  res.json(conversations);
});

// @route GET /api/messages/:matchId
const getMessages = asyncHandler(async (req, res) => {
  const { match } = await loadAuthorizedMatch(res, req.params.matchId, req.user._id);

  const messages = await Message.find({ match: match._id }).sort('createdAt').limit(500);

  // Marca como leidos los mensajes dirigidos al usuario actual
  await Message.updateMany(
    { match: match._id, recipient: req.user._id, read: false },
    { read: true }
  );
  await Notification.updateMany(
    { user: req.user._id, relatedMatch: match._id, type: 'mensaje', read: false },
    { read: true }
  );

  res.json({
    match: {
      _id: match._id,
      score: match.score,
      percent: toPercent(match.score),
      status: match.status,
      lostItem: { _id: match.lostItem._id, title: match.lostItem.title, user: match.lostItem.user },
      foundItem: { _id: match.foundItem._id, title: match.foundItem.title, user: match.foundItem.user },
    },
    messages,
  });
});

// @route POST /api/messages/:matchId  { content, confirmSensitive? }
const sendMessage = asyncHandler(async (req, res) => {
  const content = cleanString(req.body.content, MAX_MESSAGE_LENGTH + 1);
  if (!content) {
    res.status(400);
    throw new Error('El mensaje no puede estar vacio');
  }
  if (content.length > MAX_MESSAGE_LENGTH) {
    res.status(400);
    throw new Error(`El mensaje no puede superar ${MAX_MESSAGE_LENGTH} caracteres.`);
  }

  const { match, otherUserId } = await loadAuthorizedMatch(res, req.params.matchId, req.user._id);

  // --- Datos personales sensibles ---
  const findings = detectSensitiveData(content);
  if (findings.some((f) => f.severity === 'block')) {
    res.status(422);
    const e = new Error('Por tu seguridad no se permite enviar números de tarjeta por el chat.');
    e.code = 'SENSITIVE_DATA_BLOCKED';
    e.findings = findings;
    throw e;
  }
  if (findings.length && req.body.confirmSensitive !== true) {
    res.status(422);
    const e = new Error(
      `Tu mensaje parece incluir datos personales (${describeFindings(findings)}). ` +
        'No es necesario compartirlos: puedes coordinar la entrega por este chat. ¿Deseas enviarlo de todas formas?'
    );
    e.code = 'SENSITIVE_DATA_WARNING';
    e.findings = findings;
    throw e;
  }

  // --- Anti-spam dentro de la conversacion ---
  const recent = await Message.find({ match: match._id }).sort('-createdAt').limit(MAX_UNANSWERED);
  const duplicate = recent.find(
    (m) => String(m.sender) === String(req.user._id) &&
      m.content === content &&
      Date.now() - m.createdAt.getTime() < DUPLICATE_WINDOW_MS
  );
  if (duplicate) {
    res.status(429);
    throw new Error('Ya enviaste ese mismo mensaje hace un momento.');
  }
  if (recent.length >= MAX_UNANSWERED && recent.every((m) => String(m.sender) === String(req.user._id))) {
    res.status(429);
    throw new Error('Enviaste varios mensajes seguidos sin respuesta. Espera a que la otra persona responda.');
  }

  const message = await Message.create({
    match: match._id,
    sender: req.user._id,
    recipient: otherUserId,
    content,
  });

  // Una sola notificacion pendiente por conversacion (evita inundar al otro)
  const pendingNotification = await Notification.exists({
    user: otherUserId,
    relatedMatch: match._id,
    type: 'mensaje',
    read: false,
  });
  if (!pendingNotification) {
    await Notification.create({
      user: otherUserId,
      type: 'mensaje',
      title: 'Nuevo mensaje',
      message: `${shortName(req.user.name)} te envio un mensaje sobre la coincidencia de "${match.lostItem.title}".`,
      relatedItem: match.lostItem._id,
      relatedMatch: match._id,
    });
  }

  res.status(201).json(message);
});

module.exports = { getConversations, getMessages, sendMessage };