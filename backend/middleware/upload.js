const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|webp/;
  const ok = allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype);
  cb(ok ? null : new Error('Solo se permiten imagenes JPG, PNG o WEBP'), ok);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

/**
 * Envuelve `upload.single('image')` para traducir los errores de Multer
 * (tipo de archivo invalido, archivo muy pesado, etc.) a un mensaje claro
 * en español con status 400, en vez de dejar que caigan como un error 500
 * generico en el errorHandler.
 */
const uploadImage = (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'La imagen supera el tamaño máximo permitido (5MB).' });
    }
    return res.status(400).json({ message: err.message || 'No se pudo procesar la imagen.' });
  });
};

module.exports = upload;
module.exports.uploadImage = uploadImage;
