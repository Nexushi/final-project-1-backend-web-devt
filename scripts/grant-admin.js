const User = require('../models/User');
const ApiError = require('../utils/ApiError');

async function grantAdmin(username, ask) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(username.trim())) {
    throw new ApiError(400, 'Provide one existing registered username (3-24 letters, digits, or underscores).');
  }
  const normalized = username.trim().toLowerCase();
  const user = await User.findOne({ username: normalized });
  if (!user) throw new ApiError(404, 'Account not found. Register a separate account first.');
  if (user.role === 'ADMIN') return { promoted: false, message: 'Account is already ADMIN; nothing changed.' };
  if (user.role !== 'PLAYER') throw new ApiError(409, 'Account role is not PLAYER; nothing changed.');

  const expected = `PROMOTE ${user.username}`;
  const answer = await ask(`Database: pickleball_game\nAccount: ${user.username} (${user._id})\nType ${expected} to grant ADMIN: `);
  if (answer !== expected) return { promoted: false, message: 'Confirmation did not match; nothing changed.' };

  const result = await User.updateOne(
    { _id: user._id, username: user.username, role: 'PLAYER' },
    { $set: { role: 'ADMIN' } }, { runValidators: true },
  );
  if (result.modifiedCount !== 1) throw new ApiError(409, 'Account changed; inspect it and rerun the command.');
  return { promoted: true, message: 'ADMIN granted to the confirmed account.' };
}

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const mongoose = require('mongoose');
  const connectDB = require('../config/db');
  const { createInterface } = require('node:readline/promises');

  async function run() {
    if (process.argv.length !== 3 || !process.stdin.isTTY || !process.stdout.isTTY) {
      throw new ApiError(400, 'Run npm run admin:grant -- existing_username in an interactive terminal. Typed confirmation is required.');
    }
    if (process.env.ATLAS_TEST_PUBLIC_DNS === '1') {
      const dns = require('node:dns');
      dns.setServers(['1.1.1.1', '8.8.8.8']);
      dns.promises.setServers(['1.1.1.1', '8.8.8.8']);
    }
    await connectDB();
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const result = await grantAdmin(process.argv[2], question => terminal.question(question));
      console.log(result.message);
    } finally {
      terminal.close();
    }
  }

  run().catch(err => {
    console.error(err instanceof ApiError ? err.message : 'Admin promotion failed. Check connection and database permissions. Details suppressed.');
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}

module.exports = grantAdmin;
