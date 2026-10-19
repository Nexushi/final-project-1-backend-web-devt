const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const productionOrigin = 'https://pickleball-demo.example';
const previousOrigin = process.env.CORS_ORIGIN;
const previousSecret = process.env.JWT_SECRET;
const servers = [];
let configuredBase;
let localOnlyBase;

async function startApp(origin) {
  if (origin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = origin;
  // Build each allowlist at startup, without loading .env or connecting to Atlas.
  delete require.cache[require.resolve('../app')];
  const app = require('../app');
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  process.env.JWT_SECRET = 'cors-test-only-secret-never-use-in-production';
  configuredBase = await startApp(` ${productionOrigin} `);
  localOnlyBase = await startApp();
});

after(async () => {
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  if (previousOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = previousOrigin;
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

test('CORS allows localhost with or without a configured production origin', async () => {
  for (const base of [configuredBase, localOnlyBase]) {
    const response = await fetch(`${base}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  }
});

test('CORS allows the exact configured production origin and varies cached responses by Origin', async () => {
  const response = await fetch(`${configuredBase}/api/health`, { headers: { Origin: productionOrigin } });
  assert.equal(response.headers.get('access-control-allow-origin'), productionOrigin);
  assert(response.headers.get('vary').includes('Origin'));
});

test('CORS omits permission for unconfigured origins and lookalike hosts', async () => {
  for (const origin of ['https://other.example', `${productionOrigin}.evil.example`, 'http://pickleball-demo.example']) {
    const response = await fetch(`${configuredBase}/api/health`, { headers: { Origin: origin } });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  const response = await fetch(`${localOnlyBase}/api/health`, { headers: { Origin: productionOrigin } });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('CORS permits production preflight with Authorization and Content-Type headers', async () => {
  const response = await fetch(`${configuredBase}/api/matches`, {
    method: 'OPTIONS',
    headers: {
      Origin: productionOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), productionOrigin);
  assert(response.headers.get('access-control-allow-methods').includes('POST'));
  assert(response.headers.get('access-control-allow-headers').includes('authorization'));
});

test('unapproved preflight receives no origin permission', async () => {
  const response = await fetch(`${configuredBase}/api/matches`, {
    method: 'OPTIONS', headers: { Origin: 'https://other.example', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('health requests without Origin still work', async () => {
  const response = await fetch(`${configuredBase}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await response.json(), { status: 'ok', message: 'Pickle Ball Pixel Game API is running' });
});

test('an allowed CORS origin does not bypass profile or Admin authentication', async () => {
  for (const path of ['/api/users/profile', '/api/admin/users']) {
    const response = await fetch(`${configuredBase}${path}`, { headers: { Origin: productionOrigin } });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('access-control-allow-origin'), productionOrigin);
  }
});
