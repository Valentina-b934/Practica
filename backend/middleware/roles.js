/**
 * Middleware de autorizacion por rol.
 * Uso: authorize('admin', 'institucion')
 */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    res.status(403);
    throw new Error(`Acceso denegado. Rol requerido: ${roles.join(' o ')}`);
  }
  next();
};

module.exports = { authorize };
