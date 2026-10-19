const mongoose = require('mongoose');
const { WINNING_SCORE } = require('../config/game');

const scoreField = {
  type: Number, default: 0, required: true, min: 0, max: WINNING_SCORE,
  validate: { validator: Number.isInteger, message: 'Scores must be whole numbers' },
};

const matchSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  difficultyId: { type: mongoose.Schema.Types.ObjectId, ref: 'DifficultySetting', required: true },
  // Keep the chosen speeds even if an Admin later changes/removes the level.
  difficultySnapshot: {
    levelName: { type: String, required: true },
    aiSpeed: { type: Number, required: true, min: 1, max: 2000 },
    ballSpeed: { type: Number, required: true, min: 1, max: 2000 },
  },
  playerScore: { ...scoreField },
  aiScore: { ...scoreField },
  status: { type: String, enum: ['IN_PROGRESS', 'COMPLETED'], default: 'IN_PROGRESS', required: true },
}, { timestamps: true, bufferCommands: false });

matchSchema.pre('validate', function () {
  const playerWon = this.playerScore === WINNING_SCORE;
  const aiWon = this.aiScore === WINNING_SCORE;
  if ((this.status === 'COMPLETED' && playerWon === aiWon) ||
      (this.status === 'IN_PROGRESS' && (playerWon || aiWon))) {
    this.invalidate('status', 'Status must agree with the winning score');
  }
});

matchSchema.index({ userId: 1, updatedAt: -1, _id: -1 });

module.exports = mongoose.model('Match', matchSchema);
