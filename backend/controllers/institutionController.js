const asyncHandler = require('express-async-handler');
const Institution = require('../models/Institution');
const Item = require('../models/Item');
const User = require('../models/User');
const City = require('../models/City');
const { cleanString, isValidObjectId, normalizeEmail, isValidEmail } = require('../utils/validators');
const { shortName } = require('./itemController');

const INSTITUTION_TYPES = ['universidad', 'centro_comercial', 'empresa', 'aeropuerto', 'terminal', 'otro'];

/**
 * BUG DE AUTORIZACION (IDOR) CORREGIDO: las rutas /:id/items y /:id/stats
 * solo exigian el rol "institucion", pero no comprobaban que el :id fuera
 * SU institucion. Cambiando el id en la URL, el personal de una sede podia
 * ver los reportes y usuarios de cualquier otra. Ahora solo el personal de
 * esa institucion (o un administrador) puede consultarla o modificarla.
 */
function assertOwnInstitution(req, res) {
  if (!isValidObjectId(req.params.id)) {
    res.status(404);
    throw new Error('Institución no encontrada');
  }
  if (req.user.role === 'admin') return;
  if (String(req.user.institution || '') !== String(req.params.id)) {
    res.status(403);
    throw new Error('Solo puedes acceder a la información de tu propia institución');
  }
}

/** Solo se aceptan campos conocidos (evita "mass assignment" de adminUser, active, etc.). */
function pickInstitutionFields(body, { isAdmin }) {
  const data = {};
  if (body.name !== undefined) data.name = cleanString(body.name, 120);
  if (body.address !== undefined) data.address = cleanString(body.address, 200);
  if (body.contactPhone !== undefined) data.contactPhone = cleanString(body.contactPhone, 30);
  if (body.contactEmail !== undefined) {
    const email = normalizeEmail(body.contactEmail);
    if (email && !isValidEmail(email)) throw new Error('El correo de contacto no es válido.');
    data.contactEmail = email;
  }
  if (body.type !== undefined && INSTITUTION_TYPES.includes(body.type)) data.type = body.type;
  if (isAdmin) {
    if (body.city !== undefined && isValidObjectId(body.city)) data.city = body.city;
    if (typeof body.active === 'boolean') data.active = body.active;
  }
  return data;
}

// @route GET /api/institutions
const listInstitutions = asyncHandler(async (req, res) => {
  const institutions = await Institution.find({ active: true })
    .select('name type city address contactEmail contactPhone logoUrl')
    .populate('city');
  res.json(institutions);
});

// @route POST /api/institutions  (admin)
// El administrador indica el correo (o el id) de una cuenta ya registrada;
// esa cuenta pasa a tener rol "institucion" y queda vinculada a la sede.
// (Antes el usuario institucional nunca quedaba vinculado y su panel no
// funcionaba hasta editar la base de datos a mano.)
const createInstitution = asyncHandler(async (req, res) => {
  let data;
  try {
    data = pickInstitutionFields(req.body, { isAdmin: true });
  } catch (err) {
    res.status(400);
    throw err;
  }
  if (!data.name || data.name.length < 3) {
    res.status(400);
    throw new Error('Escribe el nombre de la institución.');
  }
  if (!data.city || !(await City.exists({ _id: data.city }))) {
    res.status(400);
    throw new Error('Selecciona una ciudad válida.');
  }

  let adminUser = null;
  if (isValidObjectId(req.body.adminUser)) adminUser = await User.findById(req.body.adminUser);
  else if (req.body.adminEmail) adminUser = await User.findOne({ email: normalizeEmail(req.body.adminEmail) });
  if (!adminUser) {
    res.status(400);
    throw new Error('No existe una cuenta registrada con ese correo. La persona debe registrarse primero.');
  }
  if (adminUser.role === 'admin') {
    res.status(400);
    throw new Error('Una cuenta de administrador no puede ser el responsable de una institución.');
  }

  const institution = await Institution.create({ ...data, adminUser: adminUser._id });
  adminUser.role = 'institucion';
  adminUser.institution = institution._id;
  await adminUser.save();

  res.status(201).json(institution);
});

// @route PUT /api/institutions/:id (admin o la propia institucion)
const updateInstitution = asyncHandler(async (req, res) => {
  assertOwnInstitution(req, res);
  let data;
  try {
    data = pickInstitutionFields(req.body, { isAdmin: req.user.role === 'admin' });
  } catch (err) {
    res.status(400);
    throw err;
  }
  const institution = await Institution.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
  if (!institution) {
    res.status(404);
    throw new Error('Institución no encontrada');
  }
  res.json(institution);
});

// @route GET /api/institutions/:id/items -> reportes de la sede
const institutionItems = asyncHandler(async (req, res) => {
  assertOwnInstitution(req, res);
  const items = await Item.find({ institution: req.params.id })
    .select('-textVector -imageHash -imageColorProfile')
    .populate('city category')
    .populate('user', 'name')
    .sort('-createdAt');
  res.json(items.map((i) => {
    const obj = i.toObject();
    if (obj.user) obj.user = { _id: obj.user._id, name: shortName(obj.user.name) };
    return obj;
  }));
});

// @route GET /api/institutions/:id/stats -> estadisticas de la sede
const institutionStats = asyncHandler(async (req, res) => {
  assertOwnInstitution(req, res);
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