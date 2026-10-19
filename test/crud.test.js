const { test, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const DifficultySetting = require('../models/DifficultySetting');
const Match = require('../models/Match');
const seedDifficulties = require('../scripts/seed-difficulties');
const app = require('../app');

// Isolated database fixtures: real HTTP, JWT, and Mongoose validation, no Atlas.
const ids = {
  player: '111111111111111111111111', other: '222222222222222222222222',
  easy: '333333333333333333333333', hard: '444444444444444444444444',
  inactive: '555555555555555555555555', missing: '666666666666666666666666',
};
const secret = 'crud-test-only-secret-never-use-in-production';
const previousSecret = process.env.JWT_SECRET;
const users = new Map();
const matches = new Map();
const difficulties = new Map();
const session = { testOnly: true };
let failCleanup = false;
let disappearOnCreate = false;
let server;
let base;

const clone = value => value ? structuredClone(value) : value;
function satisfies(record, filter) {
  return Object.entries(filter).every(([key, value]) => String(record[key]) === String(value));
}
function lookup(store, filter) {
  return [...store.values()].find(record => satisfies(record, filter));
}

before(async () => {
  process.env.JWT_SECRET = secret;
  mock.method(User, 'findById', async id => clone(users.get(String(id))) || null);
  mock.method(User, 'findOneAndUpdate', async (filter, update, options) => {
    assert(options.runValidators);
    const user = lookup(users, filter);
    if (!user) return null;
    if (update.$set.username && [...users.values()].some(other => other._id !== user._id && other.username === update.$set.username)) {
      throw Object.assign(new Error('duplicate fixture'), { code: 11000 });
    }
    Object.assign(user, update.$set, { updatedAt: new Date() });
    return clone(user);
  });
  mock.method(User, 'updateOne', async (filter, update, options) => {
    assert.equal(options.session, session);
    assert.equal(options.timestamps, false);
    assert.equal(update.$inc.__v, 1);
    const user = disappearOnCreate ? null : lookup(users, filter);
    if (user) user.__v += 1;
    return { matchedCount: user ? 1 : 0 };
  });
  mock.method(User, 'deleteOne', async (filter, options) => {
    assert.equal(options.session, session);
    const user = lookup(users, filter);
    if (user) users.delete(user._id);
    return { deletedCount: user ? 1 : 0 };
  });
  mock.method(DifficultySetting, 'findOne', filter => {
    const promise = Promise.resolve(clone(lookup(difficulties, filter)) || null);
    promise.session = passed => { assert.equal(passed, session); return promise; };
    return promise;
  });
  mock.method(DifficultySetting, 'find', filter => ({ sort: async () =>
    [...difficulties.values()].filter(item => satisfies(item, filter)).sort((a, b) => a.aiSpeed - b.aiSpeed).map(clone),
  }));
  mock.method(Match, 'create', async (data, options) => {
    assert.equal(options.session, session);
    const document = new Match(data[0]);
    await document.validate();
    const item = {
      ...data[0], _id: document._id.toString(), userId: String(data[0].userId),
      difficultyId: String(data[0].difficultyId), __v: 0, createdAt: new Date(), updatedAt: new Date(),
    };
    matches.set(item._id, item);
    return [clone(item)];
  });
  mock.method(Match, 'findOne', async filter => clone(lookup(matches, filter)) || null);
  mock.method(Match, 'find', filter => ({ sort: async sort => {
    assert.deepEqual(sort, { updatedAt: -1, _id: -1 });
    return [...matches.values()].filter(item => satisfies(item, filter))
      .sort((a, b) => b.updatedAt - a.updatedAt || b._id.localeCompare(a._id)).map(clone);
  } }));
  mock.method(Match, 'findOneAndUpdate', async (filter, update, options) => {
    assert(options.runValidators);
    const item = lookup(matches, filter);
    if (!item) return null;
    Object.assign(item, update.$set, { __v: item.__v + update.$inc.__v, updatedAt: new Date() });
    return clone(item);
  });
  mock.method(Match, 'findOneAndDelete', async filter => {
    const item = lookup(matches, filter);
    if (item) matches.delete(item._id);
    return clone(item) || null;
  });
  mock.method(Match, 'deleteMany', async (filter, options) => {
    assert.equal(options.session, session);
    if (failCleanup) throw new Error('private cleanup error');
    let deletedCount = 0;
    for (const [id, item] of matches) {
      if (satisfies(item, filter)) { matches.delete(id); deletedCount += 1; }
    }
    return { deletedCount };
  });
  mock.method(mongoose.connection, 'transaction', async callback => {
    const previousUsers = clone([...users]);
    const previousMatches = clone([...matches]);
    try {
      return await callback(session);
    } catch (error) {
      users.clear(); matches.clear();
      for (const [id, user] of previousUsers) users.set(id, user);
      for (const [id, item] of previousMatches) matches.set(id, item);
      throw error;
    }
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  users.clear(); matches.clear(); difficulties.clear();
  failCleanup = false; disappearOnCreate = false;
  for (const [id, username] of [[ids.player, 'player_one'], [ids.other, 'player_two']]) {
    users.set(id, { _id: id, username, role: 'PLAYER', passwordHash: 'private-fixture-hash',
      __v: 0, createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-01') });
  }
  for (const setting of [
    { _id: ids.easy, levelName: 'Easy', aiSpeed: 140, ballSpeed: 240, isActive: true },
    { _id: ids.hard, levelName: 'Hard', aiSpeed: 260, ballSpeed: 360, isActive: true },
    { _id: ids.inactive, levelName: 'Inactive', aiSpeed: 100, ballSpeed: 200, isActive: false },
  ]) difficulties.set(setting._id, setting);
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  mock.restoreAll();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

async function request(path, method = 'GET', body, player = ids.player) {
  const headers = {};
  if (player) headers.Authorization = `Bearer ${jwt.sign({ sub: player }, secret, { expiresIn: '1h' })}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}
async function newMatch(player = ids.player) {
  const result = await request('/api/matches', 'POST', { difficultyId: ids.easy }, player);
  assert.equal(result.status, 201);
  return result.data.match;
}

test('profile retrieval supports older accounts without preference and excludes hashes', async () => {
  const result = await request('/api/users/profile');
  assert.equal(result.status, 200);
  assert.equal(result.data.user.preferredDifficultyId, null);
  assert(!JSON.stringify(result.data).includes('private-fixture-hash'));
});

test('profile updates normalized username and active preference, preserving creation time and role', async () => {
  const result = await request('/api/users/profile', 'PUT', { username: '  New_Name  ', preferredDifficultyId: ids.easy });
  assert.equal(result.status, 200);
  assert.equal(result.data.user.username, 'new_name');
  assert.equal(result.data.user.preferredDifficultyId, ids.easy);
  assert.equal(result.data.user.createdAt, '2026-10-01T00:00:00.000Z');
  assert.equal(result.data.user.role, 'PLAYER');
  assert.equal(users.get(ids.other).username, 'player_two');
  const clear = await request('/api/users/profile', 'PUT', { preferredDifficultyId: null });
  assert.equal(clear.data.user.preferredDifficultyId, null);
});

test('profile rejects case-insensitive duplicate usernames', async () => {
  const result = await request('/api/users/profile', 'PUT', { username: 'PLAYER_TWO' });
  assert.equal(result.status, 409);
  assert.equal(users.get(ids.player).username, 'player_one');
});

test('profile rejects role, identity, password, timestamp injection and malformed updates', async () => {
  for (const body of [{ role: 'ADMIN' }, { _id: ids.other }, { userId: ids.other }, { password: 'NoPasswordChange' },
    { passwordHash: 'bad' }, { createdAt: '2020-01-01' }, {}, [], null,
    { username: { $ne: '' } }, { username: 'bad name' },
    { preferredDifficultyId: 'bad' }, { preferredDifficultyId: ids.inactive }, { preferredDifficultyId: ids.missing }]) {
    assert.equal((await request('/api/users/profile', 'PUT', body)).status, 400);
  }
});

test('profile GET, PUT and DELETE require authentication', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    assert.equal((await request('/api/users/profile', method, undefined, null)).status, 401);
  }
});

test('difficulty endpoint is public, active-only and safe', async () => {
  const result = await request('/api/difficulty', 'GET', undefined, null);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.difficulties.map(item => item.levelName), ['Easy', 'Hard']);
  assert(result.data.difficulties.every(item => item.isActive && item.id));
  difficulties.clear();
  assert.deepEqual((await request('/api/difficulty')).data, { difficulties: [] });
});

test('new match starts at zero with token ownership, snapshot, timestamps and version', async () => {
  const item = await newMatch();
  assert.equal(item.userId, ids.player);
  assert.equal(item.playerScore, 0);
  assert.equal(item.aiScore, 0);
  assert.equal(item.status, 'IN_PROGRESS');
  assert.equal(item.version, 0);
  assert(item.createdAt && item.updatedAt);
  assert.deepEqual(item.difficultySnapshot, { levelName: 'Easy', aiSpeed: 140, ballSpeed: 240 });
});

test('match creation rejects ownership/score injection and invalid or inactive difficulty IDs', async () => {
  for (const body of [{ difficultyId: ids.easy, userId: ids.other }, { difficultyId: ids.easy, role: 'ADMIN' },
    { difficultyId: ids.easy, playerScore: 5 }, {}, { difficultyId: 'invalid' },
    { difficultyId: ids.missing }, { difficultyId: ids.inactive }]) {
    assert.equal((await request('/api/matches', 'POST', body)).status, 400);
  }
  assert.equal(matches.size, 0);
});

test('match creation fails without orphan data if the account disappears', async () => {
  disappearOnCreate = true;
  assert.equal((await request('/api/matches', 'POST', { difficultyId: ids.easy })).status, 401);
  assert.equal(matches.size, 0);
});

test('history is owner-filtered and sorted newest first; GET loads an owned save', async () => {
  const first = await newMatch();
  matches.get(first.id).updatedAt = new Date('2026-10-01');
  const second = await newMatch();
  await newMatch(ids.other);
  const result = await request('/api/matches');
  assert.deepEqual(result.data.matches.map(item => item.id), [second.id, first.id]);
  assert.equal((await request(`/api/matches/${first.id}`)).data.match.id, first.id);
});

test('all match operations reject cross-player access without exposing existence', async () => {
  const item = await newMatch(ids.other);
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    const body = method === 'PATCH' ? { version: 0, playerScore: 1 } : undefined;
    const result = await request(`/api/matches/${item.id}`, method, body);
    assert.equal(result.status, 404);
    assert.deepEqual(result.data, { message: 'Match not found' });
  }
  assert(matches.has(item.id));
});

test('all match endpoints require JWT authentication', async () => {
  for (const [path, method] of [['/api/matches', 'GET'], ['/api/matches', 'POST'],
    [`/api/matches/${ids.missing}`, 'GET'], [`/api/matches/${ids.missing}`, 'PATCH'], [`/api/matches/${ids.missing}`, 'DELETE']]) {
    assert.equal((await request(path, method, undefined, null)).status, 401);
  }
});

test('GET/PATCH/DELETE reject malformed match IDs and handle nonexistent IDs safely', async () => {
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    const body = method === 'PATCH' ? { version: 0, playerScore: 1 } : undefined;
    assert.equal((await request('/api/matches/not-an-id', method, body)).status, 400);
    assert.equal((await request(`/api/matches/${ids.missing}`, method, body)).status, 404);
  }
});

test('saved scores resume between points and retain the original difficulty snapshot', async () => {
  const item = await newMatch();
  difficulties.get(ids.easy).aiSpeed = 999;
  const result = await request(`/api/matches/${item.id}`, 'PATCH', { version: 0, playerScore: 3, aiScore: 2 });
  assert.equal(result.status, 200);
  assert.equal(result.data.match.version, 1);
  const saved = (await request(`/api/matches/${item.id}`)).data.match;
  assert.equal(saved.playerScore, 3);
  assert.equal(saved.aiScore, 2);
  assert.equal(saved.status, 'IN_PROGRESS');
  assert.equal(saved.difficultySnapshot.aiSpeed, 140);
});

test('scores must be whole numbers in range and cannot decrease', async () => {
  const item = await newMatch();
  for (const score of [-1, 6, 0.5, '2', null, { $inc: 1 }]) {
    assert.equal((await request(`/api/matches/${item.id}`, 'PATCH', { version: 0, playerScore: score })).status, 400);
  }
  assert.equal((await request(`/api/matches/${item.id}`, 'PATCH', { version: 0, playerScore: 2 })).status, 200);
  assert.equal((await request(`/api/matches/${item.id}`, 'PATCH', { version: 1, playerScore: 1 })).status, 400);
});

test('completion requires exactly one winner and completed matches are immutable', async () => {
  const item = await newMatch();
  for (const body of [
    { playerScore: 5 }, { status: 'COMPLETED' }, { status: 'DISCARDED' },
    { status: 'COMPLETED', playerScore: 5, aiScore: 5 },
  ]) assert.equal((await request(`/api/matches/${item.id}`, 'PATCH', { version: 0, ...body })).status, 400);
  const completed = await request(`/api/matches/${item.id}`, 'PATCH', { version: 0, playerScore: 5, aiScore: 3, status: 'COMPLETED' });
  assert.equal(completed.status, 200);
  for (const body of [{ status: 'IN_PROGRESS' }, { aiScore: 4 }]) {
    assert.equal((await request(`/api/matches/${item.id}`, 'PATCH', { version: 1, ...body })).status, 409);
  }
  const aiWin = await newMatch();
  assert.equal((await request(`/api/matches/${aiWin.id}`, 'PATCH', { version: 0, aiScore: 5, status: 'COMPLETED' })).status, 200);
});

test('match updates reject extra fields, missing/bad versions, and empty changes', async () => {
  const item = await newMatch();
  for (const body of [{ playerScore: 1 }, { version: -1, playerScore: 1 }, { version: '0', playerScore: 1 },
    { version: 0 }, { version: 0, userId: ids.other }, { version: 0, difficultyId: ids.hard }, { version: 0, createdAt: 'bad' }]) {
    assert.equal((await request(`/api/matches/${item.id}`, 'PATCH', body)).status, 400);
  }
});

test('duplicate/stale saves cannot apply twice and unchanged saves keep the version', async () => {
  const item = await newMatch();
  const unchanged = await request(`/api/matches/${item.id}`, 'PATCH', { version: 0, playerScore: 0 });
  assert.equal(unchanged.data.match.version, 0);
  assert.equal(unchanged.data.match.updatedAt, item.updatedAt);
  const body = { version: 0, playerScore: 1 };
  assert.equal((await request(`/api/matches/${item.id}`, 'PATCH', body)).status, 200);
  assert.equal((await request(`/api/matches/${item.id}`, 'PATCH', body)).status, 409);
  assert.equal(matches.get(item.id).__v, 1);
});

test('concurrent saves allow only one update for a version', async () => {
  const item = await newMatch();
  const results = await Promise.all([
    request(`/api/matches/${item.id}`, 'PATCH', { version: 0, playerScore: 1 }),
    request(`/api/matches/${item.id}`, 'PATCH', { version: 0, aiScore: 1 }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(matches.get(item.id).__v, 1);
});

test('DELETE physically removes an owned saved match without affecting another player', async () => {
  const item = await newMatch();
  const other = await newMatch(ids.other);
  assert.equal((await request(`/api/matches/${item.id}`, 'DELETE')).status, 204);
  assert.equal((await request(`/api/matches/${item.id}`)).status, 404);
  assert(matches.has(other.id));
});

test('account deletion removes own matches atomically and invalidates old tokens', async () => {
  await newMatch(); await newMatch();
  const other = await newMatch(ids.other);
  assert.equal((await request('/api/users/profile', 'DELETE')).status, 204);
  assert(!users.has(ids.player));
  assert(users.has(ids.other));
  assert.deepEqual([...matches.keys()], [other.id]);
  assert.equal((await request('/api/users/profile')).status, 401);
  assert.equal((await request('/api/matches')).status, 401);
});

test('account deletion rolls back if match cleanup fails (mock transaction)', async () => {
  const item = await newMatch();
  failCleanup = true;
  const result = await request('/api/users/profile', 'DELETE');
  assert.equal(result.status, 500);
  assert.deepEqual(result.data, { message: 'Internal server error' });
  assert(users.has(ids.player));
  assert(matches.has(item.id));
});

test('Match schema rejects invalid winning states, fractional scores, and missing references', async () => {
  const data = { userId: ids.player, difficultyId: ids.easy,
    difficultySnapshot: { levelName: 'Easy', aiSpeed: 140, ballSpeed: 240 } };
  await new Match(data).validate();
  for (const changes of [{ playerScore: -1 }, { aiScore: 6 }, { playerScore: 1.5 }, { status: 'COMPLETED' },
    { playerScore: 5 }, { playerScore: 5, aiScore: 5, status: 'COMPLETED' }, { userId: null }]) {
    await assert.rejects(new Match({ ...data, ...changes }).validate());
  }
  await new Match({ ...data, playerScore: 5, status: 'COMPLETED' }).validate();
});

test('difficulty seed is insert-only and idempotent, preserving custom values', async () => {
  const existing = { levelName: 'Easy', aiSpeed: 180, ballSpeed: 250, isActive: false, updatedAt: new Date('2026-01-01') };
  const store = new Map([['Easy', clone(existing)]]);
  const update = mock.method(DifficultySetting, 'updateOne', async (filter, changes, options) => {
    assert.deepEqual(Object.keys(changes), ['$setOnInsert']);
    assert.equal(options.timestamps, false);
    assert.equal(options.upsert, true);
    if (store.has(filter.levelName)) return { upsertedCount: 0 };
    store.set(filter.levelName, clone(changes.$setOnInsert));
    return { upsertedCount: 1 };
  });
  try {
    await seedDifficulties();
    await seedDifficulties();
    assert.equal(store.size, 3);
    assert.deepEqual(store.get('Easy'), existing);
  } finally { update.mock.restore(); }
});
