/**
 * ================================================================
 * SERVICIO DE ANALISIS DE TEXTO (IA - PLN)
 * ================================================================
 * Convierte la descripcion + titulo + color + marca de un objeto en
 * un "vector" de palabras clave ponderadas (TF), y permite comparar
 * dos vectores mediante similitud coseno. Tambien usa distancia de
 * Jaro-Winkler (via la libreria `natural`) para detectar coincidencias
 * de palabras con errores de tipeo (ej: "mochila" vs "mochilla").
 * ================================================================
 */
const natural = require('natural');
const tokenizer = new natural.WordTokenizer();

// Palabras vacias en español que no aportan significado al comparar
const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
  'y', 'o', 'en', 'con', 'por', 'para', 'que', 'se', 'su', 'sus', 'mi', 'mis',
  'lo', 'es', 'era', 'fue', 'a', 'ante', 'bajo', 'como', 'muy', 'esta', 'este',
  'esa', 'ese', 'me', 'tengo', 'tenia', 'perdi', 'encontre', 'objeto',
]);

/**
 * BUG CRITICO CORREGIDO:
 * `Item.textVector` esta declarado en el schema como `type: Map`. Cuando
 * Mongoose devuelve un documento, ese campo NO es un objeto plano de JS:
 * es una instancia de `Map` (mongoose.Types.Map, que hereda del Map
 * nativo de JS). `Object.keys(unMapNativo)` SIEMPRE devuelve un arreglo
 * vacio, porque las entradas de un Map no son propiedades enumerables del
 * objeto. Por eso `cosineSimilarity` recibia vectores "vacios" para
 * cualquier item leido de la base de datos y el texto nunca aportaba
 * similitud (quedaba en 0), sin importar que tan parecidas fueran las
 * descripciones. Esta funcion normaliza ambos casos (Map o Object plano)
 * a un objeto plano antes de compararlos.
 */
function toPlainObject(vector) {
  if (!vector) return {};
  if (vector instanceof Map) return Object.fromEntries(vector);
  return vector;
}

function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/[^a-z0-9\s]/g, ' ');
}

/**
 * Construye el vector de texto SOLO con lenguaje libre (titulo,
 * descripcion, lugar). El color y la marca se evaluan aparte con
 * `fieldSimilarity`, como caracteristicas estructuradas, para que
 * el motor de coincidencias pueda explicar "por que" dos objetos
 * se parecen (texto, color, marca, categoria, imagen) en vez de
 * mezclar todo en una sola bolsa de palabras.
 */
function buildTextVector(item) {
  const raw = [item.title, item.description, item.place].filter(Boolean).join(' ');

  const tokens = tokenizer
    .tokenize(normalizeText(raw))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

  const vector = {};
  tokens.forEach((t) => {
    vector[t] = (vector[t] || 0) + 1;
  });

  // Normalizacion TF (frecuencia relativa)
  const total = tokens.length || 1;
  Object.keys(vector).forEach((k) => (vector[k] = vector[k] / total));

  return vector;
}

/**
 * Compara un campo corto y estructurado (color, marca) entre dos
 * objetos. Usa Jaro-Winkler por palabra para tolerar sinonimos
 * cercanos y errores de tipeo ("negro" vs "negra", "azul oscuro"
 * vs "azul"). Si a alguno de los dos objetos le falta el dato,
 * devuelve un valor NEUTRAL (0.5) en vez de castigar la coincidencia,
 * ya que la ausencia de un dato no significa que sean distintos.
 */
function fieldSimilarity(valueA, valueB) {
  const a = normalizeText(valueA).trim();
  const b = normalizeText(valueB).trim();

  if (!a || !b) return 0.5; // dato no diligenciado por alguna de las partes

  if (a === b) return 1;

  const wordsA = a.split(/\s+/).filter(Boolean);
  const wordsB = b.split(/\s+/).filter(Boolean);

  let bestTotal = 0;
  wordsA.forEach((wa) => {
    let best = 0;
    wordsB.forEach((wb) => {
      best = Math.max(best, natural.JaroWinklerDistance(wa, wb));
    });
    bestTotal += best;
  });

  return Math.min(bestTotal / wordsA.length, 1);
}

/**
 * Similitud coseno entre dos vectores de palabras, con tolerancia
 * a variaciones ortograficas (fuzzy match) usando Jaro-Winkler.
 */
function cosineSimilarity(vecA = {}, vecB = {}) {
  vecA = toPlainObject(vecA);
  vecB = toPlainObject(vecB);
  const keysA = Object.keys(vecA);
  const keysB = Object.keys(vecB);
  if (keysA.length === 0 || keysB.length === 0) return 0;

  let dot = 0;
  keysA.forEach((wa) => {
    let bestMatchWeight = 0;
    keysB.forEach((wb) => {
      const similarityWord = wa === wb ? 1 : natural.JaroWinklerDistance(wa, wb);
      if (similarityWord > 0.9) {
        bestMatchWeight = Math.max(bestMatchWeight, vecB[wb] * similarityWord);
      }
    });
    dot += vecA[wa] * bestMatchWeight;
  });

  const magA = Math.sqrt(keysA.reduce((s, k) => s + vecA[k] ** 2, 0));
  const magB = Math.sqrt(keysB.reduce((s, k) => s + vecB[k] ** 2, 0));
  if (magA === 0 || magB === 0) return 0;

  const sim = dot / (magA * magB);
  return Math.min(Math.max(sim, 0), 1);
}

module.exports = { buildTextVector, cosineSimilarity, normalizeText, fieldSimilarity, toPlainObject };
