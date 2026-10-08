const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');

dotenv.config();

const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { sanitizeRequest } = require('./middleware/sanitize');
const { apiLimiter } = require('./middleware/rateLimiters');
const { UPLOAD_DIR } = require('./middleware/upload');

const authRoutes = require('./routes/authRoutes');
const itemRoutes = require('./routes/itemRoutes');
const matchRoutes = require('./routes/matchRoutes');
const institutionRoutes = require('./routes/institutionRoutes');
const cityRoutes = require('./routes/cityRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const adminRoutes = require('./routes/adminRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const messageRoutes = require('./routes/messageRoutes');

/**
 * Comprobaciones de seguridad al arrancar: en produccion el servidor NO
 * inicia con una clave JWT debil o de ejemplo (cualquiera que la conozca
 * podria fabricar tokens de administrador).
 */
function checkSecurityConfig() {
  const secret = process.env.JWT_SECRET || '';
  const weak = secret.length < 32 || /cambia_esta_clave/i.test(secret);
  if (process.env.NODE_ENV === 'production') {
    if (weak) throw new Error('JWT_SECRET debe tener al menos 32 caracteres aleatorios en produccion.');
    if (!process.env.CLIENT_URL) throw new Error('CLIENT_URL es obligatoria en produccion.');
  } else if (weak) {
    console.warn('⚠️  JWT_SECRET es debil o de ejemplo. Genera una con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  }
}
checkSecurityConfig();

const app = express();

// Render (y la mayoria de hostings) ponen un proxy delante de la app: sin
// esto, req.ip seria la IP del proxy y el rate limiting trataria a todos
// los usuarios como si fueran una sola persona.
const trustProxy = process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? '1' : '');
if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

// Cabeceras HTTP de seguridad (nosniff, HSTS, frameguard, sin X-Powered-By...).
// crossOriginResourcePolicy "cross-origin" porque el frontend (otro dominio)
// necesita mostrar las fotos servidas desde /uploads.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Live Server (VS Code) puede servir en distintos puertos y en
// "localhost" o "127.0.0.1" indistintamente; para el navegador son
// origenes distintos. En desarrollo, aceptamos cualquier puerto de
// localhost/127.0.0.1 automaticamente, ademas de CLIENT_URL tal cual
// (util si despliegas el frontend en un dominio real en produccion).
const LOCAL_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * BUG CRITICO CORREGIDO ("failed to fetch" en filtros y en el chat):
 * Antes, cualquier origen que no fuera exactamente "localhost/127.0.0.1"
 * o el valor LITERAL de CLIENT_URL era rechazado con un error, y ese
 * rechazo tambien bloqueaba el preflight (OPTIONS) que el navegador
 * envia automaticamente en CUALQUIER peticion con el header
 * "Authorization" o "Content-Type: application/json" (que es como
 * `apiRequest()` del frontend hace TODAS sus llamadas, incluidas las de
 * busqueda/filtros y las del chat). En cuanto el frontend se abre desde
 * un origen distinto al configurado (otro puerto, otro dominio de
 * despliegue, una IP de red local, etc.) el navegador bloqueaba la
 * respuesta y `fetch()` fallaba con "Failed to fetch", sin llegar
 * siquiera a mostrar el mensaje de error real de la API.
 *
 * Esta API se autentica con JWT Bearer en el header `Authorization`,
 * NO con cookies de sesion, por lo que abrir el CORS no crea riesgo de
 * CSRF (un sitio malicioso no puede "adivinar" ni robar el token de
 * otro usuario solo por poder llamar al API). Por eso:
 *   - Si se define CLIENT_URL en el .env (uno o varios dominios
 *     separados por coma), esos origenes siempre se permiten, mas
 *     cualquier localhost/127.0.0.1 para desarrollo.
 *   - Si NO se define ninguna lista en CLIENT_URL, se permite
 *     cualquier origen (comportamiento "abierto"), para que el portal
 *     funcione sin importar desde donde se sirva el frontend estatico
 *     (Live Server, npx serve, un hosting, una red local, etc.).
 */
const allowedOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Permite peticiones sin origin (Postman, curl, apps moviles, server-to-server)
    if (!origin) return callback(null, true);
    if (LOCAL_ORIGIN_REGEX.test(origin)) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Sin whitelist configurada -> se permite cualquier origen (ver nota arriba)
    if (allowedOrigins.length === 0) return callback(null, true);
    callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(sanitizeRequest);

// Los logs no deben guardar tokens: se ocultan los de /reset-password/:token
morgan.token('safe-url', (req) => req.originalUrl.replace(/(reset-password\/)[^/?]+/, '$1[oculto]'));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(':method :safe-url :status :response-time ms - :res[content-length]'));
}

// Archivos estaticos (fotografias subidas). Solo se sirven imagenes; las
// cabeceras impiden que el navegador "adivine" otro tipo de contenido o
// ejecute algo, aunque alguien lograra subir un archivo raro.
app.use(
  '/uploads',
  (req, res, next) => {
    if (!/^\/[\w-]+\.(jpe?g|png|webp)$/i.test(req.path)) {
      return res.status(404).end();
    }
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
    next();
  },
  express.static(UPLOAD_DIR, { dotfiles: 'deny', index: false, fallthrough: false })
);

app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'Objetos Perdidos IA API' }));

app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/institutions', institutionRoutes);
app.use('/api/cities', cityRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/messages', messageRoutes);

app.use(notFound);
app.use(errorHandler);

// Solo se conecta y escucha cuando se ejecuta directamente (npm start);
// las pruebas automaticas importan `app` sin abrir un puerto.
if (require.main === module) {
  connectDB();
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`));
}

module.exports = app;