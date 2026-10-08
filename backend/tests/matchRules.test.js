/**
 * Pruebas del umbral de coincidencia (> 70 %).
 */
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidMatchScore, isChatEnabled, toPercent, MATCH_THRESHOLD_PERCENT } = require('../utils/matchRules');
const { THRESHOLD } = require('../services/aiMatching');

test('el umbral configurado es 70 % estricto', () => {
  assert.equal(MATCH_THRESHOLD_PERCENT, 70);
  assert.equal(THRESHOLD, 0.7);
});

test('69 % -> no es coincidencia valida', () => assert.equal(isValidMatchScore(0.69), false));
test('70 % -> no es coincidencia valida (condicion estricta > 70)', () => assert.equal(isValidMatchScore(0.7), false));
test('70,4 % (se muestra como 70 %) -> no es valida', () => {
  assert.equal(toPercent(0.704), 70);
  assert.equal(isValidMatchScore(0.704), false);
});
test('71 % -> coincidencia valida', () => assert.equal(isValidMatchScore(0.71), true));
test('80 % -> coincidencia valida', () => assert.equal(isValidMatchScore(0.8), true));
test('95 % -> coincidencia valida', () => assert.equal(isValidMatchScore(0.95), true));
test('valores invalidos nunca son coincidencia', () => {
  assert.equal(isValidMatchScore(undefined), false);
  assert.equal(isValidMatchScore('abc'), false);
  assert.equal(isValidMatchScore(-1), false);
});

test('el chat se habilita solo con coincidencia valida y no rechazada', () => {
  assert.equal(isChatEnabled({ score: 0.69, status: 'sugerida' }), false);
  assert.equal(isChatEnabled({ score: 0.7, status: 'sugerida' }), false);
  assert.equal(isChatEnabled({ score: 0.71, status: 'sugerida' }), true);
  assert.equal(isChatEnabled({ score: 0.95, status: 'confirmada_usuario' }), true);
  assert.equal(isChatEnabled({ score: 0.95, status: 'rechazada' }), false);
});