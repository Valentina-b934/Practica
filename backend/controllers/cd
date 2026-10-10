const fs = require('fs');
const path = require('path');
const asyncHandler = require('express-async-handler');
const Item = require('../models/Item');
const Match = require('../models/Match');
const Message = require('../models/Message');
const City = require('../models/City');
const Category = require('../models/Category');
const Institution = require('../models/Institution');
const { buildTextVector } = require('../services/textAnalysis');
const { computeImageHash, computeColorProfile, isSameImage } = require('../services/imageAnalysis');
const { findMatchesForItem } = require('../services/aiMatching');
const { removeUploadedFile } = require('../middleware/upload');
const { cleanString, isValidObjectId, escapeRegex } = require('../utils/validators');
const { detectSensitiveData, describeFindings } = require('../utils/sensitiveData');
const { PET_NAME_PATTERN } = require('../config/categories');

const ITEM_STATUSES = ['activo', 'con_coincidencias', 'en_proceso', 'recuperado', 'cerrado'];

// Campos internos de la IA que no hace falta enviar al navegador
const AI_FIELDS = '-textVector -imageHash -imageColorProfile';

/**
 * PRIVACIDAD (principio de minima exposicion):
 * en las respuestas publicas solo se muestra el nombre corto de quien
 * reporto ("Laura M."). Antes se enviaba el usuario completo (correo y
 * telefono incluidos) a cualquier visitante del buscador. El contacto
 * entre las partes se hace por la mensajeria interna.
 */
function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Usuario';
  return parts.length > 1 ? `${parts[0]} ${parts[1][0].toUpperCase()}.` : parts[0];
}

function toPublicItem(item) {
  const obj = typeof item.toObject === 'function' ? item.toObject() : { ...item };
  if (obj.user && typeof obj.user === 'object') {
    obj.user = { _id: obj.user._id, name: shortName(obj.user.name) };
  }
  if (obj.institution && typeof obj.institution === 'object') {
    obj.institution = { _id: obj.institution._id, name: obj.institution.name, type: obj.institution.type };
  }
  delete obj.moderation;
  return obj;
}

/**
 * Valida y limpia los campos de un reporte. Lanza 400 con un mensaje claro.
 */
async function validateItemInput(req, res) {
  const title = cleanString(req.body.title, 100);
  const description = cleanString(req.body.description, 1000);
  const color = cleanString(req.body.color, 60);
  const brand = cleanString(req.body.brand, 60);
  const place = cleanString(req.body.place, 120);
  const { city, category } = req.body;

  const fail = (msg) => {
    res.status(400);
    throw new Error(msg);
  };

  if (title.length < 3) fail('El título debe tener al menos 3 caracteres.');
  if (description.length < 10) fail('La descripción debe tener al menos 10 caracteres.');

  const date = new Date(req.body.date);
  if (!req.body.date || Number.isNaN(date.getTime())) fail('Indica una fecha válida.');
  if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) fail('La fecha no puede estar en el futuro.');

  if (!isValidObjectId(city) || !(await City.exists({ _id: city, active: true }))) {
    fail('Selecciona una ciudad válida.');
  }

  // Solo se aceptan categorias activas (las 5 oficiales); nunca mascotas
  const categoryDoc = isValidObjectId(category) ? await Category.findOne({ _id: category, active: true }) : null;
  if (!categoryDoc || PET_NAME_PATTERN.test(categoryDoc.name)) {
    fail('Selecciona una categoría válida: Billeteras, Gafas, Carteras, Documentos o Dispositivos.');
  }

  // Institucion: la del usuario institucional, o una indicada que exista
  let institution = req.user.institution || null;
  if (!institution && req.body.institution) {
    if (!isValidObjectId(req.body.institution) || !(await Institution.exists({ _id: req.body.institution, active: true }))) {
      fail('La institución indicada no existe.');
    }
    institution = req.body.institution;
  }

  // Datos personales en un reporte PUBLICO: se advierte antes de publicar
  const findings = detectSensitiveData([title, description, color, brand, place].join('\n'));
  const confirmed = req.body.confirmSensitive === 'true' || req.body.confirmSensitive === true;
  if (findings.some((f) => f.severity === 'block')) {
    res.status(422);
    const e = new Error(`Por tu seguridad no se permite publicar un ${describeFindings(findings.filter((f) => f.severity === 'block'))}.`);
    e.code = 'SENSITIVE_DATA_BLOCKED';
    throw e;
  }
  if (findings.length && !confirmed) {
    res.status(422);
    const e = new Error(
      `Tu reporte parece incluir datos personales (${describeFindings(findings)}). ` +
        'Los reportes son públicos: no es necesario publicarlos, la otra persona podrá escribirte por la mensajería interna.'
    );
    e.code = 'SENSITIVE_DATA_WARNING';
    e.findings = findings;
    throw e;
  }

  return { title, description, color, brand, place, date, city, category, institution };
}

