# Pickle Ball Pixel Game Backend

The backend uses Express, Node.js, CommonJS, and MongoDB Atlas through Mongoose.
Stage 4A adds player profile management, active difficulty retrieval, and owned
match CRUD alongside registration, login, bcrypt, and JWT authentication.
Frontend API integration and Admin management are reserved for later stages.

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

The server supports a hosting-provided `PORT` for future Render deployment.
Deployment is not part of this stage.

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
Only `http://localhost:5173` is configured as the allowed browser CORS origin.
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
The reusable `requireRole` middleware is ready for future Admin routes;
no Admin routes are implemented in this stage.

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
