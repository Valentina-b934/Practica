const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Costo de bcrypt: 12 rondas (antes 10). Cada +1 duplica el trabajo de un
// atacante que intente adivinar contraseñas a partir de un hash robado.
const BCRYPT_ROUNDS = 12;

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    password: { type: String, required: true, minlength: 6 },
    // Dato privado: nunca se expone en las rutas publicas (ver itemController)
    phone: { type: String, trim: true, maxlength: 30 },
    role: {
      type: String,
      enum: ['usuario', 'institucion', 'admin'],
      default: 'usuario',
    },
    city: { type: mongoose.Schema.Types.ObjectId, ref: 'City' },
    institution: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', default: null },
    active: { type: Boolean, default: true },

    // true cuando el usuario demostro que controla el correo (codigo OTP)
    emailVerified: { type: Boolean, default: false },

    // --- Recuperacion de contraseña ---
    // Se guarda el HASH del token (nunca el token en texto plano), igual
    // que se hace con la contraseña: si alguien accede a la base de datos
    // no puede usar este campo para resetear contraseñas de otros.
    resetPasswordToken: { type: String, default: null, select: false },
    resetPasswordExpires: { type: Date, default: null, select: false },
    resetPasswordRequestedAt: { type: Date, default: null, select: false },

    // --- Proteccion contra fuerza bruta en el login ---
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, default: null, select: false },

    // Version de las sesiones: va dentro de cada JWT. Al cambiar la
    // contraseña se incrementa y TODOS los tokens emitidos antes dejan de
    // ser validos (ver middleware/auth.js). Asi, si alguien robo una sesion,
    // recuperar la contraseña la cierra de inmediato.
    tokenVersion: { type: Number, default: 0 },
    passwordChangedAt: { type: Date, default: null, select: false },
  },
  { timestamps: true }
);

// Hash de contraseña antes de guardar
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
  this.password = await bcrypt.hash(this.password, salt);
  if (!this.isNew) {
    this.passwordChangedAt = new Date();
    this.tokenVersion = (this.tokenVersion || 0) + 1;
  }
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  if (typeof enteredPassword !== 'string') return false;
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.isLocked = function () {
  return Boolean(this.lockUntil && this.lockUntil.getTime() > Date.now());
};

// Nunca serializar campos internos aunque alguien olvide el .select()
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.resetPasswordToken;
    delete ret.resetPasswordExpires;
    delete ret.resetPasswordRequestedAt;
    delete ret.failedLoginAttempts;
    delete ret.lockUntil;
    delete ret.passwordChangedAt;
    delete ret.tokenVersion;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);