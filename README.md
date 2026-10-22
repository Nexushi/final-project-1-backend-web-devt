# Pickle Ball Pixel Game Backend

The backend uses Express, Node.js, CommonJS, and MongoDB Atlas through Mongoose.
Stage 4B adds protected Admin APIs and a manually confirmed Admin promotion
command to the existing profile, difficulty, match, and authentication features.
The frontend repository and an Admin dashboard are outside this backend stage.

## Installation

Use a current Node.js LTS version (Node.js 24 is used for this stage) with npm.
Open this backend folder in VS Code and open its integrated terminal.

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Copy the example only if you do not already have a `.env` file.
The example contains `PORT=5000`. You can change it in `.env` or set the
`PORT` environment variable. Without either, the server uses port 5000.
Set `MONGODB_URI` in your private `.env` to your Atlas connection string.
Set `JWT_SECRET` to a long, random private signing secret. There is no fallback
secret. Missing or blank `JWT_SECRET` stops startup before database connection.
Do not paste it into source code, screenshots, shared terminal output, or Git.
An existing `.env` must be preserved; do not replace it with the example.

## MongoDB connection

`server.js` loads environment variables using dotenv before calling
`config/db.js`. The connection module reads `process.env.MONGODB_URI` and uses
Mongoose to connect to the `pickleball_game` database. The `dbName` option
explicitly selects this database. The connection module does not modify data.
After connecting, startup initializes the User, DifficultySetting, and Match
models and indexes before listening for HTTP requests. If index setup fails,
the API stays stopped. It does not seed difficulties automatically. Only the
`users`, `difficultysettings`, and `matches` collections in `pickleball_game`
are used. Existing sample databases and unrelated records are not modified.

Before running, make sure the Atlas cluster is available, your current IP is
allowed, and the database user has `readWrite` on `pickleball_game`.

The HTTP server starts only after the database connects. Expected messages:

```text
MongoDB connected successfully (pickleball_game).
Pickle Ball Pixel Game API is running on port 5000
```

If `MONGODB_URI` is missing, startup exits with an explanatory message.
Connection failures also exit without starting the HTTP server. Server
selection waits up to 10 seconds; DNS/network errors may have different timing.
Error output deliberately omits raw driver errors, credentials, and the URI.
Check the private URI, Atlas user credentials/permissions, IP access list,
and local network/DNS if connection fails. Restart after fixing the problem.
If an Atlas SRV/TXT DNS lookup is refused (`ECONNREFUSED`), the database
connection cannot begin. Check your network's DNS resolver, VPN, and firewall
settings, or try another permitted network. A DNS failure does not by itself
mean the database password is wrong. The application uses system DNS and does
not hardcode a public resolver or change your machine's network settings.
In watch mode, Node may remain waiting for changes after the server process
fails; this does not mean the API started. Stop it with Ctrl+C and rerun.

## Development

```powershell
npm run dev
```

Node's built-in watch mode restarts the server when source files change.
Restart the command after changing `.env`. Nodemon is not required or installed.
Press Ctrl+C to stop the server.

To run without watch mode:

```powershell
npm start
```

`npm start` runs `node server.js`. The server listens on `process.env.PORT`
or defaults to 5000, without restricting the listening host to localhost.
These startup settings are ready for Render and do not require changes.

## API testing

With the server running, open `http://localhost:5000/api/health` in a browser,
or run this command in a second VS Code PowerShell terminal:

```powershell
Invoke-RestMethod -Uri http://localhost:5000/api/health
```

Expected HTTP status: `200`. Expected JSON:

```json
{
  "status": "ok",
  "message": "Pickle Ball Pixel Game API is running"
}
```

If you changed the port, use that port in the URL.
The browser CORS allowlist always includes `http://localhost:5173` and also
includes the optional `CORS_ORIGIN` environment value. For example,
`CORS_ORIGIN=https://pickleball-demo.example` is a fake documentation origin;
replace it with the actual Vercel frontend origin in Render's environment
settings later. Use the exact scheme and hostname (and port if applicable),
without a path or trailing slash, then restart the backend. Leaving it unset
or blank permits only the local origin. No wildcard origins are enabled.
Other origins receive no CORS permission headers; this is not an HTTP access
block for tools such as curl.
CORS controls browser access to responses; it does not authenticate requests.

Unknown routes return a JSON `404` response. Malformed JSON returns `400`,
oversized JSON returns `413`, and unexpected errors return a generic `500` response.

Additional checks:

