/**
 * ================================================================
 * SERVICIO OTP (codigo de un solo uso por correo)
 * ================================================================
 * Flujo:
 *   1. createAndSendOtp(user) -> genera un codigo de 6 digitos con
 *      crypto.randomInt (criptograficamente seguro), guarda solo su HMAC,
 *      invalida los codigos anteriores del usuario, lo envia por correo y
 *      devuelve un challengeId opaco para el cliente.
 *   2. verifyOtp(challengeId, code) -> valida el codigo.
 *
 * Garantias:
 *   - Un solo uso: se marca usedAt de forma ATOMICA (findOneAndUpdate con
 *     usedAt:null), asi dos peticiones simultaneas no pueden usarlo dos veces.
 *   - Temporal: vence a los OTP_TTL_MINUTES (5 por defecto).
 *   - Intentos limitados: maximo OTP_MAX_ATTEMPTS (5) por codigo; luego
 *     queda invalidado y hay que pedir uno nuevo.
 *   - Limite de envios: maximo OTP_MAX_SENDS_PER_WINDOW (3) codigos sin usar
 *     cada 15 minutos por usuario y una espera minima de
 *     OTP_RESEND_COOLDOWN_SECONDS (60 s) entre envios, para que nadie use el
 *     sistema para enviar spam.
 *   - Comparacion en tiempo constante (crypto.timingSafeEqual).
 * ================================================================
 */
const crypto = require('crypto');
const OtpCode = require('../models/OtpCode');
const { sendOtpEmail } = require('../utils/email');

const num = (name, def) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : def;
};
const TTL_MINUTES = () => num('OTP_TTL_MINUTES', 5);
const MAX_ATTEMPTS = () => num('OTP_MAX_ATTEMPTS', 5);
const MAX_SENDS = () => num('OTP_MAX_SENDS_PER_WINDOW', 3);
const SEND_WINDOW_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = () => num('OTP_RESEND_COOLDOWN_SECONDS', 60) * 1000;

class OtpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

function otpSecret() {
  return process.env.OTP_SECRET || process.env.JWT_SECRET;
}

const hmac = (value) => crypto.createHmac('sha256', otpSecret()).update(String(value)).digest('hex');
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

/**
 * ¿Este usuario debe validar un OTP para iniciar sesion?
 * OTP_LOGIN_MODE: "always" (por defecto: todos), "privileged" (solo admin
 * e institucion) u "off" (desactivado, solo para pruebas).
 */
