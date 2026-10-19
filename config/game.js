// Simplified rally scoring: first to five, with no win-by-two extension.
const WINNING_SCORE = 5;

const DEFAULT_DIFFICULTIES = [
  { levelName: 'Easy', aiSpeed: 140, ballSpeed: 240, isActive: true },
  { levelName: 'Medium', aiSpeed: 200, ballSpeed: 300, isActive: true },
  { levelName: 'Hard', aiSpeed: 260, ballSpeed: 360, isActive: true },
];

module.exports = { WINNING_SCORE, DEFAULT_DIFFICULTIES };
