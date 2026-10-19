const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { requireRole } = require('../middleware/auth');
const app = require('../app');

// Only database calls are mocked. HTTP, validation, bcrypt, and JWT are real.
// These tests never load .env or connect to Atlas.
const users = new Map();
const testSecret = 'isolated-test-signing-secret-never-use-in-production';
const password = 'DemoPass_2026!';
const previousSecret = process.env.JWT_SECRET;
let server;
let base;
let registered;

before(async () => {
  process.env.JWT_SECRET = testSecret;

  mock.method(User, 'create', async data => {
    if ([...users.values()].some(user => user.username === data.username)) {
      const error = new Error('Simulated duplicate');
      error.code = 11000;
      throw error;
    }
    const document = new User(data);
    await document.validate();
    const user = document.toObject();
    user.createdAt = new Date();
    user.updatedAt = new Date();
    users.set(user._id.toString(), user);
    return user;
  });
  mock.method(User, 'findOne', query => ({
    select: async selection => {
      assert.equal(selection, '+passwordHash');
      return [...users.values()].find(user => user.username === query.username) || null;
    },
  }));
  mock.method(User, 'findById', async id => users.get(id) || null);

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  mock.restoreAll();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

async function request(path, { body, token, method = 'GET' } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

test('User schema normalizes usernames, validates roles, and declares a unique index', async () => {
  const user = new User({ username: '  Example_PLAYER  ', passwordHash: 'test-hash' });
  assert.equal(user.username, 'example_player');
  assert.equal(user.role, 'PLAYER');
  assert.equal(User.schema.path('passwordHash').options.select, false);
  assert(User.schema.options.timestamps);
  assert(User.schema.indexes().some(([keys, options]) => keys.username === 1 && options.unique));
  user.role = 'OWNER';
  await assert.rejects(user.validate());
});

test('health response remains unchanged', async () => {
  const result = await request('/api/health');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { status: 'ok', message: 'Pickle Ball Pixel Game API is running' });
});

test('registration creates a PLAYER with a real bcrypt hash and safe response', async () => {
  const result = await request('/api/auth/register', {
    method: 'POST', body: { username: '  Student_ONE  ', password },
  });
  assert.equal(result.status, 201);
  registered = result.data;
  assert.equal(registered.user.username, 'student_one');
  assert.equal(registered.user.role, 'PLAYER');
  assert(registered.user.createdAt && registered.user.updatedAt);
  assert(!('passwordHash' in registered.user));
  assert(!JSON.stringify(registered).includes(password));
  const stored = users.get(registered.user.id);
  assert(stored.passwordHash !== password);
  assert.equal(bcrypt.getRounds(stored.passwordHash), 12);
  assert(await bcrypt.compare(password, stored.passwordHash));
  const payload = jwt.verify(registered.token, testSecret, { algorithms: ['HS256'] });
  assert.equal(payload.sub, registered.user.id);
  assert.equal(payload.exp - payload.iat, 86400);
});

test('case-insensitive duplicate username returns 409, including duplicate-key handling', async () => {
  const result = await request('/api/auth/register', {
    method: 'POST', body: { username: 'STUDENT_one', password },
  });
  assert.equal(result.status, 409);
  assert.deepEqual(result.data, { message: 'Username is already taken' });
});

test('registration rejects role injection and cannot create an Admin', async () => {
  const count = users.size;
  for (const role of ['ADMIN', 'PLAYER']) {
    const result = await request('/api/auth/register', {
      method: 'POST', body: { username: 'injected_role', password, role },
    });
    assert.equal(result.status, 400);
  }
  assert.equal(users.size, count);
});

test('invalid credentials, objects, short passwords, and bcrypt truncation are rejected', async () => {
  for (const body of [
    {}, [], null,
    { username: 'ok_user' },
    { username: { $ne: null }, password },
    { username: 'bad name', password },
    { username: 'a'.repeat(25), password },
    { username: 'ok_user', password: 12345678 },
    { username: 'ok_user', password: 'short' },
    { username: 'ok_user', password: '        ' },
    { username: 'ok_user', password: 'a'.repeat(73) },
    { username: 'ok_user', password: '界'.repeat(25) },
    { username: 'ok_user', password, passwordHash: 'injected' },
  ]) {
    const result = await request('/api/auth/register', { method: 'POST', body });
    assert.equal(result.status, 400);
  }
  const result = await request('/api/auth/login', { method: 'POST', body: {} });
  assert.equal(result.status, 400);
});

test('valid login uses normalized username and returns a signed JWT', async () => {
  const result = await request('/api/auth/login', {
    method: 'POST', body: { username: 'STUDENT_ONE', password },
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.user.id, registered.user.id);
  assert(!('passwordHash' in result.data.user));
  assert.equal(jwt.verify(result.data.token, testSecret).sub, registered.user.id);
});

test('wrong password and unknown username have the same generic 401 response', async () => {
  const wrong = await request('/api/auth/login', {
    method: 'POST', body: { username: 'student_one', password: 'WrongPass_2026!' },
  });
  const unknown = await request('/api/auth/login', {
    method: 'POST', body: { username: 'unknown_player', password },
  });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.data, unknown.data);
});

test('profile requires a token', async () => {
  assert.equal((await request('/api/users/profile')).status, 401);
});

test('profile returns only the authenticated user, ignoring supplied query IDs', async () => {
  const other = await request('/api/auth/register', {
    method: 'POST', body: { username: 'student_two', password },
  });
  const result = await request(`/api/users/profile?userId=${other.data.user.id}`, { token: registered.token });
  assert.equal(result.status, 200);
  assert.equal(result.data.user.id, registered.user.id);
  assert(!('passwordHash' in result.data.user));
  assert.equal((await request(`/api/users/${other.data.user.id}`, { token: registered.token })).status, 404);
});

test('malformed, forged, expired, wrong-algorithm, and invalid-subject tokens are rejected', async () => {
  const sub = registered.user.id;
  for (const token of [
    'invalid-token',
    jwt.sign({ sub }, 'wrong-test-secret'),
    jwt.sign({ sub }, testSecret, { expiresIn: -1 }),
    jwt.sign({ sub }, testSecret, { algorithm: 'HS384' }),
    jwt.sign({ sub: 'not-an-id' }, testSecret),
    jwt.sign({}, testSecret),
  ]) {
    assert.equal((await request('/api/users/profile', { token })).status, 401);
  }
});

test('tokens belonging to nonexistent users are rejected', async () => {
  const token = jwt.sign({ sub: new mongoose.Types.ObjectId().toString() }, testSecret);
  assert.equal((await request('/api/users/profile', { token })).status, 401);
});

test('tokens belonging to a deleted mock user are rejected', async () => {
  const result = await request('/api/auth/register', {
    method: 'POST', body: { username: 'mock_deleted', password },
  });
  users.delete(result.data.user.id); // In-memory fixture only; never Atlas.
  assert.equal((await request('/api/users/profile', { token: result.data.token })).status, 401);
});

test('a token role claim cannot override the current database role', async () => {
  const token = jwt.sign({ sub: registered.user.id, role: 'ADMIN' }, testSecret);
  const result = await request('/api/users/profile', { token });
  assert.equal(result.status, 200);
  assert.equal(result.data.user.role, 'PLAYER');
});

test('reusable role middleware rejects unauthenticated users and Players, allows Admins', () => {
  const check = requireRole('ADMIN');
  for (const [user, expected] of [[undefined, 401], [{ role: 'PLAYER' }, 403], [{ role: 'ADMIN' }, 200]]) {
    let status = 200;
    let allowed = false;
    const res = { status(code) { status = code; return this; }, json() {} };
    check({ user }, res, () => { allowed = true; });
    assert.equal(status, expected);
    assert.equal(allowed, expected === 200);
  }
});

test('database failures return a safe 500 without internal details', async () => {
  const create = User.create;
  User.create = async () => { throw new Error('private-database-error-marker'); };
  try {
    const result = await request('/api/auth/register', {
      method: 'POST', body: { username: 'database_failure', password },
    });
    assert.equal(result.status, 500);
    assert.deepEqual(result.data, { message: 'Internal server error' });
  } finally {
    User.create = create;
  }
});

test('missing signing secret fails closed without creating an account', async () => {
  const count = users.size;
  process.env.JWT_SECRET = ' ';
  try {
    const result = await request('/api/auth/register', {
      method: 'POST', body: { username: 'missing_secret', password },
    });
    assert.equal(result.status, 500);
    assert.equal(users.size, count);
    assert.equal((await request('/api/users/profile', { token: registered.token })).status, 500);
  } finally {
    process.env.JWT_SECRET = testSecret;
  }
});

test('server rejects a missing JWT_SECRET before attempting database startup', () => {
  const result = spawnSync(process.execPath, ['server.js'], {
    env: { ...process.env, JWT_SECRET: ' ' }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert(result.stderr.includes('JWT_SECRET is required'));
  assert(!result.stdout.includes('API is running'));
  assert(!result.stdout.includes('MongoDB connected'));
});

test('existing CORS, JSON parsing errors, and unknown routes still work', async () => {
  const cors = await fetch(`${base}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(cors.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const malformed = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid',
  });
  assert.equal(malformed.status, 400);
  const oversized = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(110000) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await request('/api/missing')).status, 404);
});
