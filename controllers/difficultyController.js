const DifficultySetting = require('../models/DifficultySetting');

async function listDifficulties(req, res) {
  const settings = await DifficultySetting.find({ isActive: true }).sort({ aiSpeed: 1, levelName: 1 });
  res.json({ difficulties: settings.map(setting => ({
    id: setting._id.toString(),
    levelName: setting.levelName,
    aiSpeed: setting.aiSpeed,
    ballSpeed: setting.ballSpeed,
    isActive: setting.isActive,
  })) });
}

module.exports = { listDifficulties };
