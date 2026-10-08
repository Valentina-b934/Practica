const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const City = require('../models/City');
const generateToken = require('../utils/generateToken');
const { sendPasswordResetEmail, verifyEmailTransport, EmailError, isDevFallbackEnabled, isEmailConfigured } = require('../utils/email');
const {
  OtpError,
  isOtpRequired,
  createAndSendOtp,
  verifyOtp,
  findPendingChallenge,
  invalidateUserOtps,
} = require('../services/otpService');
const {
  cleanString,
  normalizeEmail,
  isValidEmail,
  isValidObjectId,
  validatePasswordPolicy,
  badRequest,
} = require('../utils/validators');

const MAX_LOGIN_ATTEMPTS = () => parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5', 10);
const LOCK_MINUTES = () => parseInt(process.env.LOGIN_LOCK_MINUTES || '15', 10);
const RESET_TOKEN_MINUTES = () => Math.min(Math.max(parseInt(process.env.RESET_TOKEN_TTL_MINUTES || '30', 10), 15), 60);
const RESET_REQUEST_COOLDOWN_MS = 60 * 1000;

const GENERIC_RESET_MESSAGE =
  'Si existe una cuenta asociada a este correo, recibirás instrucciones para recuperar tu contraseña.';

// Hash de relleno: si el correo no existe se compara igual contra este hash
// para que la respuesta tarde lo mismo y no revele que correos existen.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function sessionResponse(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    institution: user.institution,
    token: generateToken(user._id, user.role, user.tokenVersion),
  };
}

/** Convierte errores de correo/OTP en respuestas HTTP honestas. */
function handleAuthFlowError(res, err, emailFailMessage) {
  if (err instanceof OtpError) {
    res.status(err.status);
    throw err;
  }
  if (err instanceof EmailError) {
    res.status(503);
    const e = new Error(emailFailMessage || 'No pudimos enviar el correo. Intenta de nuevo en unos minutos.');
    e.code = err.code;
    e.expose = true;
    throw e;
  }
  throw err;
}

/** Inicia el segundo paso (OTP) y responde con el challenge. */
async function respondWithOtpChallenge(res, user, statusCode = 200) {
  const challenge = await createAndSendOtp(user);
  return res.status(statusCode).json({
    otpRequired: true,
    ...challenge,
    message: `Te enviamos un código de 6 dígitos a ${challenge.maskedEmail}.`,
  });
}

// @route POST /api/auth/register
const registerUser = asyncHandler(async (req, res) => {
  const name = cleanString(req.body.name, 80);
  const email = normalizeEmail(req.body.email);
  const phone = cleanString(req.body.phone, 30);
  const { password, city } = req.body;

  if (name.length < 2) badRequest(res, 'Escribe tu nombre (mínimo 2 caracteres).');
  if (!isValidEmail(email)) badRequest(res, 'El correo electrónico no es válido.');
  const policyError = validatePasswordPolicy(password);
  if (policyError) badRequest(res, policyError);
  if (phone && !/^[+\d\s()-]{7,30}$/.test(phone)) badRequest(res, 'El teléfono solo puede contener números.');
  if (!isValidObjectId(city) || !(await City.exists({ _id: city, active: true }))) {
    badRequest(res, 'Selecciona una ciudad válida.');
  }

  const exists = await User.exists({ email });
  if (exists) {
    res.status(400);
    throw new Error('Ya existe un usuario con ese correo');
  }

  // SEGURIDAD: el registro publico SIEMPRE crea cuentas con rol "usuario".
  // Antes se aceptaba role="institucion" e institution=<id> desde el cuerpo
  // de la peticion, por lo que cualquiera podia registrarse como personal de
  // una institucion y ver los reportes (y datos) de esa sede. Ahora las
  // cuentas de institucion las habilita un administrador.
  const user = await User.create({ name, email, password, phone, city, role: 'usuario' });

  if (!isOtpRequired(user)) {
    return res.status(201).json(sessionResponse(user));
  }

  try {
    return await respondWithOtpChallenge(res, user, 201);
  } catch (err) {
    // Sin correo verificado la cuenta no se puede usar: se elimina para que
    // la persona pueda volver a registrarse cuando el correo funcione.
    await User.deleteOne({ _id: user._id });
    return handleAuthFlowError(
      res,
      err,
      'No pudimos enviar el código de verificación a tu correo, así que la cuenta no se creó. Intenta de nuevo en unos minutos.'
    );
  }
});

