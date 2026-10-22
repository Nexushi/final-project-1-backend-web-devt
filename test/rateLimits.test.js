const { test, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MemoryStore, ipKeyGenerator } = require('express-rate-limit');
const limits = require('../middleware/rateLimits');
const User = require('../models/User');
const Match = require('../models/Match');
const DifficultySetting = require('../models/DifficultySetting');

// All persistence is mocked. Tests use the real app/routes and small local budgets.
const secret = 'rate-limit-suite-only-secret-never-use-in-production';
const origin = 'https://pickleball-demo.example';
const previousSecret = process.env.JWT_SECRET;
const previousOrigin = process.env.CORS_ORIGIN;
const playerId = '111111111111111111111111';
const otherId = '222222222222222222222222';
const difficultyId = '333333333333333333333333';
const password = 'RateLimitTest_2026!';
const users = new Map();
const matches = new Map();
const clone = value => value ? structuredClone(value) : value;
const matchesFilter = (record, filter) => Object.entries(filter).every(([key, value]) => String(record[key]) === String(value));
let hash;
let calls;

before(async () => {
  process.env.JWT_SECRET = secret;
  process.env.CORS_ORIGIN = origin;
  hash = await bcrypt.hash(password, 12);
  const realCompare = bcrypt.compare;
  mock.method(bcrypt, 'compare', async (...args) => { calls.compare++; return realCompare(...args); });
  mock.method(bcrypt, 'hash', async () => { calls.hash++; return hash; });
  mock.method(User, 'findById', async id => clone(users.get(String(id))) || null);
  mock.method(User, 'findOne', filter => ({ select: async () => {
    calls.loginLookup++;
    return clone([...users.values()].find(user => user.username === filter.username)) || null;
  } }));
  mock.method(User, 'create', async data => {
    calls.createUser++;
    const user = { ...data, _id: new mongoose.Types.ObjectId().toString(), createdAt: new Date(), updatedAt: new Date() };
    users.set(user._id, user);
    return clone(user);
  });
  mock.method(User, 'updateOne', async filter => ({ matchedCount: users.has(String(filter._id)) ? 1 : 0 }));
  mock.method(User, 'findOneAndUpdate', async (filter, update) => {
    calls.profileWrite++;
    const user = users.get(String(filter._id));
    if (!user) return null;
    Object.assign(user, update.$set);
    return clone(user);
  });
  mock.method(DifficultySetting, 'findOne', () => {
    const result = Promise.resolve({ _id: difficultyId, levelName: 'Easy', aiSpeed: 140, ballSpeed: 240, isActive: true });
    result.session = () => result;
    return result;
  });
  mock.method(DifficultySetting, 'updateOne', async () => ({ matchedCount: 1 }));
  mock.method(mongoose.connection, 'transaction', async callback => { calls.transaction++; return callback({ mockSession: true }); });
  mock.method(Match, 'create', async ([data]) => {
    calls.createMatch++;
    const document = new Match(data);
    await document.validate();
    const item = { ...data, _id: document._id.toString(), __v: 0, createdAt: new Date(), updatedAt: new Date() };
    matches.set(item._id, item);
    return [clone(item)];
  });
  mock.method(Match, 'findOne', async filter => clone([...matches.values()].find(item => matchesFilter(item, filter))) || null);
  mock.method(Match, 'findOneAndUpdate', async (filter, update) => {
    calls.saveMatch++;
    const item = [...matches.values()].find(record => matchesFilter(record, filter));
    if (!item) return null;
    Object.assign(item, update.$set, { __v: item.__v + 1, updatedAt: new Date() });
    return clone(item);
  });
  mock.method(Match, 'findOneAndDelete', async filter => {
    const item = [...matches.values()].find(record => matchesFilter(record, filter));
    if (item) matches.delete(item._id);
    return clone(item) || null;
  });
  mock.method(Match, 'find', filter => ({ sort: async () => [...matches.values()].filter(item => matchesFilter(item, filter)).map(clone) }));
});

