/**
 * ================================================================
 * RECONOCIMIENTO VISUAL CON RED NEURONAL (MobileNetV2)
 * ================================================================
 * Convierte cada foto en una "huella" de 1280 numeros que describe
 * QUE se ve en ella (forma, textura, tipo de objeto), no como esta
 * tomada. Dos fotos de la misma billetera desde angulos o fondos
 * distintos dan huellas muy parecidas; una billetera distinta o unas
 * gafas dan huellas lejanas.
 *
 * Usa MobileNetV2 (red neuronal entrenada con millones de fotos) con
 * TensorFlow.js en el CPU del servidor: no necesita GPU ni pagar una
 * API. El modelo (~14 MB) se descarga una sola vez de los servidores
 * de Google la primera vez que alguien sube una foto.
 *
 * Si el modelo no se puede cargar (sin internet, poca memoria), el
 * sistema sigue funcionando con el analisis basico de color y forma.
 * Para apagarlo: variable de entorno IMAGE_AI=off.
 * ================================================================
 */
const sharp = require('sharp');

const MODEL_URL =
  process.env.IMAGE_MODEL_URL ||
  'https://storage.googleapis.com/tfjs-models/savedmodel/mobilenet_v2_1.0_224/model.json';
const INPUT_SIZE = 224;

let loading = null;

function isEnabled() {
  return process.env.IMAGE_AI !== 'off' && process.env.NODE_ENV !== 'test';
}

function loadModel() {
  if (!isEnabled()) return Promise.resolve(null);
  if (!loading) {
    loading = (async () => {
      const tf = require('@tensorflow/tfjs-core');
      require('@tensorflow/tfjs-backend-cpu');
      const mobilenet = require('@tensorflow-models/mobilenet');
      await tf.setBackend('cpu');
      await tf.ready();
      const started = Date.now();
      const model = await mobilenet.load({ version: 2, alpha: 1.0, modelUrl: MODEL_URL });
      console.log(`🧠 Modelo de vision cargado en ${Date.now() - started} ms`);
      return model;
    })().catch((err) => {
      console.error('No se pudo cargar el modelo de vision (se usara el analisis basico):', err.message);
      loading = null; // se reintenta con la siguiente foto
      return null;
    });
  }
  return loading;
}

/**
 * Devuelve la huella visual de la foto (arreglo de numeros), o [] si
 * el modelo no esta disponible.
 */
async function computeImageEmbedding(imageBuffer) {
  try {
    const model = await loadModel();
    if (!model) return [];
    const tf = require('@tensorflow/tfjs-core');
    const { data } = await sharp(imageBuffer)
      .rotate() // respeta la orientacion de fotos de celular
      .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const embedding = tf.tidy(() => {
      const input = tf.tensor3d(new Int32Array(data), [INPUT_SIZE, INPUT_SIZE, 3], 'int32');
      return model.infer(input, true);
    });
    const values = Array.from(await embedding.data());
    embedding.dispose();
    return values.map((v) => Math.round(v * 10000) / 10000);
  } catch (err) {
    console.error('Error generando huella visual:', err.message);
    return [];
  }
}

/**
 * Similitud coseno entre dos huellas, convertida a una escala de 0 a 1
 * calibrada para fotos de objetos: ~0.45 o menos = objetos distintos
 * (0), ~0.85 o mas = el mismo objeto (1).
 */
const COSINE_DIFFERENT = 0.45;
const COSINE_SAME = 0.85;

function embeddingSimilarity(a = [], b = []) {
  if (!a.length || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return null;
  const cosine = dot / Math.sqrt(na * nb);
  return Math.min(Math.max((cosine - COSINE_DIFFERENT) / (COSINE_SAME - COSINE_DIFFERENT), 0), 1);
}

module.exports = { loadModel, computeImageEmbedding, embeddingSimilarity };
