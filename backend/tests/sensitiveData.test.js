/**
 * Pruebas de la deteccion de datos personales en mensajes y reportes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectSensitiveData } = require('../utils/sensitiveData');

const types = (text) => detectSensitiveData(text).map((f) => f.type);

test('mensajes normales no generan alertas', () => {
  assert.deepEqual(types('Hola, creo que la billetera es mía. ¿Tiene una foto de un perro adentro?'), []);
  assert.deepEqual(types('La encontré el martes 12 cerca de la cafetería del bloque 3'), []);
  assert.deepEqual(types('Mi billetera es negra, marca Totto, y tenía 2 tarjetas'), []);
});

test('detecta telefonos colombianos', () => {
  assert.ok(types('llámame al 300 123 4567').includes('phone'));
  assert.ok(types('mi cel es +57 3157654321').includes('phone'));
});

test('detecta correos', () => assert.ok(types('escríbeme a juan.perez@gmail.com').includes('email')));
test('detecta redes sociales y enlaces', () => {
  assert.ok(types('búscame en instagram').includes('social'));
  assert.ok(types('https://wa.me/573001234567').includes('social'));
});
test('detecta direcciones', () => assert.ok(types('vivo en la calle 45 # 12-30').includes('address')));
test('detecta numeros de documento', () => assert.ok(types('mi cédula es 1.098.765.432').includes('id_document')));
test('detecta contraseñas o codigos', () => {
  assert.ok(types('mi contraseña es Perro123').includes('credential'));
  assert.ok(types('el código de verificación: 482913').includes('credential'));
});

test('bloquea numeros de tarjeta validos (Luhn)', () => {
  const f = detectSensitiveData('mi tarjeta es 4111 1111 1111 1111');
  assert.ok(f.some((x) => x.type === 'card' && x.severity === 'block'));
});
test('no confunde numeros largos aleatorios con tarjetas', () => {
  assert.ok(!detectSensitiveData('referencia 1234 5678 9012 3456').some((x) => x.type === 'card'));
});