beforeEach(() => {
  users.clear(); matches.clear();
  calls = { compare: 0, hash: 0, loginLookup: 0, createUser: 0, profileWrite: 0, transaction: 0, createMatch: 0, saveMatch: 0 };
  for (const [id, username] of [[playerId, 'rate_player'], [otherId, 'rate_other']]) {
    users.set(id, { _id: id, username, role: 'PLAYER', passwordHash: hash,
      createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-01') });
  }
});

after(() => {
  mock.restoreAll();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
  if (previousOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = previousOrigin;
});

async function startApp(t, overrides = {}, trustProxy) {
  const stores = [];
  const loggerMessages = [];
  const logger = { error: error => loggerMessages.push(error), warn: error => loggerMessages.push(error) };
  const policies = Object.fromEntries(Object.keys(limits.POLICIES).map(name => {
    const store = new MemoryStore();
    stores.push(store);
    return [name, { store, logger, ...overrides[name] }];
  }));
  const middleware = limits.createRateLimiters(policies);
  for (const name of Object.keys(limits.POLICIES)) t.mock.method(limits, name, middleware[name]);
  // Rebuild route modules to inject independent, test-only limiter instances.
  for (const file of ['../app', '../routes/authRoutes', '../routes/userRoutes', '../routes/matchRoutes', '../routes/adminRoutes']) {
    delete require.cache[require.resolve(file)];
  }
  const app = require('../app');
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    for (const store of stores) store.shutdown();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'POST', body, user, headers = {} } = {}) {
    headers = { Origin: origin, ...headers };
    if (user) headers.Authorization = `Bearer ${jwt.sign({ sub: user }, secret, { expiresIn: '1h' })}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = response.status === 204 ? null : await response.json();
    return { status: response.status, headers: response.headers, data };
  }
  return { app, request, loggerMessages };
}

const validLogin = { username: 'rate_player', password };
const wrongLogin = { username: 'rate_player', password: 'WrongPassword_2026!' };
// A TEST-ONLY trusted proxy: localhost transport and a fictional internal proxy range.
const fixtureTrust = ip => ip === '127.0.0.1' || ip.startsWith('10.');

function checkLimited(result) {
  assert.equal(result.status, 429);
  assert.deepEqual(result.data, { message: 'Too many requests. Please wait and try again.' });
  assert(Number(result.headers.get('retry-after')) > 0);
  assert(result.headers.get('ratelimit'));
  assert(result.headers.get('ratelimit-policy'));
  assert.equal(result.headers.get('x-powered-by'), null);
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('access-control-allow-origin'), origin);
}

test('normal registration/login retain tokens, PLAYER role and safe responses', async t => {
  const { request, app, loggerMessages } = await startApp(t);
  assert.equal(app.get('trust proxy'), false);
  const registered = await request('/api/auth/register', { body: { username: 'new_rate_player', password } });
  assert.equal(registered.status, 201);
  assert.equal(registered.data.user.role, 'PLAYER');
  assert(!('passwordHash' in registered.data.user));
  const loggedIn = await request('/api/auth/login', { body: validLogin });
  assert.equal(loggedIn.status, 200);
  assert.equal(jwt.verify(loggedIn.data.token, secret).sub, playerId);
  assert.equal(calls.hash, 1);
  assert.equal(calls.compare, 1);
  assert.deepEqual(loggerMessages, []);
});

test('login burst limit counts successful logins and blocks before bcrypt/database work', async t => {
  const { request } = await startApp(t, { loginBurst: { limit: 2 } });
  for (let i = 0; i < 2; i++) assert.equal((await request('/api/auth/login', { body: validLogin })).status, 200);
  checkLimited(await request('/api/auth/login', { body: validLogin }));
  assert.equal(calls.compare, 2);
  assert.equal(calls.loginLookup, 2);
});

test('successful logins are refunded from the longer failure budget', async t => {
  const { request } = await startApp(t, { loginFailures: { limit: 1 } });
  for (let i = 0; i < 3; i++) assert.equal((await request('/api/auth/login', { body: validLogin })).status, 200);
  assert.equal((await request('/api/auth/login', { body: wrongLogin })).status, 401);
  checkLimited(await request('/api/auth/login', { body: validLogin }));
  assert.equal(calls.compare, 4);
});

test('rotating usernames cannot evade login failure or registration budgets', async t => {
  const { request } = await startApp(t, { loginFailures: { limit: 2 }, registration: { limit: 2 } });
  for (const username of ['unknown_one', 'unknown_two']) {
    assert.equal((await request('/api/auth/login', { body: { username, password } })).status, 401);
    assert.equal((await request('/api/auth/register', { body: { username, password } })).status, 201);
  }
  checkLimited(await request('/api/auth/login', { body: validLogin }));
  checkLimited(await request('/api/auth/register', { body: { username: 'unknown_three', password } }));
  assert.equal(calls.loginLookup, 2);
  assert.equal(calls.compare, 0);
  assert.equal(calls.hash, 2);
  assert.equal(calls.createUser, 2);
});

test('counter expiry restores access without a permanent account lock', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const { request } = await startApp(t, { registration: { limit: 1, windowMs: 1000 } });
  assert.equal((await request('/api/auth/register', { body: {} })).status, 400);
  checkLimited(await request('/api/auth/register', { body: {} }));
  t.mock.timers.setTime(Date.now() + 1001);
  assert.equal((await request('/api/auth/register', { body: { username: 'after_reset', password } })).status, 201);
});

test('independent clients behind the explicit fixture proxy have independent network budgets', async t => {
  const { request, loggerMessages } = await startApp(t, { registration: { limit: 1 } }, fixtureTrust);
  const send = ip => request('/api/auth/register', { body: {}, headers: { 'X-Forwarded-For': ip } });
  assert.equal((await send('198.51.100.10, 10.0.0.2')).status, 400);
  checkLimited(await send('203.0.113.99, 198.51.100.10, 10.0.0.2'));
  assert.equal((await send('198.51.100.11, 10.0.0.2')).status, 400);
  assert.deepEqual(loggerMessages, []);
});

test('untrusted direct peers and untrusted intermediate proxies stop forwarded-chain traversal', () => {
  const app = express();
  app.set('trust proxy', fixtureTrust);
  for (const [peer, forwarded, expected] of [
    ['192.0.2.20', '203.0.113.99', '192.0.2.20'],
    ['127.0.0.1', '203.0.113.99, 192.0.2.20', '192.0.2.20'],
    ['127.0.0.1', '203.0.113.99, 198.51.100.10, 10.0.0.2', '198.51.100.10'],
  ]) {
    const req = Object.create(express.request);
    req.app = app;
    req.socket = { remoteAddress: peer };
    req.headers = { 'x-forwarded-for': forwarded };
    assert.equal(req.ip, expected);
  }
});

test('forged headers cannot bypass direct-mode limits and validation warnings remain active', async t => {
  const { request, loggerMessages } = await startApp(t, { registration: { limit: 1 } });
  assert.equal((await request('/api/auth/register', { body: {}, headers: {
    'X-Forwarded-For': '198.51.100.10', Forwarded: 'for=198.51.100.10', 'True-Client-IP': '198.51.100.10',
  } })).status, 400);
  checkLimited(await request('/api/auth/register', { body: {}, headers: {
    'X-Forwarded-For': '198.51.100.11', Forwarded: 'for=198.51.100.11', 'True-Client-IP': '198.51.100.11',
  } }));
  assert(loggerMessages.some(error => error.code === 'ERR_ERL_UNEXPECTED_X_FORWARDED_FOR'));
  assert(loggerMessages.some(error => error.code === 'ERR_ERL_FORWARDED_HEADER'));
});

test('IPv6 address rotation within a /56 and IPv4-mapped aliases share budgets', async t => {
  const { request, loggerMessages } = await startApp(t, { registration: { limit: 1 } }, fixtureTrust);
  const send = ip => request('/api/auth/register', { body: {}, headers: { 'X-Forwarded-For': ip } });
  assert.equal(ipKeyGenerator('2001:db8:1234:5600::1'), ipKeyGenerator('2001:db8:1234:56ff::2'));
  assert.equal((await send('2001:db8:1234:5600::1')).status, 400);
  checkLimited(await send('2001:db8:1234:56ff::2'));
  assert.equal((await send('2001:db8:1234:5700::1')).status, 400);
  assert.equal((await send('198.51.100.10')).status, 400);
  checkLimited(await send('::ffff:198.51.100.10'));
  assert.deepEqual(loggerMessages, []);
});

test('shared Wi-Fi logins retain a collective burst budget and independent account write budgets', async t => {
  const { request } = await startApp(t, { loginBurst: { limit: 3 }, accountWrites: { limit: 1 } });
  for (const username of ['rate_player', 'rate_other', 'rate_player']) {
    assert.equal((await request('/api/auth/login', { body: { username, password } })).status, 200);
  }
  checkLimited(await request('/api/auth/login', { body: validLogin }));
  assert.equal((await request('/api/users/profile', { method: 'PUT', user: playerId, body: { username: 'renamed_one' } })).status, 200);
  checkLimited(await request('/api/users/profile', { method: 'PUT', user: playerId, body: { username: 'renamed_again' } }));
  assert.equal((await request('/api/users/profile', { method: 'PUT', user: otherId, body: { username: 'renamed_two' } })).status, 200);
  assert.equal(calls.profileWrite, 2);
});

test('write budgets are shared across routes and cannot be bypassed by another match ID', async t => {
  const { request } = await startApp(t, { accountWrites: { limit: 1 } });
  assert.equal((await request('/api/users/profile', { method: 'PUT', user: playerId, body: { username: 'changed_player' } })).status, 200);
  checkLimited(await request('/api/matches', { user: playerId, body: { difficultyId } }));
  checkLimited(await request(`/api/matches/${difficultyId}`, { method: 'DELETE', user: playerId }));
  assert.equal(calls.createMatch, 0);
  assert.equal(calls.transaction, 1);
});

test('match creation budget rejects before transaction work while point saves remain available', async t => {
  const { request } = await startApp(t, { matchCreation: { limit: 1 } });
  const created = await request('/api/matches', { user: playerId, body: { difficultyId } });
  assert.equal(created.status, 201);
  checkLimited(await request('/api/matches', { user: playerId, body: { difficultyId } }));
  assert.equal(calls.transaction, 1);
  assert.equal(calls.createMatch, 1);
  assert.equal((await request(`/api/matches/${created.data.match.id}`, {
    method: 'PATCH', user: playerId, body: { version: 0, playerScore: 1 },
  })).status, 200);
});

test('ordinary rapid games can create, save each point, resume, complete and delete with default policies', async t => {
  const { request, loggerMessages } = await startApp(t);
  for (let game = 0; game < 5; game++) {
    const created = await request('/api/matches', { user: playerId, body: { difficultyId } });
    assert.equal(created.status, 201);
    let item = created.data.match;
    for (let score = 1; score <= 5; score++) {
      const saved = await request(`/api/matches/${item.id}`, { method: 'PATCH', user: playerId,
        body: { version: item.version, playerScore: score, status: score === 5 ? 'COMPLETED' : 'IN_PROGRESS' } });
      assert.equal(saved.status, 200);
      item = saved.data.match;
      assert.equal(item.version, score);
      assert.equal((await request(`/api/matches/${item.id}`, { method: 'GET', user: playerId })).status, 200);
    }
    assert.equal(item.status, 'COMPLETED');
    assert.equal((await request('/api/matches', { method: 'GET', user: playerId })).status, 200);
    assert.equal((await request(`/api/matches/${item.id}`, { method: 'DELETE', user: playerId })).status, 204);
  }
  assert.equal(calls.saveMatch, 25);
  assert.deepEqual(loggerMessages, []);
});

test('preflights and reads do not consume budgets; 401/403 remain authoritative', async t => {
  const { request } = await startApp(t, { registration: { limit: 1 }, accountWrites: { limit: 1 } });
  for (let i = 0; i < 3; i++) {
    const preflight = await request('/api/auth/register', { method: 'OPTIONS', headers: {
      'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type',
    } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.equal(preflight.headers.get('ratelimit'), null);
    assert.equal((await request('/api/users/profile', { method: 'GET', user: playerId })).status, 200);
  }
  assert.equal((await request('/api/auth/register', { body: { username: 'after_options', password } })).status, 201);
  assert.equal((await request('/api/users/profile', { method: 'PUT', body: { username: 'missing_token' } })).status, 401);
  assert.equal((await request('/api/admin/difficulty', { user: playerId, body: { levelName: 'Denied' } })).status, 403);
  assert.equal((await request('/api/users/profile', { method: 'PUT', user: playerId, body: { username: 'allowed_write' } })).status, 200);
  checkLimited(await request('/api/users/profile', { method: 'DELETE', user: playerId }));
  assert(users.has(playerId));
});