/**
 * Crea un reporte (perdido o encontrado). Comparte logica porque
 * el flujo de IA es identico para ambos tipos.
 */
const createItem = (type) =>
  asyncHandler(async (req, res) => {
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

    try {
      const fields = await validateItemInput(req, res);

      const imageUrl = `/uploads/${req.file.filename}`;
      // La IA recibe los bytes ORIGINALES de la foto, igual que antes
      const buffer = req.file.buffer || fs.readFileSync(req.file.path);
      const imageHash = await computeImageHash(buffer);
      const imageColorProfile = await computeColorProfile(buffer);

      if (!imageHash) {
        // La imagen se subio pero no se pudo procesar (archivo corrupto,
        // formato no soportado por sharp, etc.): no dejamos crear el reporte
        // sin huella visual, porque rompería silenciosamente el matching.
        res.status(400);
        throw new Error('No se pudo procesar la fotografía. Intenta con otra imagen JPG, PNG o WEBP.');
      }

      // --- Seguridad anti-fraude ---------------------------------------
      // La IA ya identifica objetos similares aunque las fotos sean
      // distintas (eso es lo que hace util al motor de coincidencias).
      // Pero si la fotografia es PRACTICAMENTE IDENTICA a la de un
      // reporte ya existente del tipo contrario (perdido <-> encontrado),
      // eso no es una coincidencia genuina: es senal de que alguien
      // reutilizo la misma imagen (por ejemplo, la foto original del
      // dueno) para simular de mala fe que "encontro" algo que nunca tuvo,
      // o para fabricar evidencia falsa. Se exige entonces que la foto
      // sea diferente, aunque el objeto reportado sea el mismo.
      const oppositeType = type === 'perdido' ? 'encontrado' : 'perdido';
      const posiblesDuplicados = await Item.find({
        type: oppositeType,
        imageHash: { $ne: '' },
      }).select('imageHash imageColorProfile title');

      const duplicado = posiblesDuplicados.find((otro) =>
        isSameImage(imageHash, imageColorProfile, otro.imageHash, otro.imageColorProfile)
      );

      if (duplicado) {
        res.status(400);
        throw new Error(
          `Por seguridad, esta fotografía ya fue usada en otro reporte de tipo contrario ("${duplicado.title}"). ` +
          'Si es el mismo objeto, toma o sube una fotografía distinta; reutilizar exactamente la misma imagen no está permitido porque puede ser un intento de fraude.'
        );
      }

      const item = new Item({
        type,
        user: req.user._id,
        ...fields,
        imageUrl,
        imageHash,
        imageColorProfile,
      });

      // Vector de texto generado por IA (PLN)
      item.textVector = buildTextVector(item);

      await item.save();

      // Dispara el motor de coincidencias en segundo plano logico (await para MVP)
      const matches = await findMatchesForItem(item);

      const responseItem = item.toObject();
      delete responseItem.textVector;
      delete responseItem.imageHash;
      delete responseItem.imageColorProfile;

      res.status(201).json({
        item: responseItem,
        matchesFound: matches.length,
      });
    } catch (err) {
      // Cualquier error despues de subir la foto: se borra el archivo
      // para no dejar imagenes huerfanas en el servidor.
      removeUploadedFile(req.file.path);
      throw err;
    }
  });

const createLostItem = createItem('perdido');
const createFoundItem = createItem('encontrado');

