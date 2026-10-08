/**
 * ================================================================
 * REGLA DE NEGOCIO: ¿CUANDO UNA COINCIDENCIA ES "VALIDA"?
 * ================================================================
 * El motor de IA (services/aiMatching.js) sigue calculando el score
 * exactamente igual que antes (0 a 1). Este modulo solo decide, a partir
 * de ese score, si la coincidencia se muestra al usuario y si habilita la
 * mensajeria entre las dos personas.
 *
 * Regla: una coincidencia es valida SOLO si su porcentaje es ESTRICTAMENTE
 * MAYOR que 70 %.
 *
 *   69 % -> no valida      70 % -> no valida (la condicion es "> 70")
 *   71 % -> valida         80 % -> valida        95 % -> valida
 *
 * El porcentaje se calcula igual que como se muestra en la interfaz
 * (Math.round(score * 100)), para que lo que ve el usuario y lo que decide
 * el backend sean siempre lo mismo: nunca se habilitara un chat para una
 * coincidencia que en pantalla aparezca como "70 %".
 *
 * El umbral es una regla del proyecto, por eso es una constante y no una
 * variable de entorno: asi un valor viejo olvidado en el servidor (por
 * ejemplo MATCH_THRESHOLD=0.90 en Render) no puede cambiarla en silencio.
 * ================================================================
 */
const MATCH_THRESHOLD_PERCENT = 70;

function toPercent(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(Math.max(n, 0), 1) * 100);
}

function isValidMatchScore(score) {
  return toPercent(score) > MATCH_THRESHOLD_PERCENT;
}

/**
 * La mensajeria entre las dos personas se habilita cuando la coincidencia
 * es valida (> 70 %) y ninguna de las partes la ha rechazado.
 */
function isChatEnabled(match) {
  return Boolean(match) && match.status !== 'rechazada' && isValidMatchScore(match.score);
}

if (process.env.MATCH_THRESHOLD && process.env.NODE_ENV !== 'test') {
  console.warn(
    `⚠️  MATCH_THRESHOLD=${process.env.MATCH_THRESHOLD} esta definido en el entorno pero ya no se usa: ` +
      `el umbral de coincidencia es fijo (> ${MATCH_THRESHOLD_PERCENT} %). Puedes borrar esa variable.`
  );
}

module.exports = { MATCH_THRESHOLD_PERCENT, toPercent, isValidMatchScore, isChatEnabled };