```powershell
node --check server.js
node --check config/db.js
npm test
npm audit
```

If startup reports `EADDRINUSE`, stop the other process using the port or choose
a different `PORT` in `.env`, then restart the server.

To verify Atlas manually, run `npm run dev`, confirm the database success
message names `pickleball_game`, then test `/api/health` from a second terminal.
The health response remains unchanged and is a basic API liveness check; it
does not perform a fresh database check on every request.

For a safe missing-variable check in a separate PowerShell terminal:

```powershell
$env:MONGODB_URI = ' '
node server.js
Remove-Item Env:MONGODB_URI
```

The command should exit with `MONGODB_URI is required` and no API startup
message. The whitespace override prevents dotenv from filling that variable
from `.env`. This test does not edit `.env` or contact Atlas. Remove the override
as shown before starting normally again.

## Environment files

`.gitignore` excludes `node_modules`, `.env`, other `.env.*` files, logs,
coverage, and build output. `.env.example` is intentionally allowed and must
contain example values only. Keep passwords, tokens, and database credentials
out of source files and documentation.

Required environment variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port; defaults to 5000 if unset |
| `CORS_ORIGIN` | Optional additional frontend origin, e.g. `https://pickleball-demo.example` |
| `MONGODB_URI` | Private Atlas connection string |
| `JWT_SECRET` | Private JWT signing and verification secret |

## Authentication API

| Method | Route | Result |
| --- | --- | --- |
| POST | `/api/auth/register` | Creates a PLAYER; returns 201, token, safe user |
| POST | `/api/auth/login` | Returns 200, token, safe user for valid credentials |
| GET | `/api/users/profile` | Returns the authenticated user's safe profile |

Registration and login accept JSON containing only `username` and `password`.
Usernames must have 3-24 ASCII letters, digits, or underscores. Leading and
trailing whitespace is removed and usernames are stored in lowercase. The
model also applies this normalization. A MongoDB unique index prevents two
registrations from storing the same normalized username, even concurrently.
Thus `Player_One` and `player_one` identify the same account. Displayed
usernames use lowercase. A duplicate returns 409, including duplicate-key
errors from MongoDB. Existing records must follow this normalization too;
this stage does not migrate or alter unrelated data.

Passwords must have at least 8 characters, contain a non-whitespace character,
and be at most 72 UTF-8 bytes. The byte limit prevents bcrypt from silently
ignoring extra password bytes. Passwords are not trimmed or lowercased.
Registration stores only a bcrypt hash with cost 12 and a random salt.
Login checks the submitted password with `bcrypt.compare`.

Public registration rejects any extra field, including `role`, `_id`, and
`passwordHash`; the server always sets `PLAYER`. The User schema also supports
`ADMIN` for future administration, but no public Admin creation route exists.
Accounts have automatic `createdAt` and `updatedAt` timestamps.

Successful registration and login return `{ message, token, user }`.
The safe user fields are `id`, `username`, `role`, `preferredDifficultyId`,
`createdAt`, and `updatedAt`.
The profile response is `{ user }`. Passwords and hashes are never returned.
The model excludes `passwordHash` from normal queries; login explicitly
selects it for comparison. Responses use a separate safe field list.

JWTs use HS256, contain the user ID in `sub`, and expire after one day.
Send them using `Authorization: Bearer <token>`. Authentication verifies the
signature, expiration, allowed algorithm, and user ID, then loads that user
from MongoDB. Deleted/nonexistent users are rejected. The role comes from
the current database record, not from browser fields or JWT role claims.
The reusable `requireRole` middleware protects all `/api/admin` routes using
the role loaded from MongoDB by authentication.

Invalid input returns 400. Validly formatted but incorrect login credentials
return 401 with the same `Invalid username or password` message for unknown
usernames and incorrect passwords. Missing/invalid/expired authentication
returns 401; denied roles return 403. Unexpected errors return a generic 500
without database internals. Profile operations always use the authenticated
user ID; no other player's account can be selected through this route.

## Test authentication in VS Code

Start the server in one terminal with `npm run dev`. Once startup succeeds,
use a second PowerShell terminal. These are dummy credentials; registration
creates a real demo account. Choose another username if it already exists.

```powershell
$body = @{ username = 'demo_player'; password = 'DemoPassword_2026!' } | ConvertTo-Json
$registration = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/register -ContentType 'application/json' -Body $body
$registration.user

$login = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/login -ContentType 'application/json' -Body $body
$headers = @{ Authorization = "Bearer $($login.token)" }
Invoke-RestMethod -Uri http://localhost:5000/api/users/profile -Headers $headers
```

