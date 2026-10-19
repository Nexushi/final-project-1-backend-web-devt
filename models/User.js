const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 24,
    match: /^[a-z0-9_]+$/,
  },
  passwordHash: {
    type: String,
    required: true,
    select: false,
  },
  // Optional so existing accounts remain valid without a data migration.
  preferredDifficultyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DifficultySetting',
    default: null,
  },
  role: {
    type: String,
    enum: ['PLAYER', 'ADMIN'],
    default: 'PLAYER',
    required: true,
  },
}, { timestamps: true, bufferCommands: false });

module.exports = mongoose.model('User', userSchema);
