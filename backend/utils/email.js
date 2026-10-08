/**
 * ================================================================
 * SERVICIO DE ENVIO DE CORREO (SMTP real con nodemailer)
 * ================================================================
 * Se usa para:
 *   - el enlace de "¿Olvidaste tu contraseña?"
 *   - los codigos OTP de inicio de sesion
 *
 * Configuracion (.env): EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS,
 * EMAIL_FROM y opcionalmente EMAIL_SECURE (true para el puerto 465).
 *
 * CAMBIO IMPORTANTE respecto a la version anterior:
 * antes, si faltaba la configuracion SMTP, la funcion "simulaba" el envio
 * (imprimia el enlace en consola) y el usuario veia igual "revisa tu
 * correo". Ahora el envio es REAL o falla de forma explicita:
 *   - Si falta configuracion -> EmailError('EMAIL_NOT_CONFIGURED').
 *   - Si el servidor SMTP no responde o rechaza las credenciales ->
 *     EmailError('EMAIL_TRANSPORT_ERROR').
 *   - Si el servidor no acepta al destinatario -> EmailError('EMAIL_REJECTED').
 * Los controladores capturan ese error y responden 503 con un mensaje
 * honesto, nunca "correo enviado".
 *
 * Unica excepcion, SOLO para desarrollo local: EMAIL_DEV_FALLBACK=true con
 * NODE_ENV distinto de "production" imprime el correo en la consola del
 * backend. Esa variable se ignora por completo en produccion.
 * ================================================================
 */
const nodemailer = require('nodemailer');

class EmailError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'EmailError';
    this.code = code;
    this.cause = cause;
  }
}

const isEmailConfigured = () =>
  Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);

const isDevFallbackEnabled = () =>
  process.env.NODE_ENV !== 'production' && process.env.EMAIL_DEV_FALLBACK === 'true';

let transporter = null;
let lastVerifiedAt = 0;
const VERIFY_CACHE_MS = 5 * 60 * 1000;

function getTransporter() {
  if (transporter) return transporter;
  const port = parseInt(process.env.EMAIL_PORT || '587', 10);
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,
    secure: process.env.EMAIL_SECURE ? process.env.EMAIL_SECURE === 'true' : port === 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    // Sin estos limites, un SMTP caido dejaria la peticion colgada minutos
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    tls: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === 'false' ? { rejectUnauthorized: false } : undefined,
  });
  return transporter;
}

/** Permite a las pruebas automaticas reiniciar el transporte con otra configuracion. */
function resetTransporter() {
  transporter = null;
  lastVerifiedAt = 0;
}

/**
 * Comprueba que el servidor SMTP esta disponible y acepta las credenciales
 * (conexion + autenticacion), SIN enviar ningun correo. Se usa antes de
 * buscar al usuario en "olvide mi contraseña" para poder informar una caida
 * del servicio sin revelar si el correo esta registrado o no.
 */
async function verifyEmailTransport() {
  if (!isEmailConfigured()) {
    if (isDevFallbackEnabled()) return { ok: true, mode: 'console' };
    throw new EmailError(
      'EMAIL_NOT_CONFIGURED',
      'El servicio de correo no está configurado en el servidor (EMAIL_HOST, EMAIL_USER y EMAIL_PASS).'
    );
  }
  if (Date.now() - lastVerifiedAt < VERIFY_CACHE_MS) return { ok: true, mode: 'smtp' };
  try {
    await getTransporter().verify();
    lastVerifiedAt = Date.now();
    return { ok: true, mode: 'smtp' };
  } catch (err) {
    console.error('❌ SMTP no disponible:', err.code || '', err.message);
    throw new EmailError('EMAIL_TRANSPORT_ERROR', 'No fue posible conectar con el servidor de correo.', err);
  }
}