The examples keep the token in a variable rather than printing it. Do not
share real tokens, passwords, hashes, or `.env` values. A profile request
without `$headers` should fail with 401. Registering the same username in
another letter case should fail with 409.

## Automated tests

```powershell
npm test
npm audit
```

`npm test` uses Node's built-in test runner, in-memory mocks of User database
methods, a separate dummy signing secret, and a temporary local HTTP server.
It exercises real Express routes, bcrypt, and JWT without loading `.env`,
connecting to MongoDB, or modifying real records. It covers validation,
hashing, duplicate handling, login, tokens, profile isolation, role checks,
safe errors, required configuration, and existing health/middleware behavior.
These isolated tests do not prove real MongoDB persistence or unique indexes.

The opt-in integration test does use Atlas and creates exactly one clearly
named `test3c_...` account per run. It checks stored hashes/timestamps, actual
case-insensitive duplicate rejection, login/JWT, protected profiles, invalid
tokens, role injection rejection, and health. It prints the test username,
but never its generated password, hash, token, or the connection string.
The account is retained. Obtain approval before deleting test data.

```powershell
npm run test:atlas
```

If the previously observed Atlas DNS issue requires a temporary workaround:

```powershell
$env:ATLAS_TEST_PUBLIC_DNS = '1'
try { npm run test:atlas } finally { Remove-Item Env:ATLAS_TEST_PUBLIC_DNS }
```

Only this integration-test process then uses DNS resolvers `1.1.1.1` and
`8.8.8.8`. The flag is read by the test script only; it does not change
`npm start`, `npm run dev`, Windows DNS settings, or `.env`. Normal server
startup continues to require working system DNS. Neither test command
automatically deletes database records.

## Code organization

- `app.js`: Express middleware, route mounting, health, and safe error responses.
- `server.js`: environment loading, configuration checks, database/index setup, HTTP startup.
- `config/`: MongoDB connection and required JWT secret validation.
- `models/`: User, DifficultySetting, and Match schemas and indexes.
- `controllers/`: authentication, profile, difficulty, and match handlers.
- `routes/`: endpoint definitions and authentication requirements.
- `middleware/`: credential validation, authentication, and reusable role checks.
- `utils/safeUser.js`: explicit public user fields.
- `test/`: isolated tests and opt-in Atlas verification.

## Stage 4A endpoints

All profile and match routes require `Authorization: Bearer <token>`.
`GET /api/difficulty` is public as requested for this stage.

| Method | Route | Request / result |
| --- | --- | --- |
| GET | `/api/users/profile` | Current safe profile: `{ user }` |
| PUT | `/api/users/profile` | `username` and/or `preferredDifficultyId`; returns `{ user }` |
| DELETE | `/api/users/profile` | Deletes own account and all own matches; 204 with no body |
| GET | `/api/difficulty` | Active settings ordered by AI speed: `{ difficulties: [...] }` |
| POST | `/api/matches` | `{ difficultyId }`; creates a zero-score match; 201 and `{ match }` |
| GET | `/api/matches` | Own matches, most recently updated first: `{ matches: [...] }` |
| GET | `/api/matches/:id` | One owned match: `{ match }` |
| PATCH | `/api/matches/:id` | Required `version`, plus scores and/or status; returns `{ match }` |
| DELETE | `/api/matches/:id` | Physically removes one owned match; 204 with no body |

Malformed IDs, invalid input, and extra body fields return 400. Duplicate
usernames return 409. Missing/invalid authentication returns 401. Missing
matches and matches owned by someone else both return 404, without disclosing
whether another player's record exists. Stale saves and completed-match edits
return 409. Internal errors stay generic.

Profile PUT allows only `username` and `preferredDifficultyId`. The username
uses the same normalization and unique index as registration. Set the
preference to an active difficulty's ID, or `null` to clear it. Old accounts
without this field return `null`; there is no bulk migration. The route cannot
change role, password, ID, hash, or creation timestamp.

Account deletion uses a MongoDB transaction: remove the authenticated account
and its matches together, or roll back both if anything fails. Transactions
require Atlas or another replica-set MongoDB deployment; a standalone local
MongoDB server is not sufficient. Match creation also writes the user's
internal version inside a transaction so concurrent account deletion cannot
leave a new orphaned match. No response is sent before the transaction commits.
JWT authentication checks MongoDB on each request, so tokens from deleted
accounts are rejected even if they have not expired.

