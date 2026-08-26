const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const morgan = require('morgan');

dotenv.config();

const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const itemRoutes = require('./routes/itemRoutes');
const matchRoutes = require('./routes/matchRoutes');
const institutionRoutes = require('./routes/institutionRoutes');
const cityRoutes = require('./routes/cityRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const adminRoutes = require('./routes/adminRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const messageRoutes = require('./routes/messageRoutes');

connectDB();

const app = express();

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Archivos estaticos (fotografias subidas)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`));
