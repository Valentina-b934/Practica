/**
 * ================================================================
 * MOTOR DE COINCIDENCIAS DE IA (orquestador)
 * ================================================================
 * Calcula la similitud entre un objeto "perdido" y uno "encontrado"
 * evaluando POR SEPARADO seis caracteristicas, para que el resultado
 * sea explicable (no una caja negra) y mas preciso que una simple
 * bolsa de palabras:
 *
 *   1. Categoria    -> misma categoria exacta (mochila, celular...)
 *   2. Ubicacion     -> misma ciudad + similitud del lugar especifico
 *   3. Color         -> similitud de texto del campo "color"
 *   4. Marca         -> similitud de texto del campo "marca"
 *   5. Descripcion   -> similitud semantica de titulo+descripcion+lugar
 *   6. Imagen        -> huella visual de la fotografia (si existe)
 *
 * Si no hay fotografia en alguno de los dos reportes, su peso se
 * redistribuye entre las demas caracteristicas en vez de penalizar
 * (un objeto perdido sin foto SI puede coincidir con uno encontrado
 * que si tiene foto, apoyandose en texto+categoria+color+marca+lugar).
 *
 * Si la categoria no coincide se aplica una penalizacion moderada
 * (no total, porque dos personas distintas a veces clasifican el
 * mismo objeto en categorias distintas, ej: una billetera con
 * documentos podria caer en "Documentos" o en "Billeteras y dinero").
 * ================================================================
 */
const Item = require('../models/Item');
const Match = require('../models/Match');
const Notification = require('../models/Notification');
const { cosineSimilarity, fieldSimilarity } = require('./textAnalysis');
const { imageSimilarity } = require('./imageAnalysis');

// Umbral por defecto: 0.90 (90%), tal como lo exige la regla de negocio del
// proyecto ("cuando la IA encuentre mas de un 90% de similitud entre las
// caracteristicas de imagen y descripcion, notificar al usuario").
// Se puede ajustar por entorno (MATCH_THRESHOLD en .env) sin tocar codigo.
const THRESHOLD = parseFloat(process.env.MATCH_THRESHOLD || '0.90');

const WEIGHTS_WITH_IMAGE = { text: 0.22, image: 0.25, category: 0.13, color: 0.10, brand: 0.10, location: 0.20 };
const WEIGHTS_WITHOUT_IMAGE = { text: 0.30, category: 0.18, color: 0.14, brand: 0.13, location: 0.25 };
const CATEGORY_MISMATCH_PENALTY = 0.8; // penalizacion moderada, no descarta el match por si sola

/**
 * Similitud de ubicacion: 100% si es la misma ciudad, mas un
 * componente de texto libre comparando el campo "lugar" (ej: "Terminal
 * de transporte" vs "Terminal de Bucaramanga"). Si son ciudades
 * distintas, el resultado baja bastante pero no llega a cero (por si
 * el objeto viajo entre ciudades, ej. equipaje en un bus/avion).
 */
function locationSimilarity(itemA, itemB) {
  const sameCity = String(itemA.city) === String(itemB.city);
  const placeScore = fieldSimilarity(itemA.place, itemB.place);
  return sameCity ? 0.7 + placeScore * 0.3 : placeScore * 0.4;
}

function calculateScore(itemA, itemB) {
  const textScore = cosineSimilarity(itemA.textVector, itemB.textVector);
  const colorScore = fieldSimilarity(itemA.color, itemB.color);
  const brandScore = fieldSimilarity(itemA.brand, itemB.brand);
  const locationScore = locationSimilarity(itemA, itemB);
  const sameCategory = String(itemA.category) === String(itemB.category);

  const hasImages = Boolean(itemA.imageHash && itemB.imageHash);
  const imgScore = hasImages ? imageSimilarity(itemA, itemB) : 0;

  const w = hasImages ? WEIGHTS_WITH_IMAGE : WEIGHTS_WITHOUT_IMAGE;

  let base =
    textScore * w.text +
    (sameCategory ? 1 : 0) * w.category +
    colorScore * w.color +
    brandScore * w.brand +
    locationScore * w.location +
    (hasImages ? imgScore * w.image : 0);

  if (!sameCategory) base *= CATEGORY_MISMATCH_PENALTY;

  return {
    score: Math.min(Math.max(base, 0), 1),
    textScore,
    imageScore: imgScore,
    colorScore,
    brandScore,
    locationScore,
    categoryMatch: sameCategory,
  };
}

/**
 * Busca coincidencias para un item recien creado contra todos los
 * items "opuestos" (perdido <-> encontrado) activos, en cualquier
 * ciudad (se prioriza la misma ciudad pero no se restringe, por si
 * el objeto viajo entre ciudades).
 */
async function findMatchesForItem(newItem) {
  const oppositeType = newItem.type === 'perdido' ? 'encontrado' : 'perdido';

  const candidates = await Item.find({
    type: oppositeType,
    status: { $in: ['activo', 'con_coincidencias'] },
    'moderation.status': 'aprobado',
  });

  const createdMatches = [];

  for (const candidate of candidates) {
    const { score, textScore, imageScore, colorScore, brandScore, locationScore, categoryMatch } = calculateScore(newItem, candidate);
    if (score >= THRESHOLD) {
      const lostItem = newItem.type === 'perdido' ? newItem : candidate;
      const foundItem = newItem.type === 'encontrado' ? newItem : candidate;

      try {
        const match = await Match.findOneAndUpdate(
          { lostItem: lostItem._id, foundItem: foundItem._id },
          { score, textScore, imageScore, colorScore, brandScore, locationScore, categoryMatch },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        createdMatches.push(match);

        // Notificar a ambos usuarios involucrados
        const lostItemFull = await Item.findById(lostItem._id).populate('user');
        const foundItemFull = await Item.findById(foundItem._id).populate('user');

        await Notification.create({
          user: lostItemFull.user._id,
          type: 'coincidencia',
          title: 'Posible coincidencia encontrada',
          message: `Encontramos un objeto encontrado que coincide en un ${Math.round(score * 100)}% con tu reporte "${lostItemFull.title}".`,
          relatedItem: foundItemFull._id,
          relatedMatch: match._id,
        });

        await Notification.create({
          user: foundItemFull.user._id,
          type: 'coincidencia',
          title: 'Posible coincidencia encontrada',
          message: `El objeto que reportaste "${foundItemFull.title}" podria coincidir con un reporte de perdida (${Math.round(score * 100)}%).`,
          relatedItem: lostItemFull._id,
          relatedMatch: match._id,
        });
      } catch (err) {
        // Evita fallos si el match ya existia (race condition)
        console.error('Error creando match:', err.message);
      }
    }
  }

  if (createdMatches.length > 0) {
    await Item.findByIdAndUpdate(newItem._id, { status: 'con_coincidencias' });
  }

  return createdMatches;
}

/**
 * Reescanea TODOS los reportes existentes y vuelve a calcular sus
 * coincidencias con el algoritmo actual. Util cuando se ajustan los
 * pesos del motor de IA (como ahora) y hay reportes viejos que nunca
 * llegaron a compararse con la formula nueva, ya que el calculo solo
 * se dispara automaticamente al CREAR un reporte.
 */
async function rescanAllMatches() {
  const items = await Item.find({ 'moderation.status': 'aprobado' });
  let totalNewMatches = 0;
  for (const item of items) {
    const matches = await findMatchesForItem(item);
    totalNewMatches += matches.length;
  }
  return { itemsScanned: items.length, matchesEvaluated: totalNewMatches };
}

module.exports = { calculateScore, findMatchesForItem, rescanAllMatches, THRESHOLD };
