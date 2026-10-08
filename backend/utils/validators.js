/**
 * ================================================================
 * VALIDACION Y LIMPIEZA DE ENTRADAS
 * ================================================================
 * Funciones pequeñas y reutilizables para validar lo que llega desde el
 * cliente. El frontend tambien valida, pero el backend NUNCA confia en el:
 * cualquiera puede llamar a la API directamente con Postman o curl.
 * ================================================================
 */
const mongoose = require('mongoose');

const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

function isValidObjectId(value) {
  return typeof value === 'string' && mongoose.Types.ObjectId.isValid(value) && /^[a-f0-9]{24}$/i.test(value);
}

/**
 * Convierte un valor a texto plano seguro: solo acepta strings (rechaza
 * objetos como { "$ne": null }), quita caracteres de control invisibles y
 * espacios sobrantes, y corta a la longitud maxima permitida.
 */
function cleanString(value, maxLength = 1000) {
  if (typeof value !== 'string') return '';
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

function normalizeEmail(value) {
  return cleanString(value, 254).toLowerCase();
}

function isValidEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_REGEX.test(value);
}

/**
 * Politica de contraseñas: minimo 8 caracteres, al menos una letra y un
 * numero, maximo 128 (bcrypt solo usa los primeros 72 bytes; el limite
 * tambien evita que alguien envie contraseñas gigantes para gastar CPU).
 * Devuelve el mensaje de error o null si es valida.
 */
function validatePasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'La contraseña debe tener al menos 8 caracteres.';
  }
  if (password.length > 128) return 'La contraseña no puede superar 128 caracteres.';
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(password) || !/\d/.test(password)) {
    return 'La contraseña debe combinar letras y números.';
  }
  return null;
}

/** Escapa un texto para usarlo de forma literal dentro de una RegExp (evita ReDoS/inyeccion). */
function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Lanza un error HTTP 400 con el mensaje indicado (para usar dentro de asyncHandler). */
function badRequest(res, message) {
  res.status(400);
  throw new Error(message);
}

module.exports = {
  isValidObjectId,
  cleanString,
  normalizeEmail,
  isValidEmail,
  validatePasswordPolicy,
  escapeRegex,
  badRequest,
};