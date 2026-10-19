// Opt-in integration test. Creates ONE clearly named account in Atlas.
// It never deletes test accounts or touches unrelated records.
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
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const connectDB = require('../config/db');
const getJWTSecret = require('../config/auth');
const User = require('../models/User');
const app = require('../app');

async function run() {
  let server;
  let step = 'configuration';
  const username = `test3c_${randomBytes(6).toString('hex')}`;
  const password = randomBytes(24).toString('hex');

  try {
    const secret = getJWTSecret();
    step = 'Atlas connection';
    const connection = await connectDB();
    assert(connection.name === 'pickleball_game');
    await User.init();

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, body, token) {
      const response = await fetch(`${base}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, data: await response.json() };
    }

    step = 'registration';
    const registration = await request('/api/auth/register', { username, password });
    assert(registration.status === 201);
    console.log(`Created test account: ${username} (retained; no deletion performed).`);
    const stored = await User.findById(registration.data.user.id).select('+passwordHash');
    assert(stored && stored.passwordHash !== password);
    assert(await bcrypt.compare(password, stored.passwordHash));
    assert(stored.role === 'PLAYER');
    assert(stored.createdAt && stored.updatedAt);
    assert(!('passwordHash' in registration.data.user));
    assert(jwt.verify(registration.data.token, secret).sub === stored.id);
    console.log('PASS: MongoDB stored a PLAYER with a bcrypt hash and timestamps; response is safe.');

    step = 'case-insensitive duplicate registration';
    assert((await request('/api/auth/register', { username: username.toUpperCase(), password })).status === 409);
    step = 'login';
    const login = await request('/api/auth/login', { username: username.toUpperCase(), password });
    assert(login.status === 200 && typeof login.data.token === 'string');
    assert((await request('/api/auth/login', { username, password: 'WrongTestPassword_2026!' })).status === 401);
    step = 'protected profile';
    assert((await request('/api/users/profile')).status === 401);
    const profile = await request('/api/users/profile', undefined, login.data.token);
    assert(profile.status === 200 && profile.data.user.id === stored.id);
    assert(!('passwordHash' in profile.data.user));
    assert((await request('/api/users/profile', undefined, 'invalid-test-token')).status === 401);
    const expired = jwt.sign({ sub: stored.id }, secret, { expiresIn: -1 });
    assert((await request('/api/users/profile', undefined, expired)).status === 401);
    step = 'role injection rejection';
    assert((await request('/api/auth/register', { username, password, role: 'ADMIN' })).status === 400);
    step = 'health';
    const health = await request('/api/health');
    assert(health.status === 200);
    assert.deepEqual(health.data, { status: 'ok', message: 'Pickle Ball Pixel Game API is running' });
    console.log('PASS: real Atlas registration, duplicate rejection, login/JWT, protected profile, token rejection, Admin injection rejection, and health.');
  } catch {
    // Never print assertions or driver errors that could contain credentials.
    console.error(`FAIL: Atlas integration check at ${step}. Raw error details suppressed.`);
    console.error(`If registration succeeded, keep test account ${username} until cleanup is approved.`);
    process.exitCode = 1;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
  }
}

run().catch(() => {
  console.error('Atlas test cleanup failed. Raw details suppressed.');
  process.exitCode = 1;
});