// @route GET /api/items?city=&department=&category=&type=&q=
const listItems = asyncHandler(async (req, res) => {
  const city = cleanString(req.query.city, 24);
  const department = cleanString(req.query.department, 80);
  const category = cleanString(req.query.category, 24);
  const type = cleanString(req.query.type, 20);
  const status = cleanString(req.query.status, 30);
  const q = cleanString(req.query.q, 100);

  const filter = { 'moderation.status': 'aprobado' };

  if (city) {
    if (!isValidObjectId(city)) return res.json([]);
    filter.city = city;
  } else if (department) {
    // Sin ciudad especifica pero con departamento: buscamos todas las
    // ciudades de ese departamento y filtramos por cualquiera de ellas.
    const citiesInDept = await City.find({ department }).select('_id');
    filter.city = { $in: citiesInDept.map((c) => c._id) };
  }

  if (category) {
    if (!isValidObjectId(category)) return res.json([]);
    filter.category = category;
  }
  if (['perdido', 'encontrado'].includes(type)) filter.type = type;
  if (ITEM_STATUSES.includes(status)) filter.status = status;
  if (q) {
    // Se escapa el texto: antes se usaba tal cual como expresion regular,
    // lo que permitia consultas costosas (ReDoS) con patrones maliciosos.
    const safe = escapeRegex(q);
    filter.$or = [
      { title: { $regex: safe, $options: 'i' } },
      { description: { $regex: safe, $options: 'i' } },
    ];
  }

  const items = await Item.find(filter)
    .select(AI_FIELDS)
    .populate('city category')
    .populate('institution', 'name type')
    .populate('user', 'name')
    .sort('-createdAt')
    .limit(100);

  res.json(items.map(toPublicItem));
});

// @route GET /api/items/mine
const myItems = asyncHandler(async (req, res) => {
  const items = await Item.find({ user: req.user._id })
    .select(AI_FIELDS)
    .populate('city category institution')
    .sort('-createdAt');
  res.json(items);
});

// @route GET /api/items/:id   (publico; con sesion opcional)
const getItem = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    res.status(404);
    throw new Error('Reporte no encontrado');
  }
  const item = await Item.findById(req.params.id)
    .select(AI_FIELDS)
    .populate('city category')
    .populate('institution', 'name type')
    .populate('user', 'name');
  if (!item) {
    res.status(404);
    throw new Error('Reporte no encontrado');
  }

  // Un reporte pendiente o rechazado por moderacion solo lo ve su dueño,
  // un administrador o el personal de su institucion.
  if (item.moderation?.status !== 'aprobado') {
    const uid = req.user ? String(req.user._id) : null;
    const isOwner = uid && String(item.user?._id || item.user) === uid;
    const isAdmin = req.user?.role === 'admin';
    const isStaff = req.user?.role === 'institucion' && item.institution &&
      String(item.institution._id || item.institution) === String(req.user.institution);
    if (!isOwner && !isAdmin && !isStaff) {
      res.status(404);
      throw new Error('Reporte no encontrado');
    }
  }

  res.json(toPublicItem(item));
});

// @route PUT /api/items/:id/status  (dueño, institucion o admin)
const updateItemStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!ITEM_STATUSES.includes(status)) {
    res.status(400);
    throw new Error('Estado no válido');
  }
  const item = isValidObjectId(req.params.id) ? await Item.findById(req.params.id) : null;
  if (!item) {
    res.status(404);
    throw new Error('Reporte no encontrado');
  }

  const isOwner = String(item.user) === String(req.user._id);
  const isInstitutionStaff =
    req.user.role === 'institucion' && item.institution && String(item.institution) === String(req.user.institution);
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isInstitutionStaff && !isAdmin) {
    res.status(403);
    throw new Error('No tienes permisos para modificar este reporte');
  }

  item.status = status;
  await item.save();
  res.json(toPublicItem(item));
});

// @route DELETE /api/items/:id
const deleteItem = asyncHandler(async (req, res) => {
  const item = isValidObjectId(req.params.id) ? await Item.findById(req.params.id) : null;
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
    removeUploadedFile(path.join(__dirname, '..', item.imageUrl));
  }

  // Se eliminan tambien las coincidencias y sus conversaciones (minimizacion de datos)
  const matches = await Match.find({ $or: [{ lostItem: item._id }, { foundItem: item._id }] }).select('_id');
  await Message.deleteMany({ match: { $in: matches.map((m) => m._id) } });
  await Match.deleteMany({ _id: { $in: matches.map((m) => m._id) } });
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
  toPublicItem,
  shortName,
};