function isOtpRequired(user) {
  const mode = (process.env.OTP_LOGIN_MODE || 'always').toLowerCase();
  if (mode === 'off') return false;
  if (mode === 'privileged') return ['admin', 'institucion'].includes(user.role);
  return true;
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - 2, 3))}@${domain}`;
}

async function assertSendAllowed(userId) {
  // Solo cuentan los codigos que NO se usaron con exito: quien inicia sesion
  // correctamente varias veces no se bloquea; quien pide codigos sin usarlos
  // (spam o un atacante que conoce la contraseña) si.
  const since = new Date(Date.now() - SEND_WINDOW_MS);
  const recent = await OtpCode.find({ user: userId, createdAt: { $gte: since }, usedAt: null })
    .sort('-createdAt')
    .select('createdAt');

  if (recent.length >= MAX_SENDS()) {
    const oldest = recent[recent.length - 1].createdAt.getTime();
    const retryAfter = Math.ceil((oldest + SEND_WINDOW_MS - Date.now()) / 1000);
    throw new OtpError(429, 'OTP_SEND_LIMIT', 'Has solicitado demasiados códigos. Espera unos minutos antes de pedir otro.', {
      retryAfter,
    });
  }
  if (recent.length && Date.now() - recent[0].createdAt.getTime() < RESEND_COOLDOWN_MS()) {
    const retryAfter = Math.ceil((recent[0].createdAt.getTime() + RESEND_COOLDOWN_MS() - Date.now()) / 1000);
    throw new OtpError(429, 'OTP_COOLDOWN', `Espera ${retryAfter} segundos antes de pedir un nuevo código.`, { retryAfter });
  }
}

async function createAndSendOtp(user) {
  await assertSendAllowed(user._id);

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const challengeId = crypto.randomBytes(32).toString('hex');
  const minutes = TTL_MINUTES();

  // Un codigo nuevo invalida cualquier codigo anterior aun pendiente
  await OtpCode.updateMany(
    { user: user._id, usedAt: null, invalidatedAt: null },
    { invalidatedAt: new Date() }
  );

  const otp = await OtpCode.create({
    user: user._id,
    purpose: 'login',
    challengeHash: sha256(challengeId),
    codeHash: hmac(`${challengeId}:${code}`),
    expiresAt: new Date(Date.now() + minutes * 60 * 1000),
    maxAttempts: MAX_ATTEMPTS(),
  });

  try {
    await sendOtpEmail(user.email, code, { name: user.name, minutes });
  } catch (err) {
    // Si el correo no salio, el codigo no sirve para nada: se invalida.
    // Se borra para que el intento fallido no cuente en el limite de envios.
    await OtpCode.deleteOne({ _id: otp._id });
    throw err;
  }

  return { challengeId, expiresInSeconds: minutes * 60, maskedEmail: maskEmail(user.email) };
}

/**
 * Valida un codigo. Devuelve el userId si es correcto; si no, lanza OtpError.
 */
async function verifyOtp(challengeId, code) {
  if (typeof challengeId !== 'string' || !/^[a-f0-9]{64}$/.test(challengeId)) {
    throw new OtpError(400, 'OTP_INVALID', 'La verificación no es válida. Inicia sesión de nuevo.');
  }
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new OtpError(400, 'OTP_FORMAT', 'El código debe tener 6 dígitos.');
  }

  const challengeHash = sha256(challengeId);
  const now = new Date();

  // Se registra el intento ANTES de comparar (atomico): asi ni siquiera
  // peticiones en paralelo pueden superar el maximo de intentos.
  const otp = await OtpCode.findOneAndUpdate(
    { challengeHash, usedAt: null, invalidatedAt: null },
    { $inc: { attempts: 1 } },
    { new: true }
  );

  if (!otp) {
    throw new OtpError(400, 'OTP_INVALID', 'El código ya fue usado o no es válido. Solicita uno nuevo.');
  }
  if (otp.expiresAt <= now) {
    await OtpCode.updateOne({ _id: otp._id }, { invalidatedAt: now });
    throw new OtpError(400, 'OTP_EXPIRED', 'El código expiró. Solicita uno nuevo.');
  }
  if (otp.attempts > otp.maxAttempts) {
    await OtpCode.updateOne({ _id: otp._id }, { invalidatedAt: now });
    throw new OtpError(429, 'OTP_LOCKED', 'Superaste el número de intentos. Solicita un nuevo código.');
  }

  const expected = Buffer.from(otp.codeHash, 'hex');
  const received = Buffer.from(hmac(`${challengeId}:${code}`), 'hex');
  const ok = expected.length === received.length && crypto.timingSafeEqual(expected, received);

  if (!ok) {
    const remaining = Math.max(otp.maxAttempts - otp.attempts, 0);
    if (remaining === 0) await OtpCode.updateOne({ _id: otp._id }, { invalidatedAt: now });
    throw new OtpError(400, 'OTP_WRONG', remaining
      ? `Código incorrecto. Te quedan ${remaining} intento(s).`
      : 'Código incorrecto. Superaste el número de intentos; solicita un nuevo código.', { remaining });
  }

  // Consumo atomico: solo UNA peticion puede marcarlo como usado
  const consumed = await OtpCode.findOneAndUpdate(
    { _id: otp._id, usedAt: null, invalidatedAt: null },
    { usedAt: now },
    { new: true }
  );
  if (!consumed) {
    throw new OtpError(400, 'OTP_INVALID', 'El código ya fue usado. Solicita uno nuevo.');
  }

  return consumed.user;
}

/** Busca el OTP pendiente de un challenge (para reenviar el codigo). */
async function findPendingChallenge(challengeId) {
  if (typeof challengeId !== 'string' || !/^[a-f0-9]{64}$/.test(challengeId)) return null;
  return OtpCode.findOne({ challengeHash: sha256(challengeId), usedAt: null });
}

async function invalidateUserOtps(userId) {
  await OtpCode.updateMany({ user: userId, usedAt: null, invalidatedAt: null }, { invalidatedAt: new Date() });
}

module.exports = {
  OtpError,
  isOtpRequired,
  createAndSendOtp,
  verifyOtp,
  findPendingChallenge,
  invalidateUserOtps,
  maskEmail,
};