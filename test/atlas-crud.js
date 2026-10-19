// Opt-in Atlas test: creates clearly named accounts/matches and retains them.
// No DELETE requests, cleanup, or automatic difficulty seeding are performed.
require('dotenv').config({ quiet: true });
if (process.env.ATLAS_TEST_PUBLIC_DNS === '1') {
  const dns = require('node:dns');
  dns.setServers(['1.1.1.1', '8.8.8.8']);
  dns.promises.setServers(['1.1.1.1', '8.8.8.8']);
  console.log('Using a process-only DNS override for this test.');
}

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const getJWTSecret = require('../config/auth');
const User = require('../models/User');
const DifficultySetting = require('../models/DifficultySetting');
const Match = require('../models/Match');
const app = require('../app');

async function run() {
  let server;
  let step = 'configuration';
  try {
    getJWTSecret();
    step = 'Atlas connection and model initialization';
    const connection = await connectDB();
    assert(connection.name === 'pickleball_game');
    await User.init(); await DifficultySetting.init(); await Match.init();
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, method = 'GET', body, token) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    }

    // Check difficulty availability before writing any test accounts.
    step = 'public active difficulties (seed only after approval)';
    const difficultyResult = await request('/api/difficulty');
    assert(difficultyResult.status === 200 && difficultyResult.data.difficulties.length > 0);
    const difficulty = difficultyResult.data.difficulties[0];
    const accounts = [];
    const password = randomBytes(24).toString('hex');
    for (let i = 0; i < 2; i++) {
      step = 'creating clearly named test account';
      const username = `test4a_${randomBytes(6).toString('hex')}`;
      const registration = await request('/api/auth/register', 'POST', { username, password });
      assert(registration.status === 201);
      accounts.push(registration.data);
      console.log(`Retained test account: ${username}`);
    }
    const [player, other] = accounts;

    step = 'profile updates and uniqueness';
    const username = `${player.user.username}_p`;
    const profile = await request('/api/users/profile', 'PUT', { username, preferredDifficultyId: difficulty.id }, player.token);
    assert(profile.status === 200);
    assert(profile.data.user.preferredDifficultyId === difficulty.id);
    assert(profile.data.user.createdAt === player.user.createdAt);
    assert(!('passwordHash' in profile.data.user));
    console.log(`Retained renamed account: ${username}`);
    assert((await request('/api/users/profile', 'PUT', { username: other.user.username.toUpperCase() }, player.token)).status === 409);
    assert((await request('/api/users/profile', 'PUT', { role: 'ADMIN' }, player.token)).status === 400);
    assert((await request('/api/auth/login', 'POST', { username, password })).status === 200);

    step = 'transactional match creation';
    const created = await request('/api/matches', 'POST', { difficultyId: difficulty.id }, player.token);
    assert(created.status === 201);
    const item = created.data.match;
    console.log(`Retained test match: ${item.id} (owned by the test4a account)`);
    assert(item.userId === player.user.id && item.playerScore === 0 && item.version === 0);
    const stored = await Match.findById(item.id);
    assert(stored && stored.userId.toString() === player.user.id);

    step = 'match ownership and progress';
    assert((await request(`/api/matches/${item.id}`, 'GET', undefined, other.token)).status === 404);
    assert((await request(`/api/matches/${item.id}`, 'PATCH', { version: 0, playerScore: 1 }, other.token)).status === 404);
    const updated = await request(`/api/matches/${item.id}`, 'PATCH', { version: 0, playerScore: 2, aiScore: 1 }, player.token);
    assert(updated.status === 200 && updated.data.match.version === 1);
    const resumed = await request(`/api/matches/${item.id}`, 'GET', undefined, player.token);
    assert(resumed.status === 200 && resumed.data.match.playerScore === 2 && resumed.data.match.aiScore === 1);
    assert((await request(`/api/matches/${item.id}`, 'PATCH', { version: 0, playerScore: 3 }, player.token)).status === 409);

    step = 'concurrent saves';
    const results = await Promise.all([
      request(`/api/matches/${item.id}`, 'PATCH', { version: 1, playerScore: 3 }, player.token),
      request(`/api/matches/${item.id}`, 'PATCH', { version: 1, aiScore: 2 }, player.token),
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    step = 'completion and history';
    const completed = await request(`/api/matches/${item.id}`, 'PATCH', { version: 2, playerScore: 5, status: 'COMPLETED' }, player.token);
    assert(completed.status === 200 && completed.data.match.status === 'COMPLETED');
    assert((await request(`/api/matches/${item.id}`, 'PATCH', { version: 3, status: 'IN_PROGRESS' }, player.token)).status === 409);
    const history = await request('/api/matches', 'GET', undefined, player.token);
    assert(history.data.matches.length === 1 && history.data.matches[0].id === item.id);
    const otherHistory = await request('/api/matches', 'GET', undefined, other.token);
    assert(otherHistory.data.matches.length === 0);
    assert((await request('/api/health')).data.status === 'ok');
    console.log('PASS: real Atlas profile updates, duplicate rejection, transactional match creation, ownership, save/resume, concurrency, completion, history, and health.');
    console.log('Deletion endpoints were NOT called. All test records retained.');
  } catch {
    console.error(`FAIL: Atlas CRUD test at ${step}. Raw details suppressed; any created test records retained.`);
    process.exitCode = 1;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
  }
}

run().catch(() => { console.error('Atlas CRUD test cleanup failed. Raw details suppressed.'); process.exitCode = 1; });