async function sendMail({ to, subject, html, text }) {
  if (!isEmailConfigured()) {
    if (isDevFallbackEnabled()) {
      console.log('\n=============== EMAIL (EMAIL_DEV_FALLBACK, NO se envió de verdad) ===============');
      console.log(`Para: ${to}\nAsunto: ${subject}\n\n${text}`);
      console.log('==================================================================================\n');
      return { sent: false, mode: 'console' };
    }
    throw new EmailError(
      'EMAIL_NOT_CONFIGURED',
      'El servicio de correo no está configurado en el servidor (EMAIL_HOST, EMAIL_USER y EMAIL_PASS).'
    );
  }

  let info;
  try {
    info = await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      text,
      html,
    });
  } catch (err) {
    // Se invalida la verificacion cacheada: el siguiente intento vuelve a probar la conexion
    lastVerifiedAt = 0;
    console.error('❌ Error enviando correo:', err.code || '', err.responseCode || '', err.message);
    throw new EmailError('EMAIL_TRANSPORT_ERROR', 'El servidor de correo no pudo enviar el mensaje.', err);
  }

  // El SMTP respondio, pero hay que comprobar que ACEPTO al destinatario
  const accepted = (info.accepted || []).map((a) => String(a.address || a).toLowerCase());
  if (!accepted.includes(String(to).toLowerCase())) {
    console.error('❌ El servidor de correo rechazó al destinatario:', info.rejected, info.response);
    throw new EmailError('EMAIL_REJECTED', 'El servidor de correo rechazó el destinatario.');
  }

  lastVerifiedAt = Date.now();
  return { sent: true, mode: 'smtp', messageId: info.messageId };
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function layout(title, bodyHtml) {
  return `
  <div style="background:#f5f7fb;padding:24px 0;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:480px;margin:auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e3e7f0">
      <p style="margin:0 0 16px;font-weight:bold;color:#1e40af;font-size:18px">ObjetosIA Colombia</p>
      <h2 style="margin:0 0 12px;color:#101728;font-size:20px">${title}</h2>
      ${bodyHtml}
      <p style="font-size:12px;color:#6b7386;margin-top:24px">Este es un correo automático, no respondas a este mensaje.
      Nunca te pediremos tu contraseña por correo ni por chat.</p>
    </div>
  </div>`;
}

async function sendPasswordResetEmail(toEmail, resetUrl, { name, minutes } = {}) {
  const subject = 'Recuperar contraseña — ObjetosIA Colombia';
  const html = layout(
    'Recuperar contraseña',
    `<p>Hola${name ? ` ${escapeHtml(name)}` : ''},</p>
     <p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta.</p>
     <p>Si realizaste esta solicitud, utiliza el siguiente enlace para crear una nueva contraseña.
        El enlace es válido durante <strong>${minutes} minutos</strong> y solo se puede usar una vez.</p>
     <p style="text-align:center;margin:28px 0">
       <a href="${escapeHtml(resetUrl)}" style="background:#1e40af;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Restablecer contraseña</a>
     </p>
     <p style="font-size:13px;color:#4b5468">Si no realizaste esta solicitud, ignora este correo: tu contraseña seguirá siendo la misma.</p>
     <p style="font-size:12px;color:#6b7386;word-break:break-all">Si el botón no funciona, copia y pega este enlace en tu navegador:<br>${escapeHtml(resetUrl)}</p>`
  );
  const text =
    `Recuperar contraseña\n\nHemos recibido una solicitud para restablecer la contraseña de tu cuenta.\n` +
    `Si realizaste esta solicitud, utiliza el siguiente enlace (válido ${minutes} minutos, un solo uso):\n\n${resetUrl}\n\n` +
    'Si no realizaste esta solicitud, ignora este correo.';
  return sendMail({ to: toEmail, subject, html, text });
}

async function sendOtpEmail(toEmail, code, { name, minutes } = {}) {
  const subject = `Tu código de verificación: ${code} — ObjetosIA Colombia`;
  const html = layout(
    'Código de verificación',
    `<p>Hola${name ? ` ${escapeHtml(name)}` : ''},</p>
     <p>Usa este código para completar tu inicio de sesión:</p>
     <p style="text-align:center;font-size:32px;letter-spacing:8px;font-weight:bold;color:#12275c;margin:24px 0">${escapeHtml(code)}</p>
     <p style="font-size:13px;color:#4b5468">Vence en ${minutes} minutos y solo sirve una vez. Si no intentaste iniciar sesión,
        cambia tu contraseña: alguien la conoce.</p>`
  );
  const text = `Tu código de verificación de ObjetosIA Colombia es: ${code}\nVence en ${minutes} minutos y solo sirve una vez.`;
  return sendMail({ to: toEmail, subject, html, text });
}

module.exports = {
  EmailError,
  isEmailConfigured,
  isDevFallbackEnabled,
  verifyEmailTransport,
  sendMail,
  sendPasswordResetEmail,
  sendOtpEmail,
  resetTransporter,
};