## Models, scoring, and save/resume

- User: normalized unique username, hidden bcrypt hash, PLAYER/ADMIN role,
  optional `preferredDifficultyId` reference, and timestamps.
- DifficultySetting: unique `levelName`, positive `aiSpeed` and `ballSpeed`
  (1-2000), `isActive`, and timestamps. Speeds are logical Canvas pixels per
  second; gameplay should multiply speeds by elapsed time in seconds.
- Match: user and difficulty references, a difficulty snapshot, player/AI
  scores, status, timestamps, and an internal version exposed as `version`.

Game defaults are centralized in `config/game.js`: winning score 5, Easy
(AI 140, ball 240), Medium (AI 200, ball 300), Hard (AI 260, ball 360).
Difficulty values are backend defaults; frontend integration must use the
returned values with the same units. They do not automatically change the
separate frontend repository's existing gameplay.

Scores must be integers from 0 to 5 and cannot decrease. The simplified rule
is first to five, without a win-by-two extension. `IN_PROGRESS` matches must
have both scores below five. To complete, save `status: 'COMPLETED'` with
exactly one score of five. Completed matches are immutable through PATCH.
To change the winning rule later, start with `WINNING_SCORE` in `config/game.js`
and review compatibility with stored matches.

Saving stores cumulative scores, status, and the chosen difficulty. Multiple
points may have happened since the previous save. Resuming loads the match
and begins a fresh point at those scores; no ball coordinates, velocities, or
mid-rally state are stored. The difficulty snapshot preserves the selected
name and speeds if a future Admin edits or removes the referenced setting.
Saving/resuming in Canvas will require frontend integration in a later stage.

PATCH requires the `version` returned by the last GET/POST/PATCH. A successful
changed save atomically increments it. A stale or repeated old-version write
returns 409; reload and use the latest version rather than blindly retrying.
An unchanged save with the current version returns the existing record without
changing its timestamp/version. Scores are client-reported snapshots with
server consistency checks, not a server simulation of the rallies.

Abandoned/unfinished matches remain `IN_PROGRESS` until the owner deletes them.
DELETE physically removes the saved record; there is no DISCARDED tombstone.
The same endpoint may remove a completed match from history. Account deletion
removes both unfinished and completed matches belonging to that account.
History includes both statuses and is ordered by `updatedAt`, then ID, newest
first. Pagination is not implemented for this small demonstration stage.

## Difficulty seed command

Run only after approval to insert defaults into the selected database:

```powershell
npm run seed:difficulties
```

If needed, use the process-only DNS workaround for this command:

```powershell
$env:ATLAS_TEST_PUBLIC_DNS = '1'
try { npm run seed:difficulties } finally { Remove-Item Env:ATLAS_TEST_PUBLIC_DNS }
```

The seed uses `$setOnInsert` with upsert and an exact `levelName` key. It is
safe to rerun: existing values, active flags, and timestamps are preserved.
It never deletes settings or runs automatically on startup. An empty database
returns `{ difficulties: [] }` until defaults are approved and seeded. Existing
inactive defaults stay inactive; the command does not reactivate them.

## Manual CRUD demonstration in VS Code

Run the backend with `npm run dev` after resolving the system-DNS issue.
For a temporary manual test on the currently affected network, this alternative
starts the same server with a resolver override limited to that Node process:

```powershell
node -e "const dns = require('node:dns'); dns.setServers(['1.1.1.1', '8.8.8.8']); dns.promises.setServers(['1.1.1.1', '8.8.8.8']); require('./server');"
```

This alternative has no watch mode. Stop with Ctrl+C. It does not change
Windows DNS, `.env`, or normal startup behavior.

Use the earlier dummy registration/login example to set `$headers`, then run
these commands in a second PowerShell terminal. These requests write to the
account represented by that token; use a disposable demo account.

