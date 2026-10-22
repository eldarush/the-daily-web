# The Daily Web

A news publishing system built with Node.js, Express, MongoDB/Mongoose and EJS.
The browser uses semantic HTML, responsive CSS/Flexbox, Vanilla JavaScript,
native `fetch` for Ajax, and canvas for analytics. There is no frontend framework
or build step.

## Install and run

Requirements: Node.js 22 or newer and a running MongoDB 6 or newer.

```bash
npm ci
cp .env.example .env
```

Edit `.env`: set `MONGODB_URI` to your own database and replace `SESSION_SECRET`
with a private random value of at least 32 characters. Keep that value stable
between restarts. Environment files are ignored by Git.

```bash
npm start
```

Open http://localhost:3000. `npm run dev` runs the existing development watcher.

## Demo data

Use a dedicated demonstration database: seeding resets articles, comments and
view statistics, and recreates the five demo accounts.

```bash
npm run seed
```

The dataset contains 520 articles, four reporters, one editor, 120 comments,
all publication states, pending revisions, multiple published updates and hourly
view timelines. The script reports inserted counts and fails on insertion errors.

Demo accounts: `editor`, `reporter1`, `reporter2`, `reporter3`, `reporter4`.
Their demo password is `password123`; these accounts are for local demonstration.

## User accounts

An authenticated editor creates accounts with `POST /api/users`, supplying
`username`, `password`, `fullName` and `role` (`reporter` or `editor`). Send the
original password over HTTPS; the User model hashes it before saving. Do not
hash it in the client or insert accounts directly into MongoDB, since direct
inserts bypass the model's password hook.

If an account was inserted manually with a plaintext password, an authenticated
editor can reset it with `PUT /api/users/:id` and a JSON body containing a new
`password`. The model hashes the replacement before saving. Usernames are
case-sensitive.

## Features and workflow

- The public feed loads 20 approved articles per batch. Search, category,
  viewed/unviewed filters, date/popularity sorting and additional batches use
  Ajax without reloading the page. Reading history belongs to each browser.
- Article pages contain the complete approved article in their initial HTML.
  Comments are escaped text and a new comment is appended immediately.
- Guest comment attempts are limited to three per rolling minute per signed
  browser identity. Its HttpOnly cookie survives sign-in and sign-out. MongoDB
  stores the limit atomically and expires old records.
  Different browser sessions sharing an IP have separate limits. Registered
  users are identified by their server session. Clearing all cookies starts a new
  browser identity; the application does not fingerprint devices.
- Reporters can manage only their own articles. Drafts and returned articles
  can be edited and submitted; submitted articles are read-only to reporters.
- A published article keeps its approved fields while `pendingUpdate` holds a
  separate draft, submitted or returned revision. An editor can inspect the
  live/proposed diff, edit submitted content, approve it or return it with notes.
  Approval promotes the revision and records an analytics milestone.
- The workspace captures edits immediately, keeps a local recovery copy and
  serializes server saves. Switching articles and submitting flush pending work;
  page exit also sends a keepalive request. Save failures remain visible and
  prevent submission. A fresh browser loads the last server-confirmed version.
  Sign-out waits for pending saves and stays in the workspace if saving fails.
  An offline device must reconnect for another computer to receive its edits.
- Staff lists and the analytics selector have pagination. Canvas shows hourly
  views and publication markers on one timeline, including zero-view gaps and
  visible single-hour points. Changing the selection clears the previous chart.
- User, article, comment and view-statistics operations use server authorization.
  Signed-in users are checked against the current account and role on requests.
  Passwords use bcrypt with 12 rounds and independent salts, and hashes are
  excluded from user API responses. Mongo-backed sessions survive server restart.
  Signing in replaces the guest session identifier.

The editor's approval action saves displayed edits before publication and stops
if saving fails. Revision comparisons include every editable field. Long article
comparisons show complete escaped text instead of allocating an unbounded word
comparison table.

## Operational logs

Sign-in/out, article workflow, user/comment/statistics mutations and their HTTP
outcomes are appended as JSON lines to `logs/operations.jsonl`. Centralized
unexpected request failures are persisted there too. Records contain timestamp,
operation area, method, route template, HTTP status and actor ID. Request bodies,
passwords, session/device cookies, query strings and article/comment text are
excluded. The directory is ignored by Git. Set `LOG_DIRECTORY` to an existing
deployment log location or let the app create the default directory. Give only
the service account access, configure rotation/retention on the hosting system,
and monitor stderr for a failed log destination. A logging failure does not make
a successfully completed database operation appear to have failed.

## Weather

