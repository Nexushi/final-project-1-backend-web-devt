const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Match = require('../models/Match');
const DifficultySetting = require('../models/DifficultySetting');

// Real middleware, HTTP, bcrypt and JWT; no .env, Atlas, or persistent writes.
const previousSecret = process.env.JWT_SECRET;
const previousOrigin = process.env.CORS_ORIGIN;
const secret = 'security-suite-only-secret-never-use-in-production';
const origin = 'https://pickleball-demo.example';
const password = 'SecurityTest_2026!';
const playerId = '111111111111111111111111';
const adminId = '222222222222222222222222';
const users = new Map();
let server;
let base;
let playerToken;
let adminToken;
let failLookup = false;
let loginLookups = 0;

before(async () => {
  process.env.JWT_SECRET = secret;
  process.env.CORS_ORIGIN = origin;
  const hash = await bcrypt.hash(password, 12);
  for (const [id, username, role] of [[playerId, 'security_player', 'PLAYER'], [adminId, 'security_admin', 'ADMIN']]) {
    users.set(id, { _id: id, username, role, passwordHash: hash,
      createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-01') });
  }
  mock.method(User, 'findById', async id => {
    if (failLookup) throw new Error('private security-suite database marker');
    return users.get(String(id)) || null;
  });
  mock.method(User, 'findOne', filter => ({ select: async () => {
    loginLookups += 1;
    return [...users.values()].find(user => user.username === filter.username) || null;
  } }));
  mock.method(User, 'create', async data => {
    const user = { ...data, _id: '333333333333333333333333', createdAt: new Date(), updatedAt: new Date() };
    users.set(user._id, user);
    return user;
  });
  mock.method(User, 'find', filter => ({ sort: async () => [...users.values()].filter(user => user.role === filter.role) }));
  mock.method(Match, 'find', () => ({ sort: async () => [] }));
  mock.method(DifficultySetting, 'find', () => ({ sort: async () => [] }));
  const app = require('../app');
  playerToken = jwt.sign({ sub: playerId }, secret, { expiresIn: '1h' });
  adminToken = jwt.sign({ sub: adminId }, secret, { expiresIn: '1h' });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  mock.restoreAll();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
  if (previousOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = previousOrigin;
});

function checkSecurityHeaders(response) {
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert(response.headers.get('content-security-policy').includes("default-src 'self'"));
  assert(response.headers.get('strict-transport-security').includes('max-age='));
  // Preserve this API's cross-origin resource use; the exact CORS allowlist remains authoritative.
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal(response.headers.get('cross-origin-embedder-policy'), null);
}

async function request(path, { token, method = 'GET', body, headers = {} } = {}) {
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${base}${path}`, { method, headers, body });
}

test('Helmet secures public success and not-found responses without changing JSON', async () => {
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  checkSecurityHeaders(health);
  assert.equal(health.headers.get('cache-control'), null);
  assert.deepEqual(await health.json(), { status: 'ok', message: 'Pickle Ball Pixel Game API is running' });
  const missing = await request('/api/not-a-route');
  assert.equal(missing.status, 404);
  checkSecurityHeaders(missing);
  assert.deepEqual(await missing.json(), { message: 'Route not found' });
});

test('registration and login token responses have no-store and safe unchanged formats', async () => {
  for (const [path, username, expected] of [
    ['/api/auth/register', 'security_new', 201], ['/api/auth/login', 'security_player', 200],
  ]) {
    const response = await request(path, { method: 'POST', body: JSON.stringify({ username, password }) });
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    checkSecurityHeaders(response);
    const data = await response.json();
    assert.deepEqual(Object.keys(data).sort(), ['message', 'token', 'user']);
    assert.equal(data.user.username, username);
    assert.equal(data.user.role, 'PLAYER');
    assert(!('passwordHash' in data.user));
    assert.equal(jwt.verify(data.token, secret).sub, data.user.id);
  }
});

test('personal profile, match history and Admin lists have no-store', async () => {
  for (const [path, token, key] of [
    ['/api/users/profile', playerToken, 'user'], ['/api/matches', playerToken, 'matches'],
    ['/api/admin/users', adminToken, 'users'], ['/api/admin/matches', adminToken, 'matches'],
    ['/api/admin/difficulty', adminToken, 'difficulties'],
  ]) {
    const response = await request(path, { token });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    checkSecurityHeaders(response);
    assert(key in await response.json());
  }
  const publicDifficulty = await request('/api/difficulty');
  assert.equal(publicDifficulty.status, 200);
  assert.equal(publicDifficulty.headers.get('cache-control'), null);
});

test('auth validation, login failures, denied access and private 404s retain security/no-store headers', async () => {
  for (const [path, options, expected] of [
    ['/api/auth/register', { method: 'POST', body: '{}' }, 400],
    ['/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'unknown_player', password }) }, 401],
    ['/api/users/profile', {}, 401], ['/api/matches', {}, 401], ['/api/admin/users', {}, 401],
    ['/api/admin/users', { token: playerToken }, 403], ['/api/users/not-a-route', {}, 404],
  ]) {
    const response = await request(path, options);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    checkSecurityHeaders(response);
    await response.json();
  }
});

test('unexpected protected-route errors remain generic and cannot be stored', async () => {
  failLookup = true;
  try {
    const response = await request('/api/users/profile', { token: playerToken });
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    checkSecurityHeaders(response);
    assert.deepEqual(await response.json(), { message: 'Internal server error' });
  } finally { failLookup = false; }
});

test('localhost and configured frontend origins still read protected JSON with security headers', async () => {
  for (const allowedOrigin of ['http://localhost:5173', origin]) {
    const response = await request('/api/users/profile', { token: playerToken, headers: { Origin: allowedOrigin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
    assert(response.headers.get('vary').includes('Origin'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    checkSecurityHeaders(response);
    assert.equal((await response.json()).user.id, playerId);
  }
  for (const deniedOrigin of ['https://other.example', `${origin}.evil.example`]) {
    const response = await request('/api/users/profile', { headers: { Origin: deniedOrigin } });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    checkSecurityHeaders(response);
    await response.json();
  }
});

test('CORS preflight retains Authorization, Content-Type and write methods with Helmet', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await request('/api/matches', { method: 'OPTIONS', headers: {
      Origin: origin, 'Access-Control-Request-Method': method,
      'Access-Control-Request-Headers': 'authorization,content-type',
    } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert(response.headers.get('access-control-allow-methods').split(',').includes(method));
    assert.equal(response.headers.get('access-control-allow-headers'), 'authorization,content-type');
    checkSecurityHeaders(response);
    assert.equal(await response.text(), '');
  }
});

function loginBodyOfSize(bytes) {
  const json = JSON.stringify({ username: 'security_player', password });
  return json + ' '.repeat(bytes - Buffer.byteLength(json));
}

test('JSON limit accepts 102399 and 102400 bytes and rejects 102401 before database access', async () => {
  for (const bytes of [102399, 102400, 102401]) {
    const body = loginBodyOfSize(bytes);
    assert.equal(Buffer.byteLength(body), bytes);
    const beforeLookups = loginLookups;
    const response = await request('/api/auth/login', { method: 'POST', body, headers: { Origin: origin } });
    assert.equal(response.status, bytes <= 102400 ? 200 : 413);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    checkSecurityHeaders(response);
    const data = await response.json();
    if (bytes > 102400) {
      assert.equal(loginLookups, beforeLookups);
      assert.deepEqual(data, { message: 'Request body is too large' });
    } else assert.equal(data.user.id, playerId);
  }
});

test('compressed JSON keeps the same decompressed 100 KB limit', async () => {
  for (const bytes of [102400, 102401]) {
    const body = gzipSync(loginBodyOfSize(bytes));
    const response = await request('/api/auth/login', { method: 'POST', body, headers: { 'Content-Encoding': 'gzip' } });
    assert.equal(response.status, bytes <= 102400 ? 200 : 413);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    checkSecurityHeaders(response);
    const data = await response.json();
    if (bytes > 102400) assert.deepEqual(data, { message: 'Request body is too large' });
    else assert.equal(data.user.id, playerId);
  }
});

test('malformed JSON on each sensitive API prefix retains safe errors, CORS and no-store', async () => {
  for (const path of ['/api/auth/login', '/api/users/profile', '/api/matches', '/api/admin/difficulty']) {
    const response = await request(path, { method: 'POST', body: '{invalid', headers: { Origin: origin } });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    checkSecurityHeaders(response);
    assert.deepEqual(await response.json(), { message: 'Invalid JSON request body' });
  }
});