```powershell
$api = 'http://localhost:5000/api'
$levels = (Invoke-RestMethod "$api/difficulty").difficulties
$level = $levels | Select-Object -First 1
if (-not $level) { throw 'No active difficulties; seed defaults only after approval.' }

$preference = @{ preferredDifficultyId = $level.id } | ConvertTo-Json
Invoke-RestMethod -Method Put -Uri "$api/users/profile" -Headers $headers -ContentType 'application/json' -Body $preference

$body = @{ difficultyId = $level.id } | ConvertTo-Json
$saved = (Invoke-RestMethod -Method Post -Uri "$api/matches" -Headers $headers -ContentType 'application/json' -Body $body).match

$body = @{ playerScore = 2; aiScore = 1; version = $saved.version } | ConvertTo-Json
$saved = (Invoke-RestMethod -Method Patch -Uri "$api/matches/$($saved.id)" -Headers $headers -ContentType 'application/json' -Body $body).match

# Load a saved match and view history.
Invoke-RestMethod -Uri "$api/matches/$($saved.id)" -Headers $headers
Invoke-RestMethod -Uri "$api/matches" -Headers $headers

$body = @{ playerScore = 5; aiScore = 1; status = 'COMPLETED'; version = $saved.version } | ConvertTo-Json
$saved = (Invoke-RestMethod -Method Patch -Uri "$api/matches/$($saved.id)" -Headers $headers -ContentType 'application/json' -Body $body).match

# Optional permanent deletions: run only when you intend to remove your demo data.
# Invoke-RestMethod -Method Delete -Uri "$api/matches/$($saved.id)" -Headers $headers
# Invoke-RestMethod -Method Delete -Uri "$api/users/profile" -Headers $headers
```

To check username editing, PUT `{ "username": "demo_renamed" }` to your
profile. A username belonging to another player returns 409. A `role` field
returns 400. GET/PATCH/DELETE for another player's match returns 404.

## Stage 4A tests and limitations

`npm test` runs the original authentication suite plus `test/crud.test.js`.
The CRUD suite uses isolated mocks, not Atlas. It checks profile changes,
duplicates, active difficulties, token/ownership boundaries, schema/score
validation, saves, concurrent versions, deletion, transactional rollback with
mocks, old-account compatibility, and insert-only seed behavior.

An opt-in real-Atlas test is also available after approved difficulty seeding:

```powershell
$env:ATLAS_TEST_PUBLIC_DNS = '1'
try { npm run test:atlas:crud } finally { Remove-Item Env:ATLAS_TEST_PUBLIC_DNS }
```

It creates two `test4a_...` accounts, renames/updates only one of those new
accounts, and creates/completes one owned match. It tests real persistence,
transactional creation, ownership, concurrent saves, history, and health.
It does not seed automatically, call deletion endpoints, or modify previous
test accounts. All its records are retained, with their names/IDs printed for
later approved cleanup; credentials and tokens are never printed. Account
deletion and rollback are tested with mocks only, not against real accounts.

The existing DNS limitation remains: the workaround is confined to manual
seed/test processes. It does not change normal startup, `.env`, production
behavior, or Windows settings. Admin difficulty management, password changes,
multiplayer, and frontend modifications are outside Stage 4A.

## Stage 4A verification record (October 19, 2026)

- All 43 isolated tests passed, including the original 19 authentication tests.
- `npm audit` reported 0 vulnerabilities. No dependencies were added.
- Approved seed inserted Easy, Medium, and Hard; it did not overwrite settings.
- Real Atlas CRUD test passed with the process-only DNS workaround, including
  profile updates, transactions for creation, ownership, persistence, concurrent
  updates, completion, history, registration/login, and health.
- Deletion and deletion rollback were tested with mocks only. No real DELETE
  requests were sent. A separate rerun of the older Atlas authentication script
  was declined and was not run.
- Retained new users: `test4a_4636f4e36461_p` (renamed by the test) and
  `test4a_f000043dc1be`.
- Retained completed match: `6ad5ff42c8387c524216d3c7`, owned by the first test
  user. Any future removal requires approval.

Created files: `config/game.js`, `models/DifficultySetting.js`, `models/Match.js`,
`controllers/difficultyController.js`, `controllers/matchController.js`,
`routes/difficultyRoutes.js`, `routes/matchRoutes.js`, `utils/ApiError.js`,
`utils/validation.js`, `utils/safeMatch.js`, `scripts/seed-difficulties.js`,
`test/crud.test.js`, and `test/atlas-crud.js`.

Updated files: `models/User.js`, `utils/safeUser.js`,
`controllers/userController.js`, `routes/userRoutes.js`, `app.js`, `server.js`,
`package.json`, and this README. `.env`, `.env.example`, `.gitignore`, the
lockfile, and the frontend repository were not modified in Stage 4A.

## Stage 4B: Admin API

