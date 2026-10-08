/**
 * Utilidades compartidas por las pruebas automaticas.
 *
 * - Levanta un servidor SMTP REAL local (paquete smtp-server) que recibe
 *   los correos que envia nodemailer. Asi se prueba el envio de verdad
 *   (conexion, autenticacion, aceptacion del destinatario) y se puede leer
 *   el enlace de recuperacion o el codigo OTP del correo recibido.
 * - Usa una base de datos MongoDB de pruebas (TEST_MONGO_URI, por defecto
 *   mongodb://127.0.0.1:27017) con un nombre aleatorio que se borra al final.
 *
 * Requisito: tener MongoDB corriendo localmente (o definir TEST_MONGO_URI).
 */
const crypto = require('crypto');
const { SMTPServer } = require('smtp-server');

const SMTP_USER = 'pruebas@objetosia.test';
const SMTP_PASS = 'clave-smtp-de-prueba';

function configureEnv(overrides = {}) {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_SECRET: crypto.randomBytes(48).toString('hex'),
    OTP_SECRET: crypto.randomBytes(48).toString('hex'),
    CLIENT_URL: 'http://localhost:5500',
    EMAIL_HOST: '127.0.0.1',
    EMAIL_USER: SMTP_USER,
    EMAIL_PASS: SMTP_PASS,
    EMAIL_SECURE: 'false',
    EMAIL_FROM: 'ObjetosIA Pruebas <no-reply@objetosia.test>',
    OTP_LOGIN_MODE: 'always',
    RL_API_MAX: '100000',
    RL_LOGIN_MAX: '1000',
    RL_OTP_VERIFY_MAX: '1000',
    RL_OTP_SEND_MAX: '1000',
    RL_RESET_MAX: '1000',
    RL_REGISTER_MAX: '1000',
    RL_REPORT_MAX: '1000',
    RL_MESSAGE_MAX: '15',
    ...overrides,
  });
}

function decodeQuotedPrintable(raw) {
  const latin1 = raw
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return Buffer.from(latin1, 'latin1').toString('utf8');
}

/** Servidor SMTP real en un puerto libre; guarda los correos recibidos. */
function startSmtpServer() {
  const inbox = [];
  const server = new SMTPServer({
    secure: false,
    disabledCommands: ['STARTTLS'],
    allowInsecureAuth: true,
    authMethods: ['PLAIN', 'LOGIN'],
    onAuth(auth, session, cb) {
      if (auth.username === SMTP_USER && auth.password === SMTP_PASS) return cb(null, { user: auth.username });
      return cb(new Error('Credenciales SMTP invalidas'));
    },
    onRcptTo(address, session, cb) {
      if (address.address.endsWith('@rechazado.test')) return cb(new Error('Destinatario rechazado'));
      return cb();
    },
    onData(stream, session, cb) {
      let raw = '';
      stream.on('data', (chunk) => (raw += chunk.toString('utf8')));
      stream.on('end', () => {
        inbox.push({
          to: session.envelope.rcptTo.map((r) => r.address.toLowerCase()),
          raw,
          text: decodeQuotedPrintable(raw),
        });
        cb();
      });
    },
    logger: false,
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.server.address();
      process.env.EMAIL_PORT = String(port);
      resolve({
        server,
        inbox,
        port,
        lastTo(email) {
          return [...inbox].reverse().find((m) => m.to.includes(email.toLowerCase()));
        },
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function connectTestDb() {
  const mongoose = require('mongoose');
  const base = (process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017').replace(/\/+$/, '');
  const dbName = `objetos_test_${crypto.randomBytes(4).toString('hex')}`;
  await mongoose.connect(`${base}/${dbName}`);
  return {
    mongoose,
    async drop() {
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    },
  };
}

function extractOtp(mail) {
  const m = mail && mail.text.match(/c[oó]digo de verificaci[oó]n de ObjetosIA Colombia es: (\d{6})/i);
  return m ? m[1] : null;
}

function extractResetToken(mail) {
  const m = mail && mail.text.match(/reset-password\.html\?token=([a-f0-9]{64})/);
  return m ? m[1] : null;
}

/** Imagen PNG generada al vuelo (para probar la carga de fotos). */
async function makeImage({ seed = 1, size = 320, color = { r: 30, g: 60, b: 160 } } = {}) {
  const sharp = require('sharp');
  const channels = 3;
  const data = Buffer.alloc(size * size * channels);
  let x = seed * 9973;
  for (let i = 0; i < data.length; i += channels) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const noise = (x % 60) - 30;
    const p = i / channels;
    const stripe = Math.floor((p % size) / 40) % 2 ? 40 : 0;
    data[i] = Math.max(0, Math.min(255, color.r + noise + stripe));
    data[i + 1] = Math.max(0, Math.min(255, color.g + noise));
    data[i + 2] = Math.max(0, Math.min(255, color.b + noise - stripe));
  }
  return sharp(data, { raw: { width: size, height: size, channels } }).png().toBuffer();
}

module.exports = {
  configureEnv,
  startSmtpServer,
  connectTestDb,
  extractOtp,
  extractResetToken,
  makeImage,
};