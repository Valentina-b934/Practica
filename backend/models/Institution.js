const mongoose = require('mongoose');

const institutionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // Ej: "UTS - Sede Bucaramanga"
    type: {
      type: String,
      enum: ['universidad', 'centro_comercial', 'empresa', 'aeropuerto', 'terminal', 'otro'],
      default: 'otro',
    },
    city: { type: mongoose.Schema.Types.ObjectId, ref: 'City', required: true },
    address: { type: String, trim: true },
    contactEmail: { type: String, trim: true },
    contactPhone: { type: String, trim: true },
    adminUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    logoUrl: { type: String, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Institution', institutionSchema);