The sidebar uses the [Open-Meteo forecast API](https://open-meteo.com/en/docs),
free for noncommercial use without an API key or credit card. Data attribution
appears in the widget. `WEATHER_CITY`, `WEATHER_LATITUDE` and `WEATHER_LONGITUDE`
must describe the same place; defaults point to Tel Aviv.

A shared in-flight request prevents duplicate refreshes in one server process.
Responses contain the provider observation time and the server fetch time.
Cached observations are served only while younger than 15 minutes; the browser
expires displayed data at that same deadline, including after a background tab returns. Provider
failures, invalid data and a ten-second timeout display weather unavailable;
expired observations are not presented as current weather. Cache state is per
server process, while authentication and guest limits are Mongo-backed.

## Project structure

| Path | Responsibility |
| --- | --- |
| `app.js`, `server.js` | Express setup, routes and server lifecycle |
| `config/` | MongoDB connection and persisted session configuration |
| `models/` | Users, articles, comments, hourly views and guest limit records |
| `controllers/` | Validation, feed queries, workflow, comments, weather and statistics |
| `middlewares/` | Authentication, roles, guest limiter and shared error handling |
| `routes/` | Web pages and REST endpoints |
| `views/` | EJS pages and shared partials |
| `public/` | CSS, browser JavaScript and the original default article image |
| `scripts/seed.js` | Demonstration dataset |
| `tests/unit/`, `tests/e2e/` | Existing Jest/integration and Playwright checks |

## Main REST endpoints

| Model/feature | Create | Read/List/Search | Update | Delete |
| --- | --- | --- | --- | --- |
| Users (editor) | `POST /api/users` | `GET /api/users`, `GET /api/users/:id` | `PUT /api/users/:id` | `DELETE /api/users/:id` |
| Articles | `POST /api/reporter/articles` | Public `GET /api/articles`; staff lists and diff | Reporter autosave or editor `PUT /api/editor/articles/:id` | Editor `DELETE /api/editor/articles/:id` |
| Comments | `POST /api/comments` | `GET /api/articles/:articleId/comments` | Editor `PUT /api/comments/:commentId` | Editor `DELETE /api/comments/:commentId` |
| Hourly views | Public article visit; editor bucket upsert | Editor `GET /api/analytics/:articleId` | Editor `PUT /api/analytics/:articleId/buckets` | Editor `DELETE /api/analytics/:articleId` resets buckets |

Bucket upsert accepts `{ "time": "2026-10-08T12:00:00.000Z", "views": 7 }`.
The timestamp must be an exact UTC hour and views a nonnegative integer.
Management operations update the article total as well. Article deletion also
removes related comments and view records.

Reporter submission: `POST /api/reporter/articles/:id/submit`.
Editor approval and return: `POST /api/editor/articles/:id/approve` and
`POST /api/editor/articles/:id/reject` (requires a nonempty `notes` string).
`GET /api/analytics/articles?page=1` lists lightweight published article choices.

## Checks

```bash
npm test
npx playwright install chromium
npm run test:e2e
npm audit --omit=dev
```

Jest creates isolated temporary MongoDB databases and enforces the existing
100% coverage threshold for controllers, models, middleware and routes.
Coverage does not describe browser scripts or prove every requirement.

Browser tests require a running **empty dedicated test database**. For example,
set `MONGODB_URI=mongodb://127.0.0.1:27017/the_daily_web_test` and a test
`SESSION_SECRET` before running them. Playwright starts the application itself.
On PowerShell, use `$env:MONGODB_URI="mongodb://127.0.0.1:27017/the_daily_web_test"`.
Never run destructive fixtures or seed commands against shared production data.

The production dependency audit reports zero advisories for the installed
lockfile at verification time. The full audit still reports development-tool
advisories in Jest/nodemon dependencies; the suggested forced changes replace
existing tools and were not applied. These packages process local test/config
files, not public requests. Recheck the audit before deployment.

## Deployment configuration

`NODE_ENV=production` requires a secret of at least 32 characters and sets
`Secure` session cookies. Use HTTPS and a private, access-controlled MongoDB
connection, with TLS for remote connections. Express proxy trust remains off
by default (`TRUST_PROXY=0`). If HTTPS terminates at one trusted reverse proxy,
set `TRUST_PROXY=1` and restart the server. This lets Express recognize the
forwarded HTTPS request and issue the Secure session cookie. Enable it only
when every request to Node passes through that proxy. Local HTTP development
uses `NODE_ENV=development` and leaves `TRUST_PROXY=0`.

Local automated checks cannot establish the access controls of a separately
hosted database or the team's HTTPS setup. Verify those on the actual hosting
system, and run the tested version on each presentation computer before submission.
The load checks exercise thousands of stored articles and concurrent requests;
they are not a claim about thousands of simultaneous deployed readers.
