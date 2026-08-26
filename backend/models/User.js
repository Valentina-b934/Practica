const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    phone: { type: String, trim: true },
    role: {
      type: String,
      enum: ['usuario', 'institucion', 'admin'],
      default: 'usuario',
    },
    city: { type: mongoose.Schema.Types.ObjectId, ref: 'City' },
    institution: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', default: null },
    active: { type: Boolean, default: true },

    // --- Recuperacion de contraseña ---
    // Se guarda el HASH del token (nunca el token en texto plano), igual
    // que se hace con la contraseña: si alguien accede a la base de datos
    // no puede usar este campo para resetear contraseñas de otros.
    resetPasswordToken: { type: String, default: null, select: false },
    resetPasswordExpires: { type: Date, default: null, select: false },
  },
  { timestamps: true }
);

// Hash de contraseña antes de guardar
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
