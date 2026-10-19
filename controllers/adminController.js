const mongoose = require('mongoose');
const User = require('../models/User');
const Match = require('../models/Match');
const DifficultySetting = require('../models/DifficultySetting');
const safeUser = require('../utils/safeUser');
const safeMatch = require('../utils/safeMatch');
const { isObjectId, validateBody } = require('../utils/validation');
const ApiError = require('../utils/ApiError');

function validateId(id) {
  if (!isObjectId(id)) throw new ApiError(400, 'Invalid ID');
}

function safeDifficulty(setting) {
  return {
    id: setting._id.toString(),
    levelName: setting.levelName,
    aiSpeed: setting.aiSpeed,
    ballSpeed: setting.ballSpeed,
    isActive: setting.isActive,
  };
}

function difficultyChanges(body, creating = false) {
  validateBody(body, ['levelName', 'aiSpeed', 'ballSpeed', 'isActive']);
  const changes = {};
  if (creating || 'levelName' in body) {
    if (typeof body.levelName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,31}$/.test(body.levelName.trim())) {
      throw new ApiError(400, 'Level name must be 1-32 letters, numbers, spaces, underscores, or hyphens, starting with a letter or number');
    }
    changes.levelName = body.levelName.trim();
  }
  for (const field of ['aiSpeed', 'ballSpeed']) {
    if (field in body) {
      if (typeof body[field] !== 'number' || !Number.isFinite(body[field]) || body[field] < 1 || body[field] > 2000) {
        throw new ApiError(400, 'Speeds must be numbers from 1 to 2000 pixels per second');
      }
      changes[field] = body[field];
    }
  }
  if ('isActive' in body) {
    if (typeof body.isActive !== 'boolean') throw new ApiError(400, 'isActive must be true or false');
    changes.isActive = body.isActive;
  }
  return changes;
}

async function listPlayers(req, res) {
  const players = await User.find({ role: 'PLAYER' }).sort({ createdAt: -1, _id: -1 });
  res.json({ users: players.map(safeUser) });
}

async function listMatches(req, res) {
  const matches = await Match.find({}).sort({ updatedAt: -1, _id: -1 });
  res.json({ matches: matches.map(safeMatch) });
}

async function deletePlayer(req, res) {
  validateId(req.params.id);
  if (req.params.id.toLowerCase() === req.user._id.toString()) {
    throw new ApiError(403, 'Admin accounts cannot be deleted through this route');
  }
  await mongoose.connection.transaction(async session => {
    const target = await User.findById(req.params.id).session(session);
    if (!target) throw new ApiError(404, 'Player not found');
    if (target.role !== 'PLAYER') throw new ApiError(403, 'Admin accounts cannot be deleted through this route');

    // The role filter protects a player concurrently promoted to Admin.
    const result = await User.deleteOne({ _id: target._id, role: 'PLAYER' }, { session });
    if (result.deletedCount !== 1) throw new ApiError(409, 'Player changed; reload before deleting');
    await Match.deleteMany({ userId: target._id }, { session });
  });
  res.status(204).end();
}

async function listDifficulties(req, res) {
  const settings = await DifficultySetting.find({}).sort({ aiSpeed: 1, levelName: 1 });
  res.json({ difficulties: settings.map(safeDifficulty) });
}

async function createDifficulty(req, res, next) {
  try {
    const setting = await DifficultySetting.create(difficultyChanges(req.body, true));
    res.status(201).json({ difficulty: safeDifficulty(setting) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Level name is already taken' });
    next(err);
  }
}

async function updateDifficulty(req, res, next) {
  try {
    validateId(req.params.id);
    const setting = await DifficultySetting.findOneAndUpdate(
      { _id: req.params.id }, { $set: difficultyChanges(req.body) },
      { returnDocument: 'after', runValidators: true },
    );
    if (!setting) throw new ApiError(404, 'Difficulty not found');
    res.json({ difficulty: safeDifficulty(setting) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Level name is already taken' });
    next(err);
  }
}

async function deleteDifficulty(req, res) {
  validateId(req.params.id);
  await mongoose.connection.transaction(async session => {
    // Deleting first locks this document. New references also write its version,
    // so a concurrent match/preference cannot slip past the reference checks.
    const setting = await DifficultySetting.findOneAndDelete({ _id: req.params.id }, { session });
    if (!setting) throw new ApiError(404, 'Difficulty not found');
    const match = await Match.exists({ difficultyId: setting._id }).session(session);
    const preference = await User.exists({ preferredDifficultyId: setting._id }).session(session);
    if (match || preference) {
      throw new ApiError(409, 'Difficulty is still referenced; deactivate it instead');
    }
  });
  res.status(204).end();
}

module.exports = { listPlayers, listMatches, deletePlayer, listDifficulties, createDifficulty, updateDifficulty, deleteDifficulty };
