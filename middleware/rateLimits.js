const { rateLimit } = require('express-rate-limit');

// Generous network budgets for shared Wi-Fi; successful logins still consume burst capacity.
const POLICIES = Object.freeze({
  loginBurst: Object.freeze({ windowMs: 60_000, limit: 120 }),
  loginFailures: Object.freeze({ windowMs: 15 * 60_000, limit: 120, skipSuccessfulRequests: true }),
  registration: Object.freeze({ windowMs: 60 * 60_000, limit: 60 }),
  accountWrites: Object.freeze({ windowMs: 60_000, limit: 300 }),
  matchCreation: Object.freeze({ windowMs: 60_000, limit: 60 }),
});

function accountKey(req) {
  // Only mounted AFTER authentication (and ADMIN authorization where applicable).
  // Never use body/query usernames, user IDs, tokens, or forwarded headers here.
  return req.user._id.toString();
}

function createRateLimiters(overrides = {}) {
  return Object.fromEntries(Object.entries(POLICIES).map(([name, policy]) => {
    const perAccount = name === 'accountWrites' || name === 'matchCreation';
    return [name, rateLimit({
      ...policy,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      identifier: name,
      requestPropertyName: `${name}RateLimit`,
      message: { message: 'Too many requests. Please wait and try again.' },
      // GET/HEAD/OPTIONS never consume write budgets. CORS also handles preflight first.
      skip: req => !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method),
      ...(perAccount ? { keyGenerator: accountKey } : {}),
      // Tests inject small thresholds/stores without environment flags or production bypasses.
      ...overrides[name],
    })];
  }));
}

// Each policy gets a separate default MemoryStore. No proxy trust or validation overrides.
module.exports = { ...createRateLimiters(), createRateLimiters, POLICIES };
