/**
 * Manejo centralizado de errores.
 * - Traduce errores conocidos (ID mal formado, validacion de Mongoose,
 *   duplicados, JSON invalido, cuerpo demasiado grande) a respuestas 4xx
 *   claras en vez de un 500 generico.
 * - En produccion NUNCA devuelve el stack ni el mensaje interno de un
 *   error 500 (podria revelar rutas, consultas o versiones del servidor).
 */
const notFound = (req, res, next) => {
  res.status(404);
  next(new Error(`Ruta no encontrada - ${req.originalUrl.split('?')[0]}`));
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let statusCode = err.status || err.statusCode || (res.statusCode === 200 ? 500 : res.statusCode);
  let message = err.message;
  const body = {};

  if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Identificador o dato con formato inválido.';
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors || {}).map((e) => e.message).join(' ') || 'Datos inválidos.';
  } else if (err.code === 11000) {
    statusCode = 409;
    message = 'El registro ya existe.';
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'El cuerpo de la petición no es un JSON válido.';
  } else if (err.type === 'entity.too.large') {
    statusCode = 413;
    message = 'La petición es demasiado grande.';
  }

  if (err.code && typeof err.code === 'string') body.code = err.code;
  if (err.retryAfter) body.retryAfter = err.retryAfter;
  if (Array.isArray(err.findings)) body.findings = err.findings;

  if (statusCode >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl.split('?')[0]} ->`, err);
    // Los errores marcados con expose=true (por ejemplo "no pudimos enviar el
    // correo", 503) ya traen un mensaje pensado para el usuario y se muestran.
    if (process.env.NODE_ENV === 'production' && !err.expose) message = 'Error interno del servidor. Intenta de nuevo más tarde.';
  }

  res.status(statusCode).json({
    message,
    ...body,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });
};

module.exports = { notFound, errorHandler };