// @route POST /api/auth/login
const loginUser = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!email || !password) badRequest(res, 'Escribe tu correo y tu contraseña.');

  const user = await User.findOne({ email }).select('+failedLoginAttempts +lockUntil');

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    res.status(401);
    throw new Error('Credenciales invalidas');
  }

  if (user.isLocked()) {
    const minutes = Math.ceil((user.lockUntil.getTime() - Date.now()) / 60000);
    res.status(429);
    const e = new Error(`Por seguridad, la cuenta está bloqueada temporalmente por varios intentos fallidos. Intenta de nuevo en ${minutes} minuto(s) o recupera tu contraseña.`);
    e.code = 'ACCOUNT_LOCKED';
    throw e;
  }

  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    // Incremento atomico del contador; al llegar al maximo se bloquea la cuenta
    await User.updateOne({ _id: user._id }, { $inc: { failedLoginAttempts: 1 } });
    const updated = await User.findById(user._id).select('+failedLoginAttempts');
    if (updated.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS()) {
      await User.updateOne(
        { _id: user._id },
        { lockUntil: new Date(Date.now() + LOCK_MINUTES() * 60000), failedLoginAttempts: 0 }
      );
    }
    res.status(401);
    throw new Error('Credenciales invalidas');
  }

  // Se revisa DESPUES de validar la contraseña para no revelar a un
  // desconocido que la cuenta existe pero esta desactivada.
  if (!user.active) {
    res.status(401);
    throw new Error('Credenciales invalidas o usuario inactivo');
  }

  if (user.failedLoginAttempts || user.lockUntil) {
    await User.updateOne({ _id: user._id }, { failedLoginAttempts: 0, lockUntil: null });
  }

  if (!isOtpRequired(user)) {
    return res.json(sessionResponse(user));
  }

  try {
    return await respondWithOtpChallenge(res, user);
  } catch (err) {
    return handleAuthFlowError(
      res,
      err,
      'No pudimos enviar el código de verificación a tu correo. Intenta de nuevo en unos minutos.'
    );
  }
});

// @route POST /api/auth/verify-otp  { challengeId, code }
const verifyLoginOtp = asyncHandler(async (req, res) => {
  const code = typeof req.body.code === 'string' ? req.body.code.replace(/\s/g, '') : '';
  let userId;
  try {
    userId = await verifyOtp(req.body.challengeId, code);
  } catch (err) {
    return handleAuthFlowError(res, err);
  }

  const user = await User.findById(userId);
  if (!user || !user.active) {
    res.status(401);
    throw new Error('Credenciales invalidas o usuario inactivo');
  }
  if (!user.emailVerified) {
    user.emailVerified = true;
    await user.save();
  }
  res.json(sessionResponse(user));
});

// @route POST /api/auth/resend-otp  { challengeId }
const resendLoginOtp = asyncHandler(async (req, res) => {
  const pending = await findPendingChallenge(req.body.challengeId);
  if (!pending || pending.expiresAt.getTime() < Date.now() - 30 * 60000) {
    res.status(400);
    throw new Error('La verificación expiró. Inicia sesión de nuevo.');
  }
  const user = await User.findById(pending.user);
  if (!user || !user.active) {
    res.status(400);
    throw new Error('La verificación expiró. Inicia sesión de nuevo.');
  }
  try {
    return await respondWithOtpChallenge(res, user);
  } catch (err) {
    return handleAuthFlowError(res, err, 'No pudimos enviar el código a tu correo. Intenta de nuevo en unos minutos.');
  }
});

// @route GET /api/auth/me
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .select('-password')
    .populate('city')
    .populate('institution');
  res.json(user);
});

function frontendBaseUrl() {
  const configured = (process.env.CLIENT_URL || '').split(',')[0].trim().replace(/\/+$/, '');
  if (configured && /^https?:\/\//i.test(configured)) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CLIENT_URL no está configurada: no se puede construir el enlace de recuperación.');
  }
  return 'http://localhost:5500';
}

