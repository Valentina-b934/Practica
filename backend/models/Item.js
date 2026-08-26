const mongoose = require('mongoose');

/**
 * Un "Item" representa un reporte de objeto perdido o encontrado.
 * Guarda tanto los datos legibles por humanos (titulo, descripcion, foto)
 * como los "vectores" generados por la IA (textVector, imageHash) que
 * se usan para calcular coincidencias automaticamente.
 */
const itemSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['perdido', 'encontrado'], required: true },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    institution: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', default: null },

    city: { type: mongoose.Schema.Types.ObjectId, ref: 'City', required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },

    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    color: { type: String, trim: true },
    brand: { type: String, trim: true },
    place: { type: String, trim: true }, // lugar donde se perdio/encontro
    date: { type: Date, required: true },

    imageUrl: { type: String, default: '' },

    // --- Campos generados por la IA ---
    textVector: { type: Map, of: Number, default: {} }, // bolsa de palabras ponderada (TF)
    imageHash: { type: String, default: '' }, // hash perceptual (pHash) de la imagen
    imageColorProfile: { type: [Number], default: [] }, // histograma de color simplificado

    status: {
      type: String,
      enum: ['activo', 'con_coincidencias', 'en_proceso', 'recuperado', 'cerrado'],
      default: 'activo',
    },

    // Moderacion de contenido (rol admin)
    moderation: {
      status: { type: String, enum: ['pendiente', 'aprobado', 'rechazado'], default: 'aprobado' },
      reason: { type: String, default: '' },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
  },
  { timestamps: true }
);

itemSchema.index({ type: 1, city: 1, category: 1, status: 1 });

module.exports = mongoose.model('Item', itemSchema);
