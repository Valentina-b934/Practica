/**
 * Pruebas de reportes, carga de imagenes, privacidad, permisos (IDOR),
 * umbral de coincidencia en la mensajeria, anti-spam y regresion del flujo
 * completo con la IA existente.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('./helpers');

helpers.configureEnv({ OTP_RESEND_COOLDOWN_SECONDS: '1', OTP_MAX_SENDS_PER_WINDOW: '50' });

const request = require('supertest');

let app;
let smtp;
let db;
let models;
let cityId;
let categories;

async function createSession(email, name) {
  const reg = await request(app).post('/api/auth/register').send({ name, email, password: 'Clave1234', city: cityId, phone: '3001234567' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const code = helpers.extractOtp(smtp.lastTo(email));
  const ver = await request(app).post('/api/auth/verify-otp').send({ challengeId: reg.body.challengeId, code });
  assert.equal(ver.status, 200);
  return { token: ver.body.token, id: ver.body._id, email };
}

const auth = (s) => ({ Authorization: `Bearer ${s.token}` });

function reportRequest(session, type, fields, image, filename = 'foto.png') {
  const req = request(app).post(`/api/items/${type}`).set(auth(session));
  for (const [k, v] of Object.entries(fields)) req.field(k, v);
  if (image) req.attach('image', image, filename);
  return req;
}

const baseFields = () => ({
  title: 'Billetera negra de cuero',
  description: 'Billetera negra de cuero con costura café y un llavero pequeño',
  color: 'negro',
  brand: 'Velez',
  place: 'Biblioteca central',
  date: new Date().toISOString().slice(0, 10),
  city: cityId,
  category: String(categories.Billeteras),
});

/** Crea directamente una coincidencia con un score dado entre dos usuarios. */
async function makeMatch(lostUser, foundUser, score) {
  const { Item, Match } = models;
  const common = { city: cityId, category: categories.Billeteras, description: 'objeto de prueba', date: new Date() };
  const lost = await Item.create({ ...common, type: 'perdido', user: lostUser.id, title: `perdido ${score}` });
  const found = await Item.create({ ...common, type: 'encontrado', user: foundUser.id, title: `encontrado ${score}` });
  return Match.create({ lostItem: lost._id, foundItem: found._id, score });
}