// @route POST /api/auth/forgot-password  { email }
// Genera un token de un solo uso y envia por correo el enlace para crear
// una nueva contraseña. Responde SIEMPRE el mismo mensaje generico exista o
// no el correo, para no permitir que alguien averigue que correos estan
// registrados (enumeracion de usuarios).
const forgotPassword = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) badRequest(res, 'Debes indicar un correo electrónico');
  if (!isValidEmail(email)) badRequest(res, 'El correo electrónico no es válido.');

  // 1) Comprobar que el servicio de correo funciona ANTES de buscar al
  //    usuario: si el SMTP esta caido, la respuesta es la misma para correos
  //    registrados y no registrados (no se filtra informacion) y nunca se
  //    le dice al usuario que se envio un correo que no salio.
  try {
    await verifyEmailTransport();
  } catch (err) {
    return handleAuthFlowError(
      res,
      err,
      'En este momento no podemos enviar correos de recuperación. Intenta de nuevo en unos minutos.'
    );
  }

  const user = await User.findOne({ email }).select('+resetPasswordRequestedAt');
  if (!user || !user.active) {
    return res.json({ message: GENERIC_RESET_MESSAGE });
  }

  // 2) Anti-spam: si ya se envio un enlace hace menos de 1 minuto, no se
  //    envia otro (la respuesta es identica para no revelar nada).
  if (user.resetPasswordRequestedAt && Date.now() - user.resetPasswordRequestedAt.getTime() < RESET_REQUEST_COOLDOWN_MS) {
    return res.json({ message: GENERIC_RESET_MESSAGE });
  }

  // 3) Token de 256 bits de entropia. En la base de datos se guarda SOLO su
  //    hash SHA-256; el token original solo viaja en el correo.
  const minutes = RESET_TOKEN_MINUTES();
  const rawToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = sha256(rawToken);
  user.resetPasswordExpires = new Date(Date.now() + minutes * 60 * 1000);
  await user.save();

  const resetUrl = `${frontendBaseUrl()}/reset-password.html?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

  // 4) Envio REAL. Si falla, se anula el token y se informa el error.
  let result;
  try {
    result = await sendPasswordResetEmail(user.email, resetUrl, { name: user.name, minutes });
  } catch (err) {
    await User.updateOne({ _id: user._id }, { resetPasswordToken: null, resetPasswordExpires: null });
    return handleAuthFlowError(
      res,
      err,
      'No pudimos enviar el correo de recuperación. Intenta de nuevo en unos minutos.'
    );
  }

  await User.updateOne({ _id: user._id }, { resetPasswordRequestedAt: new Date() });

  const body = { message: GENERIC_RESET_MESSAGE };
  if (result.mode === 'console' && isDevFallbackEnabled() && !isEmailConfigured()) {
    // Solo en desarrollo con EMAIL_DEV_FALLBACK=true: se avisa con honestidad
    body.devNote = 'Modo desarrollo: el correo NO se envió, se imprimió en la consola del backend.';
  }
  res.json(body);
});

/** Busca el usuario dueño de un token de recuperacion vigente (sin consumirlo). */
async function findUserByResetToken(token, email) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return User.findOne({
    email: normalized,
    resetPasswordToken: sha256(token),
    resetPasswordExpires: { $gt: new Date() },
  }).select('+resetPasswordToken +resetPasswordExpires');
}

// @route GET /api/auth/reset-password/:token/validate?email=
// Permite a la pagina de "nueva contraseña" avisar de inmediato si el
// enlace ya expiro o ya se uso, antes de que el usuario escriba nada.
const validateResetToken = asyncHandler(async (req, res) => {
  const user = await findUserByResetToken(req.params.token, req.query.email);
  if (!user) {
    res.status(400);
    throw new Error('El enlace de recuperación es inválido, ya se usó o expiró. Solicita uno nuevo.');
  }
  res.json({ valid: true, expiresAt: user.resetPasswordExpires });
});

// @route POST /api/auth/reset-password/:token  { email, password }
const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { email, password } = req.body;

  const policyError = validatePasswordPolicy(password);
  if (policyError) badRequest(res, policyError);
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    res.status(400);
    throw new Error('El enlace de recuperación es inválido o ya expiró. Solicita uno nuevo.');
  }

  // Consumo ATOMICO del token: la misma operacion que lo valida lo borra,
  // asi dos peticiones simultaneas con el mismo enlace no pueden usarlo
  // dos veces (solo una obtiene modifiedCount = 1: un solo uso garantizado).
  const normalizedEmail = normalizeEmail(email);
  const consumed = await User.updateOne(
    {
      email: normalizedEmail,
      resetPasswordToken: sha256(token),
      resetPasswordExpires: { $gt: new Date() },
    },
    { $set: { resetPasswordToken: null, resetPasswordExpires: null } }
  );
  const user = consumed.modifiedCount === 1 ? await User.findOne({ email: normalizedEmail }) : null;

  if (!user) {
    res.status(400);
    throw new Error('El enlace de recuperación es inválido o ya expiró. Solicita uno nuevo.');
  }

  user.password = password; // el hook pre('save') lo hashea y registra passwordChangedAt
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.emailVerified = true; // demostro que controla el correo
  await user.save();

  // Cierra cualquier verificacion OTP pendiente iniciada con la clave vieja
  await invalidateUserOtps(user._id);

  res.json({ message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' });
});

module.exports = {
  registerUser,
  loginUser,
  verifyLoginOtp,
  resendLoginOtp,
  getMe,
  forgotPassword,
  validateResetToken,
  resetPassword,
};
