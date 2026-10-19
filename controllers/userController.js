const safeUser = require('../utils/safeUser');
const mongoose = require('mongoose');
const User = require('../models/User');
const Match = require('../models/Match');
const DifficultySetting = require('../models/DifficultySetting');
const ApiError = require('../utils/ApiError');
const { isObjectId, validateBody } = require('../utils/validation');

function getProfile(req, res) {
  res.json({ user: safeUser(req.user) });
}

async function updateProfile(req, res, next) {
  try {
    validateBody(req.body, ['username', 'preferredDifficultyId']);
    const changes = {};

    if ('username' in req.body) {
      if (typeof req.body.username !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(req.body.username.trim())) {
        throw new ApiError(400, 'Username must be 3-24 letters, numbers, or underscores');
      }
      changes.username = req.body.username.trim().toLowerCase();
    }

    if ('preferredDifficultyId' in req.body) {
      const id = req.body.preferredDifficultyId;
      if (id !== null && !isObjectId(id)) throw new ApiError(400, 'Invalid preferredDifficultyId');
      changes.preferredDifficultyId = id;
    }

    const user = await mongoose.connection.transaction(async session => {
      if (changes.preferredDifficultyId) {
        const difficulty = await DifficultySetting.findOne({ _id: changes.preferredDifficultyId, isActive: true }).session(session);
        if (!difficulty) throw new ApiError(400, 'Choose an active difficulty');
        // Keep a new preference from racing an Admin's difficulty deletion.
        const level = await DifficultySetting.updateOne(
          { _id: difficulty._id, isActive: true }, { $inc: { __v: 1 } }, { session, timestamps: false },
        );
        if (level.matchedCount !== 1) throw new ApiError(409, 'Difficulty changed; choose an active level again');
      }
      return User.findOneAndUpdate(
        { _id: req.user._id }, { $set: changes }, { returnDocument: 'after', runValidators: true, session },
      );
    });
    if (!user) throw new ApiError(401, 'Account no longer exists');
    res.json({ user: safeUser(user) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Username is already taken' });
    }
    next(err);
  }
}

async function deleteProfile(req, res) {
  // Both deletions commit together or neither takes effect. No partial cleanup.
  await mongoose.connection.transaction(async session => {
    const result = await User.deleteOne({ _id: req.user._id }, { session });
    if (result.deletedCount !== 1) throw new ApiError(401, 'Account no longer exists');
    await Match.deleteMany({ userId: req.user._id }, { session });
  });
  res.status(204).end();
}

module.exports = { getProfile, updateProfile, deleteProfile };
