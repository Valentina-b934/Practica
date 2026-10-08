const mongoose = require('mongoose');

/**
 * Codigo OTP (One-Time Password) de un solo uso, enviado por correo.
 *
 * Nunca se guarda el codigo en texto plano: solo su HMAC-SHA256 con una
 * clave del servidor (OTP_SECRET). Un codigo de 6 digitos solo tiene un
 * millon de combinaciones, asi que un hash simple (sin clave) se podria
 * revertir por fuerza bruta si alguien robara la base de datos; con HMAC
 * eso no es posible sin la clave, que no vive en la base de datos.
 *
 * El cliente nunca recibe el _id: recibe un `challengeId` aleatorio de 256
 * bits (del que tambien se guarda solo el hash). Asi el codigo queda
 * atado a ESE intento de inicio de sesion concreto.
 */
const otpCodeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, enum: ['login'], default: 'login' },
    challengeHash: { type: String, required: true, unique: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    usedAt: { type: Date, default: null },
    invalidatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// MongoDB borra automaticamente los OTP 24 h despues de vencer (limpieza).
otpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

module.exports = mongoose.model('OtpCode', otpCodeSchema);