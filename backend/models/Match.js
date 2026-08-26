const mongoose = require('mongoose');

/**
 * Representa una posible coincidencia detectada por la IA entre
 * un objeto perdido y uno encontrado.
 */
const matchSchema = new mongoose.Schema(
  {
    lostItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    foundItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },

    score: { type: Number, required: true }, // 0 a 1 - score final combinado

    // Desglose del score por caracteristica, para explicar el resultado al usuario
    textScore: { type: Number, default: 0 },
    imageScore: { type: Number, default: 0 },
    colorScore: { type: Number, default: 0 },
    brandScore: { type: Number, default: 0 },
    locationScore: { type: Number, default: 0 },
    categoryMatch: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ['sugerida', 'confirmada_usuario', 'validada_institucion', 'rechazada'],
      default: 'sugerida',
    },
  },
  { timestamps: true }
);

matchSchema.index({ lostItem: 1, foundItem: 1 }, { unique: true });

module.exports = mongoose.model('Match', matchSchema);
