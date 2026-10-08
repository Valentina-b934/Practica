/**
 * ================================================================
 * LIMITES DE FRECUENCIA (rate limiting)
 * ================================================================
 * Usa express-rate-limit (estandar de facto en Express). Cada limitador
 * responde 429 con un mensaje en español y el header Retry-After.
 *
 * Capas de proteccion (de general a especifica):
 *   apiLimiter            -> toda la API, por IP (abuso general / scraping)
 *   loginLimiter          -> intentos de login por IP + correo (fuerza bruta)
 *   otpVerifyLimiter      -> intentos de verificar OTP por IP
 *   otpSendLimiter        -> solicitudes de reenvio de OTP por IP (spam)
 *   passwordResetLimiter  -> "olvide mi contraseña" por IP (spam/enumeracion)
 *   registerLimiter       -> creacion de cuentas por IP
 *   reportCreateLimiter   -> reportes nuevos por usuario
 *   messageLimiter        -> mensajes de chat por usuario (anti-spam)
 *
 * Ademas de estos limites por IP, el bloqueo de cuenta tras varios
 * intentos fallidos se guarda en la base de datos (ver authController),
 * por lo que tambien resiste reinicios del servidor y cambios de IP.
 *
 * Los valores se pueden ajustar con variables de entorno RL_* sin tocar
 * codigo (util para pruebas automaticas o para escalar).
 * ================================================================
 */
const rateLimit = require('express-rate-limit');

const env = (name, def) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : def;
};

const MIN = 60 * 1000;

function limiter({ windowMs, max, message, keyGenerator }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    message: { message, code: 'RATE_LIMITED' },
  });
}

const byUser = (req) => (req.user ? `u:${req.user._id}` : `ip:${req.ip}`);

const apiLimiter = limiter({
  windowMs: 15 * MIN,
  max: env('RL_API_MAX', 600),
  message: 'Demasiadas solicitudes desde esta conexión. Intenta de nuevo en unos minutos.',
});

const loginLimiter = limiter({
  windowMs: 15 * MIN,
  max: env('RL_LOGIN_MAX', 10),
  message: 'Demasiados intentos de inicio de sesión. Espera 15 minutos e inténtalo de nuevo.',
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase().slice(0, 254)}`,
});

const otpVerifyLimiter = limiter({
  windowMs: 15 * MIN,
  max: env('RL_OTP_VERIFY_MAX', 20),
  message: 'Demasiados intentos de verificación. Espera unos minutos.',
});

const otpSendLimiter = limiter({
  windowMs: 15 * MIN,
  max: env('RL_OTP_SEND_MAX', 5),
  message: 'Has solicitado demasiados códigos. Espera unos minutos.',
});

const passwordResetLimiter = limiter({
  windowMs: 15 * MIN,
  max: env('RL_RESET_MAX', 5),
  message: 'Demasiadas solicitudes de recuperación. Espera 15 minutos e inténtalo de nuevo.',
});

const registerLimiter = limiter({
  windowMs: 60 * MIN,
  max: env('RL_REGISTER_MAX', 10),
  message: 'Demasiados registros desde esta conexión. Intenta más tarde.',
});

const reportCreateLimiter = limiter({
  windowMs: 60 * MIN,
  max: env('RL_REPORT_MAX', 10),
  message: 'Has creado demasiados reportes en poco tiempo. Intenta de nuevo en una hora.',
  keyGenerator: byUser,
});

const messageLimiter = limiter({
  windowMs: 1 * MIN,
  max: env('RL_MESSAGE_MAX', 15),
  message: 'Estás enviando mensajes muy rápido. Espera un momento.',
  keyGenerator: byUser,
});

module.exports = {
  apiLimiter,
  loginLimiter,
  otpVerifyLimiter,
  otpSendLimiter,
  passwordResetLimiter,
  registerLimiter,
  reportCreateLimiter,
  messageLimiter,
};