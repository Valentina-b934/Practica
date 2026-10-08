/**
 * Pruebas de autenticacion: registro, login, bloqueo por fuerza bruta,
 * OTP y recuperacion de contraseña de extremo a extremo con envio REAL de
 * correo a un servidor SMTP local.
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('./helpers');

helpers.configureEnv({ OTP_RESEND_COOLDOWN_SECONDS: '1' });

const request = require('supertest');

let app;
let smtp;
let db;
let City;
let User;
let OtpCode;
let cityId;

async function registerAndVerify(email, password = 'Clave1234', name = 'Ana Torres') {
  const reg = await request(app).post('/api/auth/register').send({ name, email, password, city: cityId });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.equal(reg.body.otpRequired, true);
  const code = helpers.extractOtp(smtp.lastTo(email));
  const ver = await request(app).post('/api/auth/verify-otp').send({ challengeId: reg.body.challengeId, code });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  return ver.body;
}

async function loginStep1(email, password) {
  return request(app).post('/api/auth/login').send({ email, password });
}

describe('Autenticación', () => {
  before(async () => {
    smtp = await helpers.startSmtpServer();
    db = await helpers.connectTestDb();
    app = require('../server');
    City = require('../models/City');
    User = require('../models/User');
    OtpCode = require('../models/OtpCode');
    const city = await City.create({ name: 'Bucaramanga', department: 'Santander' });
    cityId = String(city._id);
  });

  after(async () => {
    await db.drop();
    await smtp.close();
  });

  describe('registro', () => {
    it('rechaza contraseñas débiles', async () => {
      const r = await request(app).post('/api/auth/register').send({ name: 'Ana', email: 'debil@test.co', password: '123456', city: cityId });
      assert.equal(r.status, 400);
    });

    it('nunca permite registrarse como institución o admin', async () => {
      const session = await registerAndVerify('rol@test.co');
      assert.equal(session.role, 'usuario');
      const user = await User.findOne({ email: 'rol@test.co' });
      assert.equal(user.role, 'usuario');
      const r = await request(app).post('/api/auth/register').send({ name: 'Xavier', email: 'x2@test.co', password: 'Clave1234', city: cityId, role: 'admin' });
      assert.equal(r.status, 201);
      assert.equal((await User.findOne({ email: 'x2@test.co' })).role, 'usuario');
    });

    it('guarda la contraseña con hash bcrypt, nunca en texto plano', async () => {
      const user = await User.findOne({ email: 'rol@test.co' });
      assert.notEqual(user.password, 'Clave1234');
      assert.match(user.password, /^\$2[aby]\$12\$/);
    });

    it('bloquea inyección NoSQL en el login', async () => {
      const r = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
      assert.equal(r.status, 400);
    });
  });

  describe('login y fuerza bruta', () => {
    before(async () => {
      await registerAndVerify('login@test.co', 'Clave1234');
    });

    it('contraseña incorrecta -> 401 con mensaje genérico', async () => {
      const r = await loginStep1('login@test.co', 'Otra1234');
      assert.equal(r.status, 401);
      const r2 = await loginStep1('noexiste@test.co', 'Otra1234');
      assert.equal(r2.status, 401);
      assert.equal(r.body.message, r2.body.message, 'no debe revelar si el correo existe');
    });

    it('5 intentos fallidos bloquean la cuenta temporalmente (incluso con la clave correcta)', async () => {
      await User.updateOne({ email: 'login@test.co' }, { failedLoginAttempts: 0, lockUntil: null });
      for (let i = 0; i < 5; i++) await loginStep1('login@test.co', `Mala${i}1234`);
      const r = await loginStep1('login@test.co', 'Clave1234');
      assert.equal(r.status, 429);
      assert.equal(r.body.code, 'ACCOUNT_LOCKED');
      await User.updateOne({ email: 'login@test.co' }, { failedLoginAttempts: 0, lockUntil: null });
    });

    it('contraseña correcta -> pide OTP y envía el código por correo real', async () => {
      const r = await loginStep1('login@test.co', 'Clave1234');
      assert.equal(r.status, 200);
      assert.equal(r.body.otpRequired, true);
      assert.equal(r.body.token, undefined, 'no entrega token sin OTP');
      assert.ok(helpers.extractOtp(smtp.lastTo('login@test.co')));
      const stored = await OtpCode.findOne({}).sort('-createdAt');
      assert.doesNotMatch(JSON.stringify(stored), new RegExp(`"${helpers.extractOtp(smtp.lastTo('login@test.co'))}"`), 'el OTP no se guarda en texto plano');
    });
  });

  describe('OTP', () => {
    beforeEach(async () => {
      await OtpCode.deleteMany({});
    });

    it('OTP incorrecto -> 400 y descuenta intentos', async () => {
      const r = await loginStep1('login@test.co', 'Clave1234');
      const code = helpers.extractOtp(smtp.lastTo('login@test.co'));
      const wrong = code === '000000' ? '111111' : '000000';
      const v = await request(app).post('/api/auth/verify-otp').send({ challengeId: r.body.challengeId, code: wrong });
      assert.equal(v.status, 400);
      assert.equal(v.body.code, 'OTP_WRONG');
    });

    it('OTP reutilizado -> rechazado', async () => {
      const r = await loginStep1('login@test.co', 'Clave1234');
      const code = helpers.extractOtp(smtp.lastTo('login@test.co'));
      const ok = await request(app).post('/api/auth/verify-otp').send({ challengeId: r.body.challengeId, code });
      assert.equal(ok.status, 200);
      assert.ok(ok.body.token);
      const again = await request(app).post('/api/auth/verify-otp').send({ challengeId: r.body.challengeId, code });
      assert.equal(again.status, 400);
    });

    it('OTP expirado -> rechazado', async () => {
      const r = await loginStep1('login@test.co', 'Clave1234');
      const code = helpers.extractOtp(smtp.lastTo('login@test.co'));
      await OtpCode.updateMany({ usedAt: null, invalidatedAt: null }, { expiresAt: new Date(Date.now() - 1000) });
      const v = await request(app).post('/api/auth/verify-otp').send({ challengeId: r.body.challengeId, code });
      assert.equal(v.status, 400);
      assert.equal(v.body.code, 'OTP_EXPIRED');
    });

    it('tras 5 intentos fallidos el OTP queda invalidado aunque luego llegue el correcto', async () => {
      await OtpCode.deleteMany({});
      const r = await loginStep1('login@test.co', 'Clave1234');
      const code = helpers.extractOtp(smtp.lastTo('login@test.co'));
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await request(app).post('/api/auth/verify-otp').send({ challengeId: r.body.challengeId, code: wrong });
      }
      const v = await request(app).post('/api/auth/verify-otp').send({ challengeId: r.body.challengeId, code });
      assert.equal(v.status, 400);
    });

    it('limita la cantidad de códigos que se pueden pedir (anti-spam)', async () => {
      await OtpCode.deleteMany({});
      let last;
      for (let i = 0; i < 4; i++) {
        last = await loginStep1('login@test.co', 'Clave1234');
        await new Promise((resolve) => setTimeout(resolve, 1100));
      }
      assert.equal(last.status, 429);
      assert.equal(last.body.code, 'OTP_SEND_LIMIT');
      await OtpCode.deleteMany({});
    });
  });

  describe('recuperación de contraseña (extremo a extremo con SMTP real)', () => {
    let oldToken;

    before(async () => {
      const session = await registerAndVerify('recupera@test.co', 'Vieja1234');
      oldToken = session.token;
    });

    it('correo inexistente -> misma respuesta genérica (sin enumeración)', async () => {
      const before = smtp.inbox.length;
      const a = await request(app).post('/api/auth/forgot-password').send({ email: 'nadie@test.co' });
      assert.equal(a.status, 200);
      assert.match(a.body.message, /Si existe una cuenta asociada a este correo/);
      assert.equal(smtp.inbox.length, before, 'no se envía correo a cuentas inexistentes');
    });

    it('solicitar -> token -> correo real -> validar -> cambiar -> no reutilizable -> login con la nueva', async () => {
      const r = await request(app).post('/api/auth/forgot-password').send({ email: 'recupera@test.co' });
      assert.equal(r.status, 200);
      assert.match(r.body.message, /Si existe una cuenta asociada a este correo/);

      const mail = smtp.lastTo('recupera@test.co');
      assert.ok(mail, 'el correo llegó al servidor SMTP');
      assert.match(mail.text, /Recuperar contrase/);
      const token = helpers.extractResetToken(mail);
      assert.ok(token, 'el correo contiene el enlace con el token');
      assert.match(mail.text, /http:\/\/localhost:5500\/reset-password\.html\?token=/);

      const user = await User.findOne({ email: 'recupera@test.co' }).select('+resetPasswordToken +resetPasswordExpires');
      assert.notEqual(user.resetPasswordToken, token, 'en BD solo se guarda el hash del token');
      const minutes = (user.resetPasswordExpires - Date.now()) / 60000;
      assert.ok(minutes > 25 && minutes <= 30, `expira en ~30 min (${minutes})`);

      const valid = await request(app).get(`/api/auth/reset-password/${token}/validate`).query({ email: 'recupera@test.co' });
      assert.equal(valid.status, 200);

      const reset = await request(app).post(`/api/auth/reset-password/${token}`).send({ email: 'recupera@test.co', password: 'Nueva1234' });
      assert.equal(reset.status, 200);

      const reuse = await request(app).post(`/api/auth/reset-password/${token}`).send({ email: 'recupera@test.co', password: 'Otra12345' });
      assert.equal(reuse.status, 400, 'el token no se puede reutilizar');

      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`);
      assert.equal(me.status, 401, 'las sesiones anteriores quedan cerradas');

      const oldLogin = await loginStep1('recupera@test.co', 'Vieja1234');
      assert.equal(oldLogin.status, 401);
      const newLogin = await loginStep1('recupera@test.co', 'Nueva1234');
      assert.equal(newLogin.status, 200);
      const code = helpers.extractOtp(smtp.lastTo('recupera@test.co'));
      const v = await request(app).post('/api/auth/verify-otp').send({ challengeId: newLogin.body.challengeId, code });
      assert.equal(v.status, 200);
      assert.ok(v.body.token);
    });

    it('token expirado -> rechazado', async () => {
      await User.updateOne({ email: 'recupera@test.co' }, { resetPasswordRequestedAt: null });
      await request(app).post('/api/auth/forgot-password').send({ email: 'recupera@test.co' });
      const token = helpers.extractResetToken(smtp.lastTo('recupera@test.co'));
      await User.updateOne({ email: 'recupera@test.co' }, { resetPasswordExpires: new Date(Date.now() - 1000) });
      const r = await request(app).post(`/api/auth/reset-password/${token}`).send({ email: 'recupera@test.co', password: 'Nueva5678' });
      assert.equal(r.status, 400);
      const v = await request(app).get(`/api/auth/reset-password/${token}/validate`).query({ email: 'recupera@test.co' });
      assert.equal(v.status, 400);
    });

    it('si el servicio de correo falla, responde 503 y NO dice que el correo se envió', async () => {
      const emailUtil = require('../utils/email');
      const realPort = process.env.EMAIL_PORT;
      process.env.EMAIL_PORT = '1'; // puerto cerrado: el SMTP no responde
      emailUtil.resetTransporter();
      await User.updateOne({ email: 'recupera@test.co' }, { resetPasswordRequestedAt: null });

      const r = await request(app).post('/api/auth/forgot-password').send({ email: 'recupera@test.co' });
      assert.equal(r.status, 503);
      assert.doesNotMatch(r.body.message, /recibirás|enviado|enviamos/i);

      const r2 = await request(app).post('/api/auth/forgot-password').send({ email: 'nadie@test.co' });
      assert.equal(r2.status, 503, 'misma respuesta exista o no el correo');

      process.env.EMAIL_PORT = realPort;
      emailUtil.resetTransporter();
    });

    it('si el SMTP rechaza al destinatario, el token se anula y responde 503', async () => {
      await registerAndVerify('ok@test.co');
      await User.updateOne({ email: 'ok@test.co' }, { email: 'alguien@rechazado.test', resetPasswordRequestedAt: null });
      const r = await request(app).post('/api/auth/forgot-password').send({ email: 'alguien@rechazado.test' });
      assert.equal(r.status, 503);
      const user = await User.findOne({ email: 'alguien@rechazado.test' }).select('+resetPasswordToken');
      assert.equal(user.resetPasswordToken, null);
    });
  });

  describe('API protegida', () => {
    it('sin token -> 401', async () => {
      const r = await request(app).get('/api/items/mine');
      assert.equal(r.status, 401);
    });
    it('token falsificado -> 401', async () => {
      const r = await request(app).get('/api/auth/me').set('Authorization', 'Bearer eyJhbGciOiJub25lIn0.eyJpZCI6IjEifQ.');
      assert.equal(r.status, 401);
    });
    it('ruta de administrador con usuario normal -> 403', async () => {
      const session = await registerAndVerify('normal@test.co');
      const r = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${session.token}`);
      assert.equal(r.status, 403);
    });
  });
});