Every `/api/admin` endpoint requires a valid Bearer token and the current
database role `ADMIN`. A missing/invalid token returns 401; a registered
PLAYER returns 403. Token role claims and request-body roles cannot grant
access. Deleting a user makes their old tokens unusable. Role changes are
reflected on the next authenticated request without issuing a new token.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/admin/users` | Lists registered PLAYER accounts as `{ users }` |
| GET | `/api/admin/matches` | Lists system matches, newest updated first, as `{ matches }` |
| DELETE | `/api/admin/users/:id` | Deletes one PLAYER and their matches transactionally; 204 |
| GET | `/api/admin/difficulty` | Lists active and inactive settings as `{ difficulties }` |
| POST | `/api/admin/difficulty` | Creates a setting; 201 and `{ difficulty }` |
| PUT | `/api/admin/difficulty/:id` | Updates name/speeds/active flag; 200 and `{ difficulty }` |
| DELETE | `/api/admin/difficulty/:id` | Removes an unused setting; 204 |

Admin account deletion is limited to PLAYER targets. This route rejects
self-deletion and deletion of another ADMIN with 403. The target role is
checked again in the transactional delete filter, protecting accounts that
are concurrently promoted. Player deletion and match cleanup commit together;
failure rolls back both. Other players' accounts and matches are unaffected.
User responses never include passwords or hashes. Match responses use the
existing explicit safe fields and difficulty snapshots; no password-bearing
user documents are populated into them.

Difficulty POST accepts `levelName` and optional `aiSpeed`, `ballSpeed`,
`isActive`. Defaults are AI speed 200, ball speed 300, active true. PUT accepts
any non-empty subset of those four fields. Other fields are rejected. Names
must be 1-32 letters, numbers, spaces, underscores, or hyphens, beginning with
a letter or number; surrounding whitespace is removed. Name uniqueness uses
the existing exact-name MongoDB index, with duplicate-key errors returning
409. Speeds must be actual JSON numbers from 1 to 2000 logical Canvas pixels
per second; `isActive` must be a JSON boolean. Invalid bodies/IDs return 400,
missing records 404, and database failures a generic 500.

Use PUT `{ "isActive": false }` to deactivate or `{ "isActive": true }` to
reactivate. Deactivation hides the setting from the public active list and
prevents new matches/preferences from choosing it. It does not alter existing
matches, scores, status, or snapshots. Existing matches can still resume from
their saved snapshot. Renaming or changing speeds also affects only future
selections, not stored snapshots.

DELETE is allowed only if no match (including completed history) or user
preference references the setting. A referenced setting returns 409 with
guidance to deactivate it instead. Removal is transactional. New match and
preference references also write the difficulty's internal version within
their transactions, serializing these operations against deletion. This
prevents a simultaneous selection from creating a dangling reference. These
internal version writes do not change the setting's public timestamps.

## Manually grant the first Admin role

No account is promoted at server startup or during tests. Public registration
always creates PLAYER accounts, and no API endpoint changes roles. The
following is a manual backend maintenance command, not an HTTP endpoint.

1. Choose or register the intended person's own account through the existing
   registration endpoint. Do not select an old test account by default.
2. Obtain explicit approval for that particular account's promotion.
3. Open an interactive VS Code terminal in this backend folder and run:

```powershell
npm run admin:grant -- your_registered_username
```

The command connects to `pickleball_game`, finds the normalized existing
username, and displays only its username and ID. It then requires the exact
confirmation `PROMOTE your_registered_username`. A blank response, `yes`,
misspelling, or different username cancels without any role change. The
command refuses noninteractive/piped execution. There is no `--yes` bypass,
hardcoded account, password reset, new-account creation, or automatic promotion.
An existing ADMIN produces a no-op. The update changes only the role (and
automatic modification timestamp), with an atomic PLAYER/ID/username filter.

If the documented DNS limitation applies, the override is limited to this
manual command's process:

```powershell
$env:ATLAS_TEST_PUBLIC_DNS = '1'
try { npm run admin:grant -- your_registered_username } finally { Remove-Item Env:ATLAS_TEST_PUBLIC_DNS }
```

After confirmation, log in normally as that user and send the returned token
to Admin endpoints. Each groupmate should register their own account and
receive individually approved promotion if Admin access is needed. Do not
share passwords or tokens. Database access and the private backend environment
are required to run the maintenance command; it is not exposed to browsers.

## Manually test Admin endpoints

Start the server using the existing development/DNS instructions. After an
approved Admin has logged in, store the response in `$adminLogin` without
printing its token. Use these dummy examples with that account's token:

```powershell
$api = 'http://localhost:5000/api'
$adminHeaders = @{ Authorization = "Bearer $($adminLogin.token)" }
Invoke-RestMethod "$api/admin/users" -Headers $adminHeaders
Invoke-RestMethod "$api/admin/matches" -Headers $adminHeaders
Invoke-RestMethod "$api/admin/difficulty" -Headers $adminHeaders

