const mongoose = require('mongoose');

const difficultySchema = new mongoose.Schema({
  levelName: { type: String, required: true, unique: true, trim: true, maxlength: 32 },
  // Speeds are logical Canvas pixels per second, independent of frame rate.
  aiSpeed: { type: Number, default: 200, min: 1, max: 2000, required: true },
  ballSpeed: { type: Number, default: 300, min: 1, max: 2000, required: true },
  isActive: { type: Boolean, default: true, required: true },
}, { timestamps: true, bufferCommands: false });

module.exports = mongoose.model('DifficultySetting', difficultySchema);
