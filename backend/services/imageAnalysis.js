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
const { embeddingSimilarity } = require('./visualModel');

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
 * Color del OBJETO (no de la foto completa).
 * Antes se usaba el color dominante de toda la imagen, y el fondo
 * (una mesa de madera, una pared gris) pesaba mas que el objeto: dos
 * fotos del mismo objeto sobre fondos distintos salian "diferentes" y
 * una billetera negra sobre madera salia "parecida" a una cafe.
 *
 * Ahora se estima el color del fondo con el borde de la foto y se
 * promedian solo los pixeles que se diferencian de el (el objeto,
 * que casi siempre esta en el centro). Si no se logra separar, se
 * usa el centro de la imagen. Devuelve [r, g, b] entre 0 y 1.
 */
const SEG_SIZE = 64;
const SEG_BORDER = 4;

async function computeColorProfile(imageBuffer) {
  try {
    const { data } = await sharp(imageBuffer)
      .rotate() // respeta la orientacion EXIF de fotos de celular
      .resize(SEG_SIZE, SEG_SIZE, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixel = (x, y) => {
      const i = (y * SEG_SIZE + x) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const isBorder = (x, y) =>
      x < SEG_BORDER || y < SEG_BORDER || x >= SEG_SIZE - SEG_BORDER || y >= SEG_SIZE - SEG_BORDER;

    // 1) Color promedio del fondo (borde de la foto)
    const border = [];
    for (let y = 0; y < SEG_SIZE; y++) {
      for (let x = 0; x < SEG_SIZE; x++) if (isBorder(x, y)) border.push(pixel(x, y));
    }
    const bg = [0, 1, 2].map((c) => border.reduce((s, v) => s + v[c], 0) / border.length);
    const dist = (v) => Math.hypot(v[0] - bg[0], v[1] - bg[1], v[2] - bg[2]);

    // 2) Umbral: lo que se aleja del fondo mas que el 95 % del propio borde
    const borderDist = border.map(dist).sort((a, b) => a - b);
    const threshold = Math.max(40, borderDist[Math.floor(borderDist.length * 0.95)] * 1.2);

    // 3) Promedio de los pixeles del objeto
    let count = 0;
    const sum = [0, 0, 0];
    for (let y = 0; y < SEG_SIZE; y++) {
      for (let x = 0; x < SEG_SIZE; x++) {
        const v = pixel(x, y);
        if (dist(v) > threshold) {
          count++;
          for (let c = 0; c < 3; c++) sum[c] += v[c];
        }
      }
    }

    const share = count / (SEG_SIZE * SEG_SIZE);
    if (share >= 0.03 && share <= 0.95) return sum.map((v) => v / count / 255);

    // No se pudo separar objeto y fondo: se usa el centro de la foto
    const center = [0, 0, 0];
    let n = 0;
    for (let y = SEG_SIZE / 4; y < (SEG_SIZE * 3) / 4; y++) {
      for (let x = SEG_SIZE / 4; x < (SEG_SIZE * 3) / 4; x++) {
        const v = pixel(x, y);
        n++;
        for (let c = 0; c < 3; c++) center[c] += v[c];
      }
    }
    return center.map((v) => v / n / 255);
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
 * Que tan parecido es el color de dos objetos, con una escala mas
 * exigente que `colorSimilarity`: cafe vs cafe ~0.95, cafe vs negro
 * ~0.5, cafe vs azul ~0.
 */
const OBJECT_COLOR_SCALE = 0.47; // ~120 de 255 en distancia RGB

function objectColorSimilarity(colorA = [], colorB = []) {
  if (colorA.length !== 3 || colorB.length !== 3) return 0;
  const dist = Math.hypot(colorA[0] - colorB[0], colorA[1] - colorB[1], colorA[2] - colorB[2]);
  return Math.max(0, 1 - dist / OBJECT_COLOR_SCALE);
}

/**
 * Similitud visual combinada.
 * - Si las dos fotos tienen huella de la red neuronal: 75 % red
 *   neuronal (reconoce el mismo objeto aunque cambie el angulo o el
 *   fondo) + 25 % color del objeto.
 * - Si no (reportes viejos o modelo no disponible): 80 % color del
 *   objeto + 20 % forma (hash).
 */
function imageSimilarity(itemA, itemB) {
  if (!itemA.imageHash || !itemB.imageHash) return 0;
  const colorSim = objectColorSimilarity(itemA.imageColorProfile, itemB.imageColorProfile);
  const neural = embeddingSimilarity(itemA.imageEmbedding, itemB.imageEmbedding);
  if (neural !== null) return neural * 0.75 + colorSim * 0.25;
  const hashSim = hashSimilarity(itemA.imageHash, itemB.imageHash);
  return colorSim * 0.8 + hashSim * 0.2;
}

/**
 * Nombres de colores en español -> RGB (0-255). Permite comparar el
 * color ESCRITO en un reporte ("cafe") con el color de la FOTO del
 * otro reporte, cuando quien lo encontro no escribio el color.
 */
const NAMED_COLORS = {
  negro: [30, 30, 30], negra: [30, 30, 30],
  blanco: [235, 235, 235], blanca: [235, 235, 235],
  gris: [128, 128, 128], plateado: [190, 190, 195], plateada: [190, 190, 195], plata: [190, 190, 195],
  cafe: [100, 62, 35], marron: [100, 62, 35], chocolate: [90, 55, 30], miel: [175, 120, 60], camel: [175, 125, 75],
  beige: [215, 195, 160], crema: [225, 210, 175], hueso: [225, 215, 195],
  rojo: [190, 30, 35], roja: [190, 30, 35], vinotinto: [100, 20, 35], vino: [100, 20, 35],
  rosado: [235, 140, 170], rosada: [235, 140, 170], rosa: [235, 140, 170], fucsia: [210, 40, 130],
  naranja: [235, 120, 30], amarillo: [235, 205, 40], amarilla: [235, 205, 40], dorado: [200, 165, 60], dorada: [200, 165, 60],
  verde: [40, 140, 60], azul: [40, 80, 170], celeste: [120, 180, 225], turquesa: [40, 175, 175],
  morado: [110, 50, 140], morada: [110, 50, 140], lila: [180, 150, 210], violeta: [130, 70, 170],
};
const NAMED_COLOR_SCALE = 0.45; // mas tolerante: la luz de la foto cambia el tono

function namedColorToRgb(text) {
  const words = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z]+/);
  for (const w of words) {
    if (NAMED_COLORS[w]) {
      let rgb = NAMED_COLORS[w].map((v) => v / 255);
      if (words.includes('oscuro') || words.includes('oscura')) rgb = rgb.map((v) => v * 0.6);
      if (words.includes('claro') || words.includes('clara')) rgb = rgb.map((v) => v + (1 - v) * 0.4);
      return rgb;
    }
  }
  return null;
}

/**
 * Compara un color escrito con el color del objeto en una foto.
 * Devuelve null si el texto no tiene un color conocido.
 */
function namedColorSimilarity(colorText, colorProfile = []) {
  const rgb = namedColorToRgb(colorText);
  if (!rgb || colorProfile.length !== 3) return null;
  const dist = Math.hypot(rgb[0] - colorProfile[0], rgb[1] - colorProfile[1], rgb[2] - colorProfile[2]);
  return Math.max(0, 1 - dist / NAMED_COLOR_SCALE);
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
  objectColorSimilarity,
  namedColorSimilarity,
  isSameImage,
  DUPLICATE_IMAGE_THRESHOLD,
};
