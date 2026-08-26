const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['coincidencia', 'sistema', 'recuperacion', 'moderacion', 'mensaje'],
      default: 'sistema',
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    relatedItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
    relatedMatch: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', default: null },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
