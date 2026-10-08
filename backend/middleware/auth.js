const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');

/**
 * Lee y valida el JWT del header Authorization. Devuelve el usuario o null.
 * Rechaza el token si:
 *  - la firma o la expiracion no son validas (solo se acepta HS256),
 *  - el usuario ya no existe o esta inactivo,
 *  - el token se emitio ANTES del ultimo cambio de contraseña (su version
 *    "tv" ya no coincide): al recuperar la contraseña se cierran todas las
 *    sesiones abiertas.
 */
async function userFromRequest(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return { user: null, reason: 'missing' };

  const token = header.slice(7).trim();
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (error) {
    return { user: null, reason: 'invalid' };
  }

  const user = await User.findById(decoded.id).select('-password');
  if (!user || !user.active) return { user: null, reason: 'invalid' };

  if ((decoded.tv || 0) !== (user.tokenVersion || 0)) {
    return { user: null, reason: 'invalid' };
  }
  return { user, reason: null };
}

// Verifica el token JWT y adjunta el usuario a req.user
const protect = asyncHandler(async (req, res, next) => {
  const { user, reason } = await userFromRequest(req);
  if (!user) {
    res.status(401);
    throw new Error(reason === 'missing' ? 'No autorizado, falta token' : 'Tu sesión expiró o no es válida. Inicia sesión de nuevo.');
  }
  req.user = user;
  next();
});

// Igual que protect, pero no exige sesion: si hay un token valido adjunta
// req.user, y si no, continua como visitante (rutas publicas).
const optionalAuth = asyncHandler(async (req, res, next) => {
  const { user } = await userFromRequest(req);
  if (user) req.user = user;
  next();
});

module.exports = { protect, optionalAuth };