$body = @{ levelName = 'Demo Practice'; aiSpeed = 160; ballSpeed = 260 } | ConvertTo-Json
$level = (Invoke-RestMethod -Method Post -Uri "$api/admin/difficulty" -Headers $adminHeaders -ContentType 'application/json' -Body $body).difficulty
$body = @{ isActive = $false } | ConvertTo-Json
Invoke-RestMethod -Method Put -Uri "$api/admin/difficulty/$($level.id)" -Headers $adminHeaders -ContentType 'application/json' -Body $body

# Optional permanent actions: execute only on approved disposable data.
# Invoke-RestMethod -Method Delete -Uri "$api/admin/difficulty/$($level.id)" -Headers $adminHeaders
# Invoke-RestMethod -Method Delete -Uri "$api/admin/users/<disposable-player-id>" -Headers $adminHeaders
```

Repeat an Admin GET with a PLAYER token to verify 403, or omit authentication
to verify 401. Existing players still use the same authentication, profile,
and match routes as before. There is no Admin dashboard, impersonation,
role-management API, account deactivation, or Admin demotion command in this
stage. List endpoints remain unpaginated for this course demonstration.

`npm test` runs all prior suites plus isolated Admin tests. The Admin suite
mocks MongoDB methods and transactions; it covers authorization, safe lists,
deletion/rollback, difficulty validation/CRUD, reference protection, snapshot
preservation, and exact promotion confirmation. It never connects to Atlas,
grants a real role, or deletes real data. Run `npm audit` for dependency checks.
Real Admin writes require separate approval; none are performed automatically.

Stage 4B files created: `controllers/adminController.js`, `routes/adminRoutes.js`,
`scripts/grant-admin.js`, and `test/admin.test.js`. Updated: `app.js`,
`controllers/userController.js`, `controllers/matchController.js`,
`test/crud.test.js`, `package.json`, and this README. No dependencies or models
were added or changed in this stage.

Stage 4B verification on October 19, 2026: all 64 isolated tests passed
(43 previous tests plus 21 Admin tests), syntax checks passed, and npm audit
reported 0 vulnerabilities. No real Atlas accounts were promoted, modified,
or deleted for these tests; no real difficulty settings or matches were
changed. Admin database transactions and confirmation behavior were verified
with mocks, not with real Admin writes.

## Stage 2: API rate limiting (local implementation; Render verification required)

`express-rate-limit` 8.7.1 adds independent in-memory policies. Existing
authentication, JWTs, ownership checks, schemas, scoring, response bodies,
Stage 1 headers, CORS origins, and the 100 KB JSON limit remain unchanged.
Limited requests return 429 with `{ "message": "Too many requests. Please wait and try again." }`,
`Retry-After` in seconds, and standard `RateLimit` / `RateLimit-Policy` headers.
The existing CORS exposed-header configuration is unchanged; browser JavaScript
cannot read these new response headers without a future explicit CORS change.
The JSON message remains readable by the allowed frontend origins.

| Policy | Protected endpoints | Initial budget | Key and counting |
| --- | --- | --- | --- |
| Login burst | POST `/api/auth/login` | 120 per minute | Network/IP; every request reaching the limiter, including successful logins |
| Login failures | POST `/api/auth/login` | 120 per 15 minutes | Same network/IP; successful responses are refunded after completion |
| Registration | POST `/api/auth/register` | 60 per hour | Network/IP; successful and failed requests reaching the limiter |
| Account writes | PUT/DELETE `/api/users/profile`; POST `/api/matches`; PATCH/DELETE `/api/matches/:id`; DELETE `/api/admin/users/:id`; POST `/api/admin/difficulty`; PUT/DELETE `/api/admin/difficulty/:id` | 300 per minute, shared across these operations | Current authenticated MongoDB user ID; successes and failures after authentication/role checks |
| Match creation | POST `/api/matches` | Additional 60 per minute | Current authenticated MongoDB user ID |

Authentication limits run before credential validation, bcrypt and controller
database operations. The existing JSON parser still runs first, so malformed or
oversized JSON is rejected by Stage 1 before reaching these route limiters.
Write limits run after authentication, and after the ADMIN role check on Admin
routes. They cannot replace authentication or stop database work done by JWT
authentication itself. No username, body/query user ID, raw token, or raw
forwarded-header value is used as a custom limiter key.

GET/HEAD/OPTIONS do not consume write budgets. CORS handles preflight before
route limiters. Public health/difficulty and authenticated reads are unchanged.
Different players on school Wi-Fi have separate write budgets. Their network
authentication budgets are shared; the generous initial thresholds allow a class
to log in, but repeated failures or more than 60 registrations from one IP in an
hour can temporarily affect other classmates. Successful logins consume the burst
budget but are refunded from the longer failure budget. In-flight requests count
until completed. There is no persistent account lock or account-record mutation.
Wait for `Retry-After`; blocked requests do not extend the current window.

The write budget permits five writes per second averaged over a minute, and
the creation budget permits one new match per second averaged over a minute.
These policies allow bursts and are intended to accommodate point-by-point
saves and automated local gameplay. A depleted shared write budget temporarily
blocks saves/deletes too; reads remain available. Do not blindly retry failed
saves, and continue honoring the existing version/conflict rules.

### Proxy trust: production deployment prerequisite

**This change deliberately does not change Express `trust proxy` (default false).
Do not deploy the IP-based auth policies to Render until its actual request
path and header sanitization have been verified and an appropriate trust policy
has been reviewed.** Without that work, proxy IPs can share authentication
counters across unrelated visitors, causing accidental 429 responses.

With `trust proxy: false`, Express uses the socket peer address, ignoring claimed
client IP headers. This preserves direct localhost behavior and prevents direct
clients from rotating forwarded headers to evade a budget. With an explicit
trusted-proxy policy, Express walks the socket/X-Forwarded-For chain from right
to left and stops at the first untrusted peer. Never take the leftmost header
entry directly. The limiter's default key generator normalizes IPv4-mapped IPv6
and groups IPv6 by /56 to reduce address-rotation bypasses. These subnet budgets
can aggregate legitimate clients too.

Research sources:
- [Render edge protection and client-IP guidance](https://render.com/articles/how-render-handles-ddos-attacks)
- [Express proxy trust and spoofing warnings](https://expressjs.com/en/guide/behind-proxies/)
- [express-rate-limit configuration](https://express-rate-limit.mintlify.app/reference/configuration)

Render documents edge proxies and X-Forwarded-For, but the repository does not
establish the deployment's complete proxy chain, trusted ingress addresses,
header overwrite/append guarantees, or alternate/direct paths. Neither `true`
nor a guessed hop count is configured. Before a separately approved deployment:

1. Establish every ingress path (onrender hostname, custom domain, extra CDN,
   and any direct/private route) and the immediate proxy peers.
2. Confirm how ingress removes or appends attacker-supplied forwarded headers;
   obtain reliable trusted-proxy address ranges or a proven fixed-hop topology.
3. Review an explicit trust policy against every path. A hop count is acceptable
   only if shorter paths cannot let client-supplied entries become trusted.
4. Verify independent client identities, shared-IP behavior and forged prefixes
   in an approved disposable/staging setup. Use private diagnostics; do not add
   public IP/debug endpoints or test/flood production.
5. Keep limiter validation warnings enabled and resolve them before release.

The local proxy fixtures trust only explicitly simulated peers; they do not
prove Render's configuration. Validation warnings are not disabled in production.
For example, forwarded headers with default false trigger the library's warning.
`Forwarded`, `True-Client-IP` and similar headers are not custom identity sources.

### In-memory limits and isolated verification

Each policy has a separate MemoryStore. Counters expire in their configured
windows and reset on process restart, redeployment or a Render process restart.
Multiple processes/instances have independent counters; use a compatible shared
store before relying on a service-wide budget across instances. No database
collection, schema, environment variable or Render dashboard setting was added.
Rate limiting is a basic abuse control; distributed clients can still evade
per-IP budgets, and unbounded list pagination remains a separate future task.

`test/rateLimits.test.js` injects small policy budgets and independent stores
into real app/routes. It uses mocked database calls, real JWT checks and local
HTTP servers, and checks threshold rejection before bcrypt/write work, success
refunds, expiry with a controlled clock, shared networks, proxy trust/spoofing,
IPv4/IPv6 handling, preflights, authorization and repeated point saves. It never
loads `.env`, connects to Atlas, or writes persistent data. The existing 81
tests remain unchanged.

```powershell
npm.cmd test
npm.cmd audit --omit=dev
git diff --check
```
