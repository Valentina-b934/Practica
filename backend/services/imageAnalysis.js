/**
 * ================================================================
 * SERVICIO DE ANALISIS DE IMAGENES (IA - VISION POR COMPUTADOR)
 * ================================================================
 * Genera una "huella digital" visual de cada fotografia mediante:
 *   1) Perceptual Hash (pHash): resiste cambios de tamaño, compresion
 *      y pequeñas variaciones de brillo. Permite saber si dos fotos
 *      corresponden a un objeto muy similar visualmente.
 *   2) Histograma de color simplificado (perfil de color dominante):
 *      ayuda a comparar el color general del objeto.
 *
 * No requiere servicios externos ni GPU: usa `sharp` para procesar
 * la imagen localmente, lo cual hace el sistema rapido y economico.
 * (Este modulo puede sustituirse por un modelo tipo CLIP o la API de
 * vision de un proveedor de IA sin cambiar el resto del sistema,
 * ya que expone las mismas dos funciones).
 * ================================================================
 */
const sharp = require('sharp');

const HASH_SIZE = 16; // genera un hash de 16x16 = 256 bits

/**
 * Calcula un pHash simplificado tipo dHash (difference hash):
 * compara pixeles adyacentes en escala de grises.
 */
async function computeImageHash(imageBuffer) {
  try {
    const { data } = await sharp(imageBuffer)
      .resize(HASH_SIZE + 1, HASH_SIZE, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let hash = '';
    for (let y = 0; y < HASH_SIZE; y++) {
      for (let x = 0; x < HASH_SIZE; x++) {
        const idx = y * (HASH_SIZE + 1) + x;
        hash += data[idx] < data[idx + 1] ? '1' : '0';
      }
    }
    return hash; // string binaria de 256 caracteres
  } catch (err) {
    console.error('Error generando hash de imagen:', err.message);
    return '';
  }
}

/**
 * Calcula un histograma de color muy simplificado (8 buckets por canal RGB)
 * para comparar el color dominante del objeto.
 */
async function computeColorProfile(imageBuffer) {
  try {
    const { dominant } = await sharp(imageBuffer).stats().then((s) => ({ dominant: s.dominant }));
    return [dominant.r / 255, dominant.g / 255, dominant.b / 255];
  } catch (err) {
    console.error('Error generando perfil de color:', err.message);
    return [0, 0, 0];
  }
}

/**
 * Distancia de Hamming entre dos hashes binarios (menor = mas parecidas).
 * Se convierte a una similitud entre 0 y 1.
 */
function hashSimilarity(hashA, hashB) {
  if (!hashA || !hashB || hashA.length !== hashB.length) return 0;
  let diff = 0;
  for (let i = 0; i < hashA.length; i++) {
    if (hashA[i] !== hashB[i]) diff++;
  }
  return 1 - diff / hashA.length;
}

function colorSimilarity(colorA = [], colorB = []) {
  if (!colorA.length || !colorB.length) return 0;
  const dist = Math.sqrt(
    colorA.reduce((sum, v, i) => sum + (v - (colorB[i] || 0)) ** 2, 0)
  );
  const maxDist = Math.sqrt(3); // distancia maxima posible en [0,1]^3
  return 1 - dist / maxDist;
}

/**
 * Similitud visual combinada: 70% forma/textura (hash) + 30% color.
 */
function imageSimilarity(itemA, itemB) {
  if (!itemA.imageHash || !itemB.imageHash) return 0;
  const hashSim = hashSimilarity(itemA.imageHash, itemB.imageHash);
  const colorSim = colorSimilarity(itemA.imageColorProfile, itemB.imageColorProfile);
  return hashSim * 0.7 + colorSim * 0.3;
}

/**
 * ------------------------------------------------------------------
 * DETECCION DE FOTOGRAFIA DUPLICADA (seguridad anti-fraude)
 * ------------------------------------------------------------------
 * Esto es DISTINTO de `imageSimilarity` (que se usa para el motor de
 * coincidencias con un umbral moderado, ~80%, para sugerir que dos
 * fotos DIFERENTES probablemente muestran el mismo objeto).
 *
 * Aqui el umbral es deliberadamente muy alto: solo debe activarse
 * cuando la fotografia es, en la practica, LA MISMA imagen (el mismo
 * archivo, o una copia recomprimida/redimensionada de el), no cuando
 * dos personas distintas fotografiaron el mismo objeto desde angulos
 * o momentos distintos. Sirve para bloquear el caso de alguien que
 * reutiliza la foto de un reporte "perdido" para publicar un reporte
 * "encontrado" falso (o viceversa) e intentar simular una coincidencia
 * fraudulenta, sin afectar en nada el matching normal por similitud.
 */
const DUPLICATE_IMAGE_THRESHOLD = parseFloat(process.env.DUPLICATE_IMAGE_THRESHOLD || '0.98');
const DUPLICATE_COLOR_THRESHOLD = 0.95;

function isSameImage(hashA, colorA, hashB, colorB) {
  if (!hashA || !hashB) return false;
  const hSim = hashSimilarity(hashA, hashB);
  if (hSim < DUPLICATE_IMAGE_THRESHOLD) return false;
  const cSim = colorSimilarity(colorA, colorB);
  return cSim >= DUPLICATE_COLOR_THRESHOLD;
}

module.exports = {
  computeImageHash,
  computeColorProfile,
  imageSimilarity,
  hashSimilarity,
  colorSimilarity,
  isSameImage,
  DUPLICATE_IMAGE_THRESHOLD,
};
