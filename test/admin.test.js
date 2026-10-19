const { test, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Match = require('../models/Match');
const DifficultySetting = require('../models/DifficultySetting');
const grantAdmin = require('../scripts/grant-admin');
const app = require('../app');

// No .env, Atlas connection, real promotions, or real deletions in this suite.
const ids = {
  admin: '111111111111111111111111', player: '222222222222222222222222',
  other: '333333333333333333333333', easy: '444444444444444444444444',
  inactive: '555555555555555555555555', missing: '666666666666666666666666',
};
const secret = 'admin-suite-only-secret-never-use-in-production';
const previousSecret = process.env.JWT_SECRET;
const users = new Map();
const matches = new Map();
const levels = new Map();
const session = { mockSession: true };
const clone = value => value ? structuredClone(value) : value;
let failCleanup;
let failReferenceCheck;
let server;
let base;

function lookup(store, filter) {
  return [...store.values()].find(item => Object.entries(filter).every(([key, value]) => String(item[key]) === String(value)));
}
function query(value) {
  const promise = Promise.resolve(clone(value) || null);
  promise.session = passed => { assert.equal(passed, session); return promise; };
  return promise;
}

before(async () => {
  process.env.JWT_SECRET = secret;
  mock.method(User, 'findById', id => query(users.get(id)));
  mock.method(User, 'findOne', filter => query(lookup(users, filter)));
  mock.method(User, 'find', filter => ({ sort: async () => [...users.values()].filter(user => user.role === filter.role).map(clone) }));
  mock.method(User, 'exists', filter => query(lookup(users, filter)));
  mock.method(User, 'deleteOne', async (filter, options) => {
    assert.equal(options.session, session);
    assert.equal(filter.role, 'PLAYER');
    const user = lookup(users, filter);
    if (user) users.delete(user._id);
    return { deletedCount: user ? 1 : 0 };
  });
  mock.method(User, 'updateOne', async (filter, update, options) => {
    assert(options.runValidators);
    assert.equal(filter.role, 'PLAYER');
    const user = lookup(users, filter);
    if (user) Object.assign(user, update.$set);
    return { modifiedCount: user ? 1 : 0 };
  });
  mock.method(Match, 'find', () => ({ sort: async () => [...matches.values()].map(clone) }));
  mock.method(Match, 'exists', filter => {
    if (failReferenceCheck) throw new Error('private database reference error');
    return query(lookup(matches, filter));
  });
  mock.method(Match, 'deleteMany', async (filter, options) => {
    assert.equal(options.session, session);
    if (failCleanup) throw new Error('private cleanup error');
    for (const [id, item] of matches) if (String(item.userId) === String(filter.userId)) matches.delete(id);
  });
  mock.method(DifficultySetting, 'find', filter => ({ sort: async () => [...levels.values()]
    .filter(level => filter.isActive === undefined || level.isActive === filter.isActive).map(clone) }));
  mock.method(DifficultySetting, 'create', async data => {
    if ([...levels.values()].some(level => level.levelName === data.levelName)) {
      throw Object.assign(new Error('duplicate'), { code: 11000 });
    }
    const document = new DifficultySetting(data);
    await document.validate();
    const level = { ...document.toObject(), _id: document._id.toString() };
    levels.set(level._id, level);
    return clone(level);
  });
  mock.method(DifficultySetting, 'findOneAndUpdate', async (filter, update, options) => {
    assert(options.runValidators);
    const level = lookup(levels, filter);
    if (!level) return null;
    if (update.$set.levelName && [...levels.values()].some(other => other._id !== level._id && other.levelName === update.$set.levelName)) {
      throw Object.assign(new Error('duplicate'), { code: 11000 });
    }
    Object.assign(level, update.$set);
    return clone(level);
  });
  mock.method(DifficultySetting, 'findOneAndDelete', async (filter, options) => {
    assert.equal(options.session, session);
    const level = lookup(levels, filter);
    if (level) levels.delete(level._id);
    return clone(level) || null;
  });
  mock.method(mongoose.connection, 'transaction', async callback => {
    const snapshots = [users, matches, levels].map(store => clone([...store]));
    try {
      return await callback(session);
    } catch (error) {
      [users, matches, levels].forEach((store, i) => {
        store.clear();
        for (const [id, item] of snapshots[i]) store.set(id, item);
      });
      throw error;
    }
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  users.clear(); matches.clear(); levels.clear();
  failCleanup = false; failReferenceCheck = false;
  for (const [id, username, role] of [[ids.admin, 'mock_admin', 'ADMIN'], [ids.player, 'mock_player', 'PLAYER'], [ids.other, 'mock_other', 'PLAYER']]) {
    users.set(id, { _id: id, username, role, passwordHash: 'private-hash-marker', createdAt: new Date(), updatedAt: new Date() });
  }
  levels.set(ids.easy, { _id: ids.easy, levelName: 'Easy', aiSpeed: 140, ballSpeed: 240, isActive: true });
  levels.set(ids.inactive, { _id: ids.inactive, levelName: 'Unused', aiSpeed: 100, ballSpeed: 200, isActive: false });
  for (const [id, userId] of [['777777777777777777777777', ids.player], ['888888888888888888888888', ids.other]]) {
    matches.set(id, { _id: id, userId, difficultyId: ids.easy,
      difficultySnapshot: { levelName: 'Easy', aiSpeed: 140, ballSpeed: 240 },
      playerScore: 5, aiScore: 2, status: 'COMPLETED', __v: 1, createdAt: new Date(), updatedAt: new Date() });
  }
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  mock.restoreAll();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

async function request(path, method = 'GET', body, user = ids.admin, tokenOverride) {
  const headers = {};
  if (user) headers.Authorization = `Bearer ${tokenOverride || jwt.sign({ sub: user }, secret, { expiresIn: '1h' })}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}

const adminRequests = [
  ['/api/admin/users', 'GET'], ['/api/admin/matches', 'GET'], ['/api/admin/difficulty', 'GET'],
  [`/api/admin/users/${ids.other}`, 'DELETE'], ['/api/admin/difficulty', 'POST'],
  [`/api/admin/difficulty/${ids.easy}`, 'PUT'], [`/api/admin/difficulty/${ids.inactive}`, 'DELETE'],
];

test('all Admin endpoints reject unauthenticated requests with 401 and Players with 403', async () => {
  for (const [path, method] of adminRequests) {
    assert.equal((await request(path, method, undefined, null)).status, 401);
    assert.equal((await request(path, method, undefined, ids.player)).status, 403);
  }
  assert.equal(users.size, 3);
  assert.equal(levels.size, 2);
});

test('current MongoDB role wins over token claims and role changes take effect on next request', async () => {
  const forged = jwt.sign({ sub: ids.player, role: 'ADMIN' }, secret);
  assert.equal((await request('/api/admin/users', 'GET', undefined, ids.player, forged)).status, 403);
  const token = jwt.sign({ sub: ids.admin }, secret);
  assert.equal((await request('/api/admin/users', 'GET', undefined, ids.admin, token)).status, 200);
  users.get(ids.admin).role = 'PLAYER';
  assert.equal((await request('/api/admin/users', 'GET', undefined, ids.admin, token)).status, 403);
  users.delete(ids.admin);
  assert.equal((await request('/api/admin/users', 'GET', undefined, ids.admin, token)).status, 401);
});

test('Admin list returns only players and never hashes', async () => {
  const result = await request('/api/admin/users');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.users.map(user => user.id).sort(), [ids.player, ids.other].sort());
  assert(!JSON.stringify(result.data).includes('private-hash-marker'));
  assert(result.data.users.every(user => !('passwordHash' in user)));
});

test('Admin can view matches from multiple players with unchanged difficulty snapshots', async () => {
  const result = await request('/api/admin/matches');
  assert.equal(result.status, 200);
  assert.equal(result.data.matches.length, 2);
  assert(result.data.matches.every(item => item.difficultySnapshot.aiSpeed === 140));
});

test('Admin deletes only the chosen Player and associated matches, invalidating old tokens', async () => {
  const result = await request(`/api/admin/users/${ids.player}`, 'DELETE');
  assert.equal(result.status, 204);
  assert(!users.has(ids.player));
  assert(users.has(ids.admin) && users.has(ids.other));
  assert([...matches.values()].every(item => item.userId === ids.other));
  assert.equal((await request('/api/users/profile', 'GET', undefined, ids.player)).status, 401);
});

test('Admin deletion blocks self and other Admin accounts', async () => {
  assert.equal((await request(`/api/admin/users/${ids.admin}`, 'DELETE')).status, 403);
  users.get(ids.other).role = 'ADMIN';
  assert.equal((await request(`/api/admin/users/${ids.other}`, 'DELETE')).status, 403);
  assert.equal(users.size, 3);
});

test('Admin deletion validates IDs and handles nonexistent Players', async () => {
  assert.equal((await request('/api/admin/users/bad-id', 'DELETE')).status, 400);
  assert.equal((await request(`/api/admin/users/${ids.missing}`, 'DELETE')).status, 404);
});

test('Admin deletion rolls back both account and match changes on failure (mock transaction)', async () => {
  failCleanup = true;
  const result = await request(`/api/admin/users/${ids.player}`, 'DELETE');
  assert.equal(result.status, 500);
  assert.deepEqual(result.data, { message: 'Internal server error' });
  assert(users.has(ids.player));
  assert.equal(matches.size, 2);
});

test('Admin difficulty list includes active and inactive configurations', async () => {
  const result = await request('/api/admin/difficulty');
  assert.equal(result.status, 200);
  assert.equal(result.data.difficulties.length, 2);
  assert(result.data.difficulties.some(level => level.isActive === false));
});

test('Admin creates a difficulty with defaults, edits it, deactivates and reactivates it', async () => {
  const created = await request('/api/admin/difficulty', 'POST', { levelName: ' Practice ' });
  assert.equal(created.status, 201);
  assert.equal(created.data.difficulty.levelName, 'Practice');
  assert.equal(created.data.difficulty.aiSpeed, 200);
  assert.equal(created.data.difficulty.ballSpeed, 300);
  assert.equal(created.data.difficulty.isActive, true);
  const path = `/api/admin/difficulty/${created.data.difficulty.id}`;
  const updated = await request(path, 'PUT', { aiSpeed: 180, ballSpeed: 250, levelName: 'Practice Two', isActive: false });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.difficulty.aiSpeed, 180);
  let visible = (await request('/api/difficulty', 'GET', undefined, null)).data.difficulties;
  assert(!visible.some(level => level.id === created.data.difficulty.id));
  assert.equal((await request(path, 'PUT', { isActive: true })).status, 200);
  visible = (await request('/api/difficulty', 'GET', undefined, null)).data.difficulties;
  assert(visible.some(level => level.id === created.data.difficulty.id));
});

test('difficulty validation rejects invalid types, ranges and extra fields', async () => {
  for (const body of [null, [], {}, { levelName: '' }, { levelName: 'a'.repeat(33) }, { levelName: { $ne: '' } },
    { levelName: 'Valid', aiSpeed: 0 }, { levelName: 'Valid', ballSpeed: 2001 }, { levelName: 'Valid', aiSpeed: '200' },
    { levelName: 'Valid', isActive: 'true' }, { levelName: 'Valid', role: 'ADMIN' }]) {
    assert.equal((await request('/api/admin/difficulty', 'POST', body)).status, 400);
  }
  for (const body of [{ aiSpeed: -1 }, { isActive: null }, { userId: ids.player }, {}]) {
    assert.equal((await request(`/api/admin/difficulty/${ids.easy}`, 'PUT', body)).status, 400);
  }
});

test('duplicate difficulty names on create and edit return safe 409 responses', async () => {
  assert.equal((await request('/api/admin/difficulty', 'POST', { levelName: 'Easy' })).status, 409);
  assert.equal((await request(`/api/admin/difficulty/${ids.inactive}`, 'PUT', { levelName: 'Easy' })).status, 409);
});

test('difficulty update/delete reject malformed and missing IDs', async () => {
  for (const method of ['PUT', 'DELETE']) {
    const body = method === 'PUT' ? { isActive: false } : undefined;
    assert.equal((await request('/api/admin/difficulty/bad', method, body)).status, 400);
    assert.equal((await request(`/api/admin/difficulty/${ids.missing}`, method, body)).status, 404);
  }
});

test('referenced match difficulty cannot be deleted, but may be deactivated without changing history', async () => {
  const before = clone([...matches]);
  const result = await request(`/api/admin/difficulty/${ids.easy}`, 'DELETE');
  assert.equal(result.status, 409);
  assert(levels.has(ids.easy));
  assert.equal((await request(`/api/admin/difficulty/${ids.easy}`, 'PUT', { aiSpeed: 500, isActive: false })).status, 200);
  assert.deepEqual([...matches], before);
});

test('profile preferences also prevent difficulty removal', async () => {
  users.get(ids.player).preferredDifficultyId = ids.inactive;
  assert.equal((await request(`/api/admin/difficulty/${ids.inactive}`, 'DELETE')).status, 409);
  assert(levels.has(ids.inactive));
});

test('unused difficulty can be physically removed without changing match history', async () => {
  const before = clone([...matches]);
  assert.equal((await request(`/api/admin/difficulty/${ids.inactive}`, 'DELETE')).status, 204);
  assert(!levels.has(ids.inactive));
  assert.deepEqual([...matches], before);
});

test('reference-check failure rolls back difficulty deletion and hides database details', async () => {
  failReferenceCheck = true;
  const result = await request(`/api/admin/difficulty/${ids.inactive}`, 'DELETE');
  assert.equal(result.status, 500);
  assert.deepEqual(result.data, { message: 'Internal server error' });
  assert(levels.has(ids.inactive));
});

test('promotion requires exact confirmation, normalizes username and only promotes the chosen account', async () => {
  const rejected = await grantAdmin(' MOCK_PLAYER ', async prompt => {
    assert(prompt.includes('mock_player') && prompt.includes(ids.player));
    return 'yes';
  });
  assert.equal(rejected.promoted, false);
  assert.equal(users.get(ids.player).role, 'PLAYER');
  const accepted = await grantAdmin('MOCK_PLAYER', async () => 'PROMOTE mock_player');
  assert.equal(accepted.promoted, true);
  assert.equal(users.get(ids.player).role, 'ADMIN');
  assert.equal(users.get(ids.other).role, 'PLAYER');
});

test('promotion refuses invalid/missing accounts and is a no-op for an existing Admin', async () => {
  await assert.rejects(grantAdmin('bad name', async () => ''), error => error.status === 400);
  await assert.rejects(grantAdmin('missing_user', async () => ''), error => error.status === 404);
  const result = await grantAdmin('mock_admin', async () => { throw new Error('Must not prompt for an existing Admin'); });
  assert.equal(result.promoted, false);
});

test('promotion command refuses noninteractive execution before connecting to Atlas', () => {
  const result = spawnSync(process.execPath, ['scripts/grant-admin.js', 'mock_player'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1);
  assert(result.stderr.includes('Typed confirmation is required'));
  assert(!result.stdout.includes('MongoDB connected'));
});

test('no public API exists for role promotion', async () => {
  assert.equal((await request('/api/admin/users/promote', 'POST', { role: 'ADMIN' })).status, 404);
  assert.equal((await request('/api/users/profile', 'PUT', { role: 'ADMIN' }, ids.player)).status, 400);
});
