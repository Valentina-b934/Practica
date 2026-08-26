const mongoose = require('mongoose');

/**
 * Un mensaje de chat dentro de una coincidencia (Match) ya verificada.
 * La conversacion queda "anclada" al Match (no a los items sueltos) para
 * que solo las dos personas involucradas en esa coincidencia especifica
 * puedan verla, y para poder cerrarla si la coincidencia se rechaza.
 */
const messageSchema = new mongoose.Schema(
  {
    match: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

messageSchema.index({ match: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
