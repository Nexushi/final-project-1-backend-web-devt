const mongoose = require('mongoose');
const Match = require('../models/Match');
const User = require('../models/User');
const DifficultySetting = require('../models/DifficultySetting');
const { WINNING_SCORE } = require('../config/game');
const { isObjectId, validateBody } = require('../utils/validation');
const ApiError = require('../utils/ApiError');
const safeMatch = require('../utils/safeMatch');

function ownedMatchFilter(req) {
  if (!isObjectId(req.params.id)) throw new ApiError(400, 'Invalid match ID');
  return { _id: req.params.id, userId: req.user._id };
}

async function createMatch(req, res) {
  validateBody(req.body, ['difficultyId']);
  if (!isObjectId(req.body.difficultyId)) throw new ApiError(400, 'Invalid difficultyId');

  const match = await mongoose.connection.transaction(async session => {
    const difficulty = await DifficultySetting.findOne({ _id: req.body.difficultyId, isActive: true }).session(session);
    if (!difficulty) throw new ApiError(400, 'Choose an active difficulty');

    // A write to the user serializes creation against account deletion.
    // Without it, a concurrent deletion could leave an orphaned new match.
    const user = await User.updateOne(
      { _id: req.user._id }, { $inc: { __v: 1 } }, { session, timestamps: false },
    );
    if (user.matchedCount !== 1) throw new ApiError(401, 'Account no longer exists');

    const [created] = await Match.create([{
      userId: req.user._id,
      difficultyId: difficulty._id,
      difficultySnapshot: {
        levelName: difficulty.levelName, aiSpeed: difficulty.aiSpeed, ballSpeed: difficulty.ballSpeed,
      },
      playerScore: 0,
      aiScore: 0,
      status: 'IN_PROGRESS',
    }], { session });
    return created;
  });

  res.status(201).json({ match: safeMatch(match) });
}

async function listMatches(req, res) {
  const matches = await Match.find({ userId: req.user._id }).sort({ updatedAt: -1, _id: -1 });
  res.json({ matches: matches.map(safeMatch) });
}

async function getMatch(req, res) {
  const match = await Match.findOne(ownedMatchFilter(req));
  // Use the same response for missing records and someone else's records.
  if (!match) throw new ApiError(404, 'Match not found');
  res.json({ match: safeMatch(match) });
}

async function updateMatch(req, res) {
  const filter = ownedMatchFilter(req);
  validateBody(req.body, ['playerScore', 'aiScore', 'status', 'version']);
  const { version } = req.body;
  if (!Number.isSafeInteger(version) || version < 0) throw new ApiError(400, 'A non-negative integer version is required');
  if (!['playerScore', 'aiScore', 'status'].some(field => field in req.body)) {
    throw new ApiError(400, 'Supply a score or status to update');
  }

  const current = await Match.findOne(filter);
  if (!current) throw new ApiError(404, 'Match not found');
  if (current.status === 'COMPLETED') throw new ApiError(409, 'Completed matches cannot be changed');
  if (current.__v !== version) throw new ApiError(409, 'Match changed; reload it before saving');

  const changes = {};
  for (const field of ['playerScore', 'aiScore']) {
    const score = field in req.body ? req.body[field] : current[field];
    if (!Number.isInteger(score) || score < 0 || score > WINNING_SCORE) {
      throw new ApiError(400, `Scores must be whole numbers from 0 to ${WINNING_SCORE}`);
    }
    if (score < current[field]) throw new ApiError(400, 'Scores cannot decrease');
    changes[field] = score;
  }
  changes.status = 'status' in req.body ? req.body.status : current.status;
  if (!['IN_PROGRESS', 'COMPLETED'].includes(changes.status)) throw new ApiError(400, 'Invalid match status');

  const playerWon = changes.playerScore === WINNING_SCORE;
  const aiWon = changes.aiScore === WINNING_SCORE;
  if ((changes.status === 'COMPLETED' && playerWon === aiWon) ||
      (changes.status === 'IN_PROGRESS' && (playerWon || aiWon))) {
    throw new ApiError(400, `Completion requires exactly one score of ${WINNING_SCORE}; winning scores must be saved as COMPLETED`);
  }

  if (changes.playerScore === current.playerScore && changes.aiScore === current.aiScore && changes.status === current.status) {
    return res.json({ match: safeMatch(current) });
  }

  // Compare and increment the version atomically so concurrent saves cannot overwrite each other.
  const updated = await Match.findOneAndUpdate(
    { ...filter, status: 'IN_PROGRESS', __v: version },
    { $set: changes, $inc: { __v: 1 } },
    { returnDocument: 'after', runValidators: true },
  );
  if (!updated) throw new ApiError(409, 'Match changed; reload it before saving');
  res.json({ match: safeMatch(updated) });
}

async function deleteMatch(req, res) {
  const match = await Match.findOneAndDelete(ownedMatchFilter(req));
  if (!match) throw new ApiError(404, 'Match not found');
  res.status(204).end();
}

module.exports = { createMatch, listMatches, getMatch, updateMatch, deleteMatch };
