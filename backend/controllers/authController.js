const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { sendPasswordResetEmail } = require('../utils/email');

// @route POST /api/auth/register
const registerUser = asyncHandler(async (req, res) => {
  const { name, email, password, phone, city, role, institution } = req.body;

  const exists = await User.findOne({ email });
  if (exists) {
    res.status(400);
    throw new Error('Ya existe un usuario con ese correo');
  }

  // Por seguridad, el rol admin solo se asigna manualmente en la BD,
  // nunca desde el registro publico.
  const safeRole = role === 'institucion' ? 'institucion' : 'usuario';

  const user = await User.create({
    name,
    email,
    password,
    phone,
    city,
    role: safeRole,
    institution: safeRole === 'institucion' ? institution : null,
  });

  res.status(201).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    token: generateToken(user._id, user.role),
  });
});

// @route POST /api/auth/login
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (!user || !user.active) {
    res.status(401);
    throw new Error('Credenciales invalidas o usuario inactivo');
  }

  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    res.status(401);
    throw new Error('Credenciales invalidas');
  }

  res.json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    institution: user.institution,
    token: generateToken(user._id, user.role),
  });
});

// @route GET /api/auth/me
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .select('-password')
    .populate('city')
    .populate('institution');
  res.json(user);
});

// @route POST /api/auth/forgot-password  { email }
// Genera un token de un solo uso (valido 1 hora) y lo envia por correo.
// Por seguridad SIEMPRE responde el mismo mensaje generico exista o no
// el correo en la base de datos, para no permitir que alguien adivine
// que correos estan registrados en el sistema.
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.status(400);
    throw new Error('Debes indicar un correo electrónico');
  }

  const genericMessage = 'Si el correo está registrado, te enviamos un enlace para restablecer la contraseña.';

  const user = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (!user) {
    return res.json({ message: genericMessage });
  }

  // Se guarda solo el HASH del token en la base de datos; el token en
  // texto plano solo viaja por correo y nunca se persiste.
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hora
  await user.save();

  // Se usa CLIENT_URL (configurada en las variables de entorno de Render)
  // para construir el enlace que va en el correo/enlace de recuperación.
  // Si se configuran varios dominios separados por coma (para CORS), aquí
  // se usa el primero como dominio "canónico" del frontend.
  const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5500').split(',')[0].trim();
  const resetUrl = `${clientUrl}/reset-password.html?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

  const emailResult = await sendPasswordResetEmail(user.email, resetUrl);

  const responseBody = { message: genericMessage };

  // BUG CORREGIDO ("no llega nada al correo"):
  // Si EMAIL_HOST/EMAIL_USER/EMAIL_PASS no estan configurados en el .env
  // del backend, `sendPasswordResetEmail` NUNCA envia un correo real: solo
  // imprime el enlace en la consola del servidor (ver utils/email.js). Antes
  // el frontend solo mostraba el mensaje generico "revisa tu correo", sin
  // ninguna pista de que el correo jamas se envio, asi que el flujo parecia
  // "no funcionar" aunque el usuario si estuviera bien registrado.
  // Ahora, SOLO cuando el backend detecta que esta en modo de respaldo (sin
  // SMTP configurado) y NO esta en produccion, se devuelve tambien el
  // enlace de recuperacion en la respuesta, para poder seguir probando el
  // flujo de inmediato sin tener que configurar un proveedor de correo.
  // En produccion (NODE_ENV=production) esto nunca se expone, para no
  // revelar el enlace a alguien que no sea dueno del correo.
  if (emailResult?.mode === 'console-fallback' && process.env.NODE_ENV !== 'production') {
    responseBody.devResetUrl = resetUrl;
    responseBody.devNote =
      'El servidor no tiene configurado el envío real de correos (EMAIL_HOST/EMAIL_USER/EMAIL_PASS vacíos en el .env del backend), ' +
      'así que no se envió ningún correo de verdad. Usa el enlace de abajo solo para pruebas locales; ' +
      'configura esas variables (ver .env.example) para enviar correos reales.';
  }

  res.json(responseBody);
});

// @route POST /api/auth/reset-password/:token  { email, password }
const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { email, password } = req.body;

  if (!password || password.length < 6) {
    res.status(400);
    throw new Error('La nueva contraseña debe tener al menos 6 caracteres');
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    email: String(email).toLowerCase().trim(),
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() },
  }).select('+resetPasswordToken +resetPasswordExpires');

  if (!user) {
    res.status(400);
    throw new Error('El enlace de recuperación es inválido o ya expiró. Solicita uno nuevo.');
  }

  user.password = password; // el hook pre('save') del modelo lo hashea
  user.resetPasswordToken = null;
  user.resetPasswordExpires = null;
  await user.save();

  res.json({ message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' });
});

module.exports = { registerUser, loginUser, getMe, forgotPassword, resetPassword };
