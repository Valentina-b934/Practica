const mongoose = require('mongoose');

const citySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

citySchema.index({ name: 1, department: 1 }, { unique: true });

module.exports = mongoose.model('City', citySchema);
