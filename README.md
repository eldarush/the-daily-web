# The Daily Web

A news publishing system built with Node.js, Express, MongoDB/Mongoose and EJS.
The browser uses semantic HTML, responsive CSS/Flexbox, Vanilla JavaScript,
native `fetch` for Ajax, and canvas for analytics. There is no frontend framework
or build step.

## Install and run

Requirements: Git, Node.js 22 or newer, and a running MongoDB 6 or newer.

From PowerShell:

```powershell
git clone https://github.com/eldarush/the-daily-web.git
Set-Location the-daily-web
npm ci
Copy-Item .env.example .env
```

On Linux or macOS, use `cd the-daily-web` and `cp .env.example .env` instead.

Edit `.env`: set `MONGODB_URI` to a new local demonstration database and replace `SESSION_SECRET`
with a private random value of at least 32 characters. Keep that value stable
between restarts. Environment files are ignored by Git.

For the first run, populate the database before starting the app so the demo
accounts exist. The seed command deletes all articles, comments and view
statistics in the selected database and recreates the five demo accounts.
Use it only against a dedicated local database.

```powershell
npm run seed
npm start
```

Open http://localhost:3000 (or the port set in `.env`) and sign in with a demo
account below. `npm run dev` starts the development watcher.

## Demo data

Run `npm run seed` again only when you want to reset the demonstration data.
It deletes all articles, comments and view statistics, and recreates the five
demo accounts. Other user accounts, sessions and guest-limit records are retained.

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

## Newsfeed implementation

`controllers/feedController.js` handles the home page and feed API through
`routes/webRoutes.js` and `routes/api/feedRoutes.js`. It filters published
articles before applying sorting and pagination, returns at most 20 per page,
and selects only public card fields and the author's name. Drafts, staged
revisions and editor notes are excluded. `hasMore` tells the browser whether
another page is available. The article ID breaks sorting ties; new publications
or changing view counts can still move results between pages.

`views/pages/home.ejs` renders the first batch. The shared
`views/partials/feed-card.ejs` also supplies the template used by
`public/js/newsfeed.js` for Ajax results, with layout in `public/css/newsfeed.css`.
Article text uses escaped EJS output or `textContent`. Scrolling uses
`IntersectionObserver`; the Load more button also requests the next batch.

Search waits 300 milliseconds after typing and matches literal text in titles
or summaries, including regex punctuation. Article visits are recorded in
`localStorage`; this reading history is local to the browser and is not an
authorization mechanism. Reading still works if storage is blocked, but history
cannot be retained. Read/unread filters send IDs in JSON to the read-only
`POST /api/articles/search` endpoint to avoid oversized query URLs; other feed
requests use `GET /api/articles`.

Request numbers prevent older filter responses from replacing newer results.
The page number advances only after a successful response, so Retry requests
the failed page without skipping a batch.

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
| `config/` | MongoDB connection, persisted sessions and file logging |
| `models/` | Users, articles, comments, hourly views and guest limit records |
| `controllers/` | Validation, feed queries, workflow, comments, weather and statistics |
| `middlewares/` | Authentication, roles, guest limiter, operation logging and shared error handling |
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

```powershell
npm test
npm audit --omit=dev
```

Jest creates isolated temporary MongoDB databases and enforces the existing
100% coverage threshold for controllers, models, middleware and routes. The first
run may download a MongoDB test binary.
Coverage does not describe browser scripts or prove every requirement.

Browser tests require a running MongoDB service and an **empty dedicated test
database**. Stop any app listening on port 3000 first. Playwright uses that port
even if `.env` specifies another one. `CI=1` disables reusing an existing server,
so an occupied port fails the run instead of testing the wrong app/database.

In a separate PowerShell terminal:

```powershell
$env:PORT = '3000'
$env:NODE_ENV = 'test'
$env:MONGODB_URI = 'mongodb://127.0.0.1:27017/the_daily_web_test'
$env:SESSION_SECRET = 'local-browser-tests-only-secret-0123456789'
$env:CI = '1'
npx playwright install chromium
npm run test:e2e
```

On Linux CI, install the browser's system dependencies with
`npx playwright install --with-deps chromium`. Close the test terminal afterward
so its environment settings do not affect normal development. Never run test
fixtures or seed commands against shared or production data.

`tests/e2e/newsfeed.spec.js` covers pagination, combined filters, stale responses,
retry, escaped titles and reading storage. `submission-integration.spec.js`
checks real article navigation, rendering without JavaScript and weather expiry.
`workflow-diff-analytics.spec.js` covers published revision submission and review;
`tests/unit/support-fixes.test.js` checks shared weather refreshes and failures.
For a manual check, combine filters, scroll through the final short batch, open
an article and return with Read only selected, then check a narrow viewport,
an empty search result and a failed request followed by Retry.

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
