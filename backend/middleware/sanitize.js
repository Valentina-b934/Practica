/**
 * ================================================================
 * PROTECCION CONTRA INYECCION NoSQL
 * ================================================================
 * MongoDB interpreta como operadores las claves que empiezan por "$"
 * (ej. { "email": { "$ne": null } }). Si un atacante envia eso en el
 * cuerpo JSON o en la URL (?city[$ne]=x), una consulta como
 * User.findOne({ email }) podria devolver un usuario cualquiera.
 *
 * Este middleware elimina de req.body, req.query y req.params toda clave
 * que empiece por "$" o contenga ".", antes de que llegue a cualquier
 * controlador. Como segunda capa, los controladores convierten los datos
 * a texto con cleanString() y validan los IDs con isValidObjectId().
 * ================================================================
 */
function clean(value, depth = 0) {
  if (depth > 10 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete value[key];
    } else {
      value[key] = clean(value[key], depth + 1);
    }
  }
  return value;
}

function sanitizeRequest(req, res, next) {
  if (req.body) clean(req.body);
  if (req.query) clean(req.query);
  if (req.params) clean(req.params);
  next();
}

module.exports = { sanitizeRequest };