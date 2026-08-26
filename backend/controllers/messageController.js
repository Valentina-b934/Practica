const asyncHandler = require('express-async-handler');
const Match = require('../models/Match');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

/**
 * Estados del Match en los que SI se permite chatear. La conversacion se
 * habilita justo despues de que alguna de las partes verifica/confirma la
 * coincidencia sugerida por la IA (no antes, para evitar contacto sobre
 * coincidencias que la IA solo esta sugiriendo y nadie ha revisado, y no
 * despues de un rechazo).
 */
const CHAT_ENABLED_STATUSES = ['confirmada_usuario', 'validada_institucion'];

/**
 * Carga el match y valida que:
 *  1) exista,
 *  2) el usuario autenticado sea una de las dos personas involucradas
 *     (quien reporto el objeto perdido o quien reporto el encontrado),
 *  3) la coincidencia ya haya sido verificada/confirmada (no "sugerida"
 *     ni "rechazada").
 * Devuelve { match, otherUserId } o lanza un error HTTP apropiado.
 */
async function loadAuthorizedMatch(res, matchId, currentUserId) {
  const match = await Match.findById(matchId).populate('lostItem foundItem');
  if (!match) {
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

  if (!CHAT_ENABLED_STATUSES.includes(match.status)) {
    res.status(403);
    throw new Error(
      'Primero debes verificar/confirmar la coincidencia sugerida por la IA antes de poder chatear'
    );
  }

  const otherUserId = uid === lostUserId ? foundUserId : lostUserId;
  return { match, otherUserId };
}

// @route GET /api/messages/conversations
// Lista todas las conversaciones habilitadas para el usuario actual
// (una por Match verificado en el que participa), con el ultimo mensaje
// y el conteo de mensajes no leidos.
const getConversations = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const matches = await Match.find({ status: { $in: CHAT_ENABLED_STATUSES } })
    .populate({ path: 'lostItem', populate: ['city', 'category', { path: 'user', select: 'name email' }] })
    .populate({ path: 'foundItem', populate: ['city', 'category', { path: 'user', select: 'name email' }] })
    .sort('-updatedAt');

  const myMatches = matches.filter((m) => {
    const uid = String(userId);
    return String(m.lostItem.user._id) === uid || String(m.foundItem.user._id) === uid;
  });

  const conversations = await Promise.all(
    myMatches.map(async (m) => {
      const uid = String(userId);
      const isLostOwner = String(m.lostItem.user._id) === uid;
      const otherUser = isLostOwner ? m.foundItem.user : m.lostItem.user;
      const myItem = isLostOwner ? m.lostItem : m.foundItem;
      const otherItem = isLostOwner ? m.foundItem : m.lostItem;

      const lastMessage = await Message.findOne({ match: m._id }).sort('-createdAt');
      const unreadCount = await Message.countDocuments({ match: m._id, recipient: userId, read: false });

      return {
        matchId: m._id,
        score: m.score,
        status: m.status,
        myItem: { _id: myItem._id, title: myItem.title, type: myItem.type, imageUrl: myItem.imageUrl },
        otherItem: { _id: otherItem._id, title: otherItem.title, type: otherItem.type, imageUrl: otherItem.imageUrl },
        otherUser: { _id: otherUser._id, name: otherUser.name },
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

  const messages = await Message.find({ match: match._id }).sort('createdAt');

  // Marca como leidos los mensajes dirigidos al usuario actual
  await Message.updateMany(
    { match: match._id, recipient: req.user._id, read: false },
    { read: true }
  );

  res.json({
    match: {
      _id: match._id,
      score: match.score,
      status: match.status,
      lostItem: { _id: match.lostItem._id, title: match.lostItem.title, user: match.lostItem.user },
      foundItem: { _id: match.foundItem._id, title: match.foundItem.title, user: match.foundItem.user },
    },
    messages,
  });
});

// @route POST /api/messages/:matchId  { content }
const sendMessage = asyncHandler(async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) {
    res.status(400);
    throw new Error('El mensaje no puede estar vacio');
  }

  const { match, otherUserId } = await loadAuthorizedMatch(res, req.params.matchId, req.user._id);

  const message = await Message.create({
    match: match._id,
    sender: req.user._id,
    recipient: otherUserId,
    content: content.trim(),
  });

  await Notification.create({
    user: otherUserId,
    type: 'mensaje',
    title: 'Nuevo mensaje',
    message: `${req.user.name} te envio un mensaje sobre la coincidencia de "${match.lostItem.title}".`,
    relatedItem: match.lostItem._id,
    relatedMatch: match._id,
  });

  res.status(201).json(message);
});

module.exports = { getConversations, getMessages, sendMessage };