describe('Reportes, coincidencias y mensajería', () => {
  let ana; // pierde
  let beto; // encuentra
  let caro; // externa

  before(async () => {
    smtp = await helpers.startSmtpServer();
    db = await helpers.connectTestDb();
    app = require('../server');
    models = {
      City: require('../models/City'),
      Category: require('../models/Category'),
      Item: require('../models/Item'),
      Match: require('../models/Match'),
      Message: require('../models/Message'),
    };
    const city = await models.City.create({ name: 'Bucaramanga', department: 'Santander' });
    cityId = String(city._id);

    // Categorias "antiguas" para probar la migracion
    await models.Category.create({ name: 'Billeteras y dinero', icon: 'bi-wallet2' });
    const pets = await models.Category.create({ name: 'Mascotas', icon: 'bi-heart' });
    await models.Category.create({ name: 'Llaves', icon: 'bi-key' });
    const tmpUser = new (require('mongoose').Types.ObjectId)();
    await models.Item.create({ type: 'perdido', user: tmpUser, city: cityId, category: pets._id, title: 'Perro', description: 'perro perdido', date: new Date() });

    const { migrateCategories } = require('../seed/migrateCategories');
    await migrateCategories({ log: () => {} });
    categories = Object.fromEntries((await models.Category.find({ active: true })).map((c) => [c.name, c._id]));

    ana = await createSession('ana@test.co', 'Ana María Torres');
    beto = await createSession('beto@test.co', 'Beto Ruiz');
    caro = await createSession('caro@test.co', 'Carolina Díaz');
  });

  after(async () => {
    await db.drop();
    await smtp.close();
  });

  describe('categorías', () => {
    it('solo quedan activas las 5 categorías oficiales', async () => {
      const r = await request(app).get('/api/categories');
      assert.deepEqual(r.body.map((c) => c.name).sort(), ['Billeteras', 'Carteras', 'Dispositivos', 'Documentos', 'Gafas']);
    });
    it('la migración renombra (conserva el _id) en vez de duplicar', async () => {
      assert.equal(await models.Category.countDocuments({ name: 'Billeteras y dinero' }), 0);
    });
    it('los reportes de mascotas quedan cerrados y fuera del buscador', async () => {
      const pet = await models.Item.findOne({ title: 'Perro' });
      assert.equal(pet.status, 'cerrado');
      assert.equal(pet.moderation.status, 'rechazado');
      const r = await request(app).get('/api/items');
      assert.ok(!r.body.some((i) => i.title === 'Perro'));
    });
    it('no se puede reportar con la categoría de mascotas ni crearla de nuevo', async () => {
      const pets = await models.Category.findOne({ name: 'Mascotas' });
      const img = await helpers.makeImage({ seed: 50 });
      const r = await reportRequest(ana, 'perdido', { ...baseFields(), category: String(pets._id) }, img);
      assert.equal(r.status, 400);
      await models.Category.updateOne({}, {});
    });
  });

  describe('carga de imágenes', () => {
    it('rechaza un archivo que no es imagen aunque tenga extensión .png', async () => {
      const r = await reportRequest(ana, 'perdido', baseFields(), Buffer.from('<?php echo "hola"; ?>'), 'malicioso.png');
      assert.equal(r.status, 400);
    });
    it('rechaza extensiones no permitidas', async () => {
      const r = await reportRequest(ana, 'perdido', baseFields(), Buffer.from('MZ....'), 'virus.exe');
      assert.equal(r.status, 400);
    });
    it('rechaza imágenes de más de 5 MB', async () => {
      const big = Buffer.concat([await helpers.makeImage({ seed: 3 }), Buffer.alloc(6 * 1024 * 1024)]);
      const r = await reportRequest(ana, 'perdido', baseFields(), big, 'grande.png');
      assert.equal(r.status, 400);
      assert.match(r.body.message, /5MB/);
    });
    it('exige fotografía', async () => {
      const r = await reportRequest(ana, 'perdido', baseFields(), null);
      assert.equal(r.status, 400);
    });
    it('sin sesión no se puede crear un reporte', async () => {
      const r = await request(app).post('/api/items/perdido').field('title', 'x');
      assert.equal(r.status, 401);
    });
  });

  describe('flujo completo con la IA existente (regresión)', () => {
    let lostItemId;
    let matchId;

    it('advierte si el reporte público incluye un teléfono', async () => {
      const img = await helpers.makeImage({ seed: 11 });
      const r = await reportRequest(ana, 'perdido', { ...baseFields(), description: 'Billetera negra, si la ven llamen al 3001234567' }, img);
      assert.equal(r.status, 422);
      assert.equal(r.body.code, 'SENSITIVE_DATA_WARNING');
    });

    it('Ana reporta una billetera perdida', async () => {
      const img = await helpers.makeImage({ seed: 11 });
      const r = await reportRequest(ana, 'perdido', baseFields(), img);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      lostItemId = r.body.item._id;
      assert.match(r.body.item.imageUrl, /^\/uploads\/[a-f0-9-]+\.png$/);
      const stored = await models.Item.findById(lostItemId);
      assert.equal(stored.imageHash.length, 256, 'la IA generó el hash perceptual');
      assert.ok(Object.keys(Object.fromEntries(stored.textVector)).length > 0, 'la IA generó el vector de texto');
    });

    it('la foto subida se sirve como imagen con cabeceras seguras', async () => {
      const item = await models.Item.findById(lostItemId);
      const r = await request(app).get(item.imageUrl);
      assert.equal(r.status, 200);
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.match(r.headers['content-type'], /image\/png/);
    });

    it('Beto reporta la billetera encontrada y la IA genera una coincidencia > 70 %', async () => {
      const img = await helpers.makeImage({ seed: 12, color: { r: 35, g: 62, b: 150 } });
      const r = await reportRequest(beto, 'encontrado', { ...baseFields(), title: 'Billetera negra cuero encontrada' }, img);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.ok(r.body.matchesFound >= 1);
      const match = await models.Match.findOne({ lostItem: lostItemId });
      assert.ok(match.score > 0.7);
      matchId = String(match._id);
    });

    it('Ana ve la coincidencia con porcentaje y chat disponible, sin datos personales de Beto', async () => {
      const r = await request(app).get(`/api/matches/item/${lostItemId}`).set(auth(ana));
      assert.equal(r.status, 200);
      assert.equal(r.body.length, 1);
      assert.equal(r.body[0].chatAvailable, true);
      assert.ok(r.body[0].percent > 70);
      const raw = JSON.stringify(r.body);
      assert.ok(!raw.includes('beto@test.co') && !raw.includes('3001234567'), 'no expone correo ni teléfono');
    });

    it('un usuario externo no puede ver las coincidencias del reporte', async () => {
      const r = await request(app).get(`/api/matches/item/${lostItemId}`).set(auth(caro));
      assert.equal(r.status, 403);
    });

    it('el buscador público no expone correo ni teléfono', async () => {
      const r = await request(app).get('/api/items');
      const raw = JSON.stringify(r.body);
      assert.ok(!raw.includes('@test.co'));
      assert.ok(!raw.includes('3001234567'));
      assert.ok(!raw.includes('imageHash') && !raw.includes('textVector'));
      const detail = await request(app).get(`/api/items/${lostItemId}`);
      assert.equal(detail.body.user.name, 'Ana M.');
    });

    it('la búsqueda con caracteres de regex no rompe el servidor', async () => {
      const r = await request(app).get('/api/items').query({ q: '(a+)+$[' });
      assert.equal(r.status, 200);
    });

    it('Ana y Beto pueden conversar; aparece en sus conversaciones', async () => {
      const send = await request(app).post(`/api/messages/${matchId}`).set(auth(ana)).send({ content: 'Hola, ¿la billetera tiene un llavero azul?' });
      assert.equal(send.status, 201, JSON.stringify(send.body));
      const reply = await request(app).post(`/api/messages/${matchId}`).set(auth(beto)).send({ content: 'Sí, tiene un llavero azul pequeño.' });
      assert.equal(reply.status, 201);
      const convs = await request(app).get('/api/messages/conversations').set(auth(beto));
      assert.equal(convs.body.length, 1);
      assert.equal(convs.body[0].otherUser.name, 'Ana M.');
      const hist = await request(app).get(`/api/messages/${matchId}`).set(auth(ana));
      assert.equal(hist.body.messages.length, 2);
    });

    it('un usuario externo no puede leer ni escribir en esa conversación', async () => {
      const read = await request(app).get(`/api/messages/${matchId}`).set(auth(caro));
      assert.equal(read.status, 403);
      const write = await request(app).post(`/api/messages/${matchId}`).set(auth(caro)).send({ content: 'hola' });
      assert.equal(write.status, 403);
      const convs = await request(app).get('/api/messages/conversations').set(auth(caro));
      assert.equal(convs.body.length, 0);
    });

    it('un usuario externo no puede modificar ni borrar el reporte de otro (IDOR)', async () => {
      const upd = await request(app).put(`/api/items/${lostItemId}/status`).set(auth(caro)).send({ status: 'cerrado' });
      assert.equal(upd.status, 403);
      const del = await request(app).delete(`/api/items/${lostItemId}`).set(auth(caro));
      assert.equal(del.status, 403);
      const conf = await request(app).post(`/api/matches/${matchId}/confirm`).set(auth(caro));
      assert.equal(conf.status, 403);
    });

    it('un ID mal formado responde 404/400, no 500', async () => {
      const r = await request(app).get('/api/items/no-es-un-id');
      assert.equal(r.status, 404);
      const m = await request(app).get('/api/messages/123').set(auth(ana));
      assert.equal(m.status, 404);
    });

    it('advierte datos sensibles en el chat y permite enviarlos solo si se confirma', async () => {
      const warn = await request(app).post(`/api/messages/${matchId}`).set(auth(ana)).send({ content: 'mi número es 300 123 4567' });
      assert.equal(warn.status, 422);
      assert.equal(warn.body.code, 'SENSITIVE_DATA_WARNING');
      const ok = await request(app).post(`/api/messages/${matchId}`).set(auth(ana)).send({ content: 'mi número es 300 123 4567', confirmSensitive: true });
      assert.equal(ok.status, 201);
    });

    it('bloquea números de tarjeta aunque se confirme', async () => {
      const r = await request(app).post(`/api/messages/${matchId}`).set(auth(ana)).send({ content: 'tarjeta 4111 1111 1111 1111', confirmSensitive: true });
      assert.equal(r.status, 422);
      assert.equal(r.body.code, 'SENSITIVE_DATA_BLOCKED');
    });

    it('valida longitud y mensajes vacíos', async () => {
      const empty = await request(app).post(`/api/messages/${matchId}`).set(auth(ana)).send({ content: '   ' });
      assert.equal(empty.status, 400);
      const long = await request(app).post(`/api/messages/${matchId}`).set(auth(ana)).send({ content: 'a'.repeat(1001) });
      assert.equal(long.status, 400);
    });

    it('no permite repetir el mismo mensaje seguido', async () => {
      await request(app).post(`/api/messages/${matchId}`).set(auth(beto)).send({ content: 'Nos vemos en portería' });
      const dup = await request(app).post(`/api/messages/${matchId}`).set(auth(beto)).send({ content: 'Nos vemos en portería' });
      assert.equal(dup.status, 429);
    });

    it('al rechazar la coincidencia el chat se cierra', async () => {
      const r = await request(app).post(`/api/matches/${matchId}/reject`).set(auth(ana));
      assert.equal(r.status, 200);
      const send = await request(app).post(`/api/messages/${matchId}`).set(auth(beto)).send({ content: '¿Sigue ahí?' });
      assert.equal(send.status, 403);
    });
  });

  describe('umbral de coincidencia aplicado a la mensajería', () => {
    for (const [score, allowed] of [[0.69, false], [0.7, false], [0.71, true], [0.8, true], [0.95, true]]) {
      it(`${Math.round(score * 100)} % -> ${allowed ? 'habilita' : 'NO habilita'} la comunicación`, async () => {
        const match = await makeMatch(ana, beto, score);
        const r = await request(app).post(`/api/messages/${match._id}`).set(auth(ana)).send({ content: `Hola ${score}` });
        assert.equal(r.status, allowed ? 201 : 403, JSON.stringify(r.body));
        const list = await request(app).get(`/api/matches/item/${match.lostItem}`).set(auth(ana));
        assert.equal(list.body.length, allowed ? 1 : 0);
      });
    }
  });

  describe('instituciones (control de acceso)', () => {
    it('el personal de una sede no puede ver los reportes de otra cambiando el id', async () => {
      const User = require('../models/User');
      const Institution = require('../models/Institution');
      const sedeA = await Institution.create({ name: 'Sede A', city: cityId, adminUser: caro.id });
      const sedeB = await Institution.create({ name: 'Sede B', city: cityId, adminUser: beto.id });
      await User.updateOne({ _id: caro.id }, { role: 'institucion', institution: sedeA._id });

      const own = await request(app).get(`/api/institutions/${sedeA._id}/items`).set(auth(caro));
      assert.equal(own.status, 200);
      const other = await request(app).get(`/api/institutions/${sedeB._id}/items`).set(auth(caro));
      assert.equal(other.status, 403);
      const stats = await request(app).get(`/api/institutions/${sedeB._id}/stats`).set(auth(caro));
      assert.equal(stats.status, 403);
      const edit = await request(app).put(`/api/institutions/${sedeB._id}`).set(auth(caro)).send({ name: 'Hackeada' });
      assert.equal(edit.status, 403);

      const match = await makeMatch(ana, beto, 0.9);
      const validate = await request(app).post(`/api/matches/${match._id}/validate`).set(auth(caro));
      assert.equal(validate.status, 403, 'no puede validar entregas de objetos que no son de su sede');

      await User.updateOne({ _id: caro.id }, { role: 'usuario', institution: null });
    });
  });

  describe('anti-spam de mensajería', () => {
    it('máximo 10 mensajes seguidos sin respuesta', async () => {
      const match = await makeMatch(ana, caro, 0.9);
      let last;
      for (let i = 0; i < 11; i++) {
        last = await request(app).post(`/api/messages/${match._id}`).set(auth(caro)).send({ content: `mensaje ${i}` });
      }
      assert.equal(last.status, 429);
      assert.match(last.body.message, /sin respuesta/);
    });

    it('límite de frecuencia: 15 mensajes por minuto por usuario', async () => {
      const dani = await createSession('dani@test.co', 'Daniela Gómez');
      const m1 = await makeMatch(dani, ana, 0.9);
      const m2 = await makeMatch(dani, beto, 0.9);
      const statuses = [];
      for (let i = 0; i < 16; i++) {
        const match = i % 2 ? m2 : m1;
        const r = await request(app).post(`/api/messages/${match._id}`).set(auth(dani)).send({ content: `rapido ${i}` });
        statuses.push(r.status);
      }
      assert.deepEqual(statuses.slice(0, 15), Array(15).fill(201));
      assert.equal(statuses[15], 429);
    });
  });
});