/**
 * ================================================================
 * SERVICIO DE ENVIO DE CORREO
 * ================================================================
 * Se usa para el flujo de "olvidé mi contraseña". Usa nodemailer con las
 * credenciales SMTP definidas en .env (EMAIL_HOST, EMAIL_PORT, EMAIL_USER,
 * EMAIL_PASS, EMAIL_FROM).
 *
 * MODO DE RESPALDO (para desarrollo/pruebas sin configurar SMTP todavia):
 * si esas variables no estan definidas, en vez de fallar, el link de
 * recuperacion se imprime en la consola del servidor con un aviso bien
 * visible. Asi puedes probar el flujo completo de inmediato y conectar un
 * proveedor real (Gmail, SendGrid, Mailtrap, etc.) despues, sin cambiar
 * nada mas del codigo.
 * ================================================================
 */
const nodemailer = require('nodemailer');

const isEmailConfigured = () =>
  Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587', 10),
    secure: process.env.EMAIL_PORT === '465',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

async function sendPasswordResetEmail(toEmail, resetUrl) {
  const subject = 'Recupera tu contraseña — ObjetosIA Colombia';
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#2354ff">ObjetosIA Colombia</h2>
      <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
      <p>Si fuiste tú, haz clic en el siguiente botón (válido por 1 hora):</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${resetUrl}" style="background:#2354ff;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Restablecer contraseña</a>
      </p>
      <p style="font-size:.85rem;color:#666">Si no fuiste tú, ignora este correo; tu contraseña seguirá siendo la misma.</p>
      <p style="font-size:.8rem;color:#999">Si el botón no funciona, copia y pega este enlace: ${resetUrl}</p>
    </div>`;

  if (!isEmailConfigured()) {
    // Modo de respaldo: no hay SMTP configurado, se imprime el link en
    // consola para poder seguir probando el flujo sin bloquear el trabajo.
    console.log('\n==================== EMAIL (modo respaldo, no se envió de verdad) ====================');
    console.log(`Para: ${toEmail}`);
    console.log(`Asunto: ${subject}`);
    console.log(`Enlace de recuperación: ${resetUrl}`);
    console.log('Configura EMAIL_HOST/EMAIL_USER/EMAIL_PASS en .env para enviar correos reales.');
    console.log('========================================================================================\n');
    return { sent: false, mode: 'console-fallback' };
  }

  const transporter = getTransporter();
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: toEmail,
    subject,
    html,
  });
  return { sent: true, mode: 'smtp' };
}

module.exports = { sendPasswordResetEmail, isEmailConfigured };
