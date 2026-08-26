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

// Normaliza quitando la barra final, para que "https://midominio.com" y
// "https://midominio.com/" en CLIENT_URL no se traten como origenes distintos.
const normalizeOrigin = (o) => (o || '').replace(/\/+$/, '');
const CLIENT_URL_NORMALIZED = normalizeOrigin(process.env.CLIENT_URL);

app.use(cors({
  origin: (origin, callback) => {
    // Permite peticiones sin origin (Postman, curl, apps moviles)
    if (!origin) return callback(null, true);
    // Cuando el frontend se abre como archivo local (doble clic,
    // protocolo "file://") los navegadores envian el header
    // "Origin: null" (el string literal "null", no ausencia de origen).
    // Sin esto, el chat y el resto de la app fallaban con "Failed to
    // fetch" apenas se probaba el sitio sin un servidor estatico de por medio.
    if (origin === 'null') return callback(null, true);
    if (LOCAL_ORIGIN_REGEX.test(origin)) return callback(null, true);
    if (CLIENT_URL_NORMALIZED && normalizeOrigin(origin) === CLIENT_URL_NORMALIZED) return callback(null, true);
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
