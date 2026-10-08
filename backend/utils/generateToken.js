const jwt = require('jsonwebtoken');

/**
 * Genera el JWT de sesion. Cambios de seguridad:
 *  - Expira en 8 horas por defecto (antes 7 dias): si un token se filtra,
 *    sirve por mucho menos tiempo. Configurable con JWT_EXPIRES_IN.
 *  - Algoritmo fijado a HS256 (el middleware solo acepta ese algoritmo).
 *  - Incluye la version de sesiones del usuario ("tv"): si el usuario
 *    cambia su contraseña, los tokens emitidos antes quedan invalidados.
 */
const generateToken = (userId, role, tokenVersion = 0) => {
  return jwt.sign({ id: userId, role, tv: tokenVersion }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
};

module.exports = generateToken;