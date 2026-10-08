/**
 * ================================================================
 * CARGA SEGURA DE IMAGENES
 * ================================================================
 * Antes: multer guardaba el archivo directamente en disco usando la
 * extension que mandaba el usuario, validando solo la extension y el
 * mimetype (ambos los controla el cliente y se pueden falsificar).
 *
 * Ahora el archivo pasa por estas capas antes de tocar el disco:
 *   1. Limites de multer: 1 archivo, maximo 5 MB, pocos campos.
 *   2. Filtro previo por extension y mimetype declarados (rapido).
 *   3. Se mantiene en MEMORIA (no en disco) mientras se valida.
 *   4. Se inspecciona el CONTENIDO real con sharp: debe ser de verdad un
 *      JPEG, PNG o WEBP, con dimensiones razonables (evita "bombas de
 *      descompresion" de millones de pixeles).
 *   5. Se RE-CODIFICA la imagen con sharp: el archivo que se guarda es una
 *      imagen nueva generada por el servidor, sin metadatos EXIF (que
 *      pueden incluir la ubicacion GPS exacta de quien tomo la foto) y sin
 *      ningun contenido extra que el usuario haya escondido en el archivo.
 *   6. Se guarda con un nombre aleatorio (UUID) y una extension decidida
 *      por el servidor segun el formato real, nunca la del usuario.
 *
 * El motor de IA sigue recibiendo los bytes ORIGINALES de la foto
 * (req.file.buffer), exactamente como antes, para que el hash perceptual
 * y el perfil de color se calculen de la misma forma.
 * ================================================================
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_PIXELS = 40 * 1000 * 1000; // 40 megapixeles
const MAX_DIMENSION = 10000;

const ALLOWED_EXT = /\.(jpe?g|png|webp)$/i;
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/webp'];
const FORMAT_TO_EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 20, fieldSize: 10 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ALLOWED_EXT.test(file.originalname || '') && ALLOWED_MIME.includes(file.mimetype);
    cb(ok ? null : new Error('Solo se permiten imágenes JPG, PNG o WEBP.'), ok);
  },
});

/**
 * Valida el contenido real de la imagen, la re-codifica sin metadatos y la
 * escribe en disco. Completa req.file.path / req.file.filename como antes.
 */
async function processImage(file) {
  let metadata;
  try {
    metadata = await sharp(file.buffer, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch (err) {
    throw new Error('El archivo no es una imagen válida o está dañado.');
  }

  const ext = FORMAT_TO_EXT[metadata.format];
  if (!ext) throw new Error('Solo se permiten imágenes JPG, PNG o WEBP.');
  if (!metadata.width || !metadata.height || metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
    throw new Error('Las dimensiones de la imagen no son válidas.');
  }

  let pipeline = sharp(file.buffer, { limitInputPixels: MAX_PIXELS }).rotate(); // respeta la orientacion y descarta EXIF
  if (ext === 'jpg') pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
  if (ext === 'png') pipeline = pipeline.png({ compressionLevel: 9 });
  if (ext === 'webp') pipeline = pipeline.webp({ quality: 85 });
  const output = await pipeline.toBuffer();

  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${crypto.randomUUID()}.${ext}`;
  const fullPath = path.join(UPLOAD_DIR, filename);
  await fs.promises.writeFile(fullPath, output, { mode: 0o644, flag: 'wx' });

  file.filename = filename;
  file.path = fullPath;
  file.size = output.length;
  file.mimetype = `image/${metadata.format}`;
  file.detectedFormat = metadata.format;
}

/**
 * Envuelve `upload.single('image')` para traducir los errores de Multer
 * (tipo de archivo invalido, archivo muy pesado, etc.) a un mensaje claro
 * en español con status 400, en vez de dejar que caigan como un error 500
 * generico en el errorHandler.
 */
const uploadImage = (req, res, next) => {
  upload.single('image')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'La imagen supera el tamaño máximo permitido (5MB).' });
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ message: 'Solo se permite subir una imagen en el campo "image".' });
      }
      return res.status(400).json({ message: err.message || 'No se pudo procesar la imagen.' });
    }
    if (!req.file) return next();

    try {
      await processImage(req.file);
      return next();
    } catch (processErr) {
      return res.status(400).json({ message: processErr.message || 'No se pudo procesar la imagen.' });
    }
  });
};

/** Borra de forma segura un archivo subido (solo dentro de la carpeta uploads). */
function removeUploadedFile(filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(UPLOAD_DIR + path.sep)) return;
  fs.promises.unlink(resolved).catch(() => {});
}

module.exports = upload;
module.exports.uploadImage = uploadImage;
module.exports.removeUploadedFile = removeUploadedFile;
module.exports.UPLOAD_DIR = UPLOAD_DIR;