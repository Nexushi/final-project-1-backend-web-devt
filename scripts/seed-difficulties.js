const mongoose = require('mongoose');
const connectDB = require('../config/db');
const DifficultySetting = require('../models/DifficultySetting');
const { DEFAULT_DIFFICULTIES } = require('../config/game');

async function seedDifficulties() {
  let inserted = 0;
  for (const difficulty of DEFAULT_DIFFICULTIES) {
    const result = await DifficultySetting.updateOne(
      { levelName: difficulty.levelName },
      { $setOnInsert: difficulty },
      // Disabling timestamps also leaves existing updatedAt values untouched.
      { upsert: true, runValidators: true, timestamps: false },
    );
    inserted += result.upsertedCount;
  }
  console.log(`Difficulty seed complete: ${inserted} inserted; existing settings preserved.`);
}

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  // Optional workaround belongs to this manual command, never server startup.
  if (process.env.ATLAS_TEST_PUBLIC_DNS === '1') {
    const dns = require('node:dns');
    dns.setServers(['1.1.1.1', '8.8.8.8']);
    dns.promises.setServers(['1.1.1.1', '8.8.8.8']);
  }
  async function run() {
    await connectDB();
    await DifficultySetting.init();
    await seedDifficulties();
  }
  run().catch(() => {
    console.error('Difficulty seed failed. Check connection, permissions, and unique level names. Details suppressed.');
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}

module.exports = seedDifficulties;
