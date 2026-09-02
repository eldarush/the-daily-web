# The Daily Web

A high-performance news publishing and editorial management platform built with Express.js MVC, MongoDB, and vanilla front-end web standards.

---

## Architectural Principles

The application is built around standard web technologies with zero client-side framework dependencies:

- **Server-Side Rendering**: EJS templates deliver complete HTML pages on initial load for optimal SEO indexing and fast first-contentful-paint.
- **Client Scripting**: Pure Vanilla JavaScript with native `fetch()` and standard DOM APIs. No client build steps or bulky framework runtimes.
- **Layout & Presentation**: Semantic HTML5 elements (`header`, `nav`, `main`, `aside`, `footer`) styled with responsive CSS Flexbox.
- **Session Persistence**: Sessions are backed by MongoDB via `connect-mongo`, surviving server restarts and deployments.
- **Data Security**: Passwords hashed with `bcrypt` (12 salt rounds) at the model schema level. Outgoing user models never leak password hashes.

---

## System Architecture

```
                       +-----------------------------+
                       |       Client Browser        |
                       |  (Vanilla JS + CSS Flexbox) |
                       +--------------+--------------+
                                      | HTTP / REST / JSON
                                      v
+-------------------------------------------------------------------------------+
|                           Express.js MVC Application                          |
+--------------------------+----------------------------+-----------------------+
| Identity & Access        | Content Delivery           | Editorial Operations  |
| - Authentication         | - Public Newsfeed SSR      | - Article Workspace   |
| - Session Store (Mongo)  | - Live AJAX Search         | - Dual-Version Drafts |
| - RBAC (Reporter/Editor) | - Category Filtering       | - Editorial Reviews   |
| - Weather Integration    | - Infinite Scroll Batches  | - Reader Analytics    |
+--------------------------+----------------------------+-----------------------+
                                      | Mongoose ODM
                                      v
                       +-----------------------------+
                       |       MongoDB Database      |
                       |   users, articles, comments |
                       |   sessions, view_analytics |
                       +-----------------------------+
```

### Key Modules:
- **Identity & Access Management**: User authentication, role-based authorization guards, session persistence, and editor user administration.
- **Content Delivery**: Server-rendered public articles, infinite-scroll newsfeed, live debounced search, and category filtering.
- **Reader Engagement**: Article discussion threads and IP-based rate limiting to prevent spam submissions.
- **Editorial Operations**: Dual-version drafting workflows, continuous autosave, editorial review queues, and view impact analytics.

---

## Access Control

| Route | Guest | Reporter | Editor |
|---|:---:|:---:|:---:|
| `GET /` | Allowed | Allowed | Allowed |
| `GET /api/weather` | Allowed | Allowed | Allowed |
| `POST /api/auth/login` | Allowed | Allowed | Allowed |
| `POST /api/auth/logout` | 401 | Allowed | Allowed |
| `GET /api/auth/me` | 401 | Allowed | Allowed |
| `GET /workspace` | Redirect (`/login`) | Allowed | Redirect (`/login`) |
| `GET /editor` | Redirect (`/login`) | 403 | Allowed |
| `GET /api/users` | 401 | 403 | Allowed |
| `POST /api/users` | 401 | 403 | Allowed |
| `PUT /api/users/:id` | 401 | 403 | Allowed |
| `DELETE /api/users/:id` | 401 | 403 | Allowed |

---

## Weather Service

The platform includes a localized weather service displaying current meteorological conditions:
- Fetches data from OpenWeatherMap API using server-side caching.
- Cached in-memory with a 15-minute TTL to respect external rate limits.
- Automatically serves realistic fallback conditions if external APIs are unreachable.

---

## Project Structure

```text
the-daily-web/
├── .github/workflows/ci.yml       # GitHub Actions CI pipeline
├── config/
│   ├── db.js                      # MongoDB connection manager
│   └── session.js                 # Session persistence configuration
├── controllers/
│   ├── authController.js          # Authentication handlers
│   ├── userController.js          # User administration CRUD
│   └── weatherController.js       # Weather service with 15-minute caching
├── middlewares/
│   ├── auth.js                    # Session authentication check
│   ├── rbac.js                    # Role-based access control
│   └── errorHandler.js            # Centralized error handler
├── models/
│   └── User.js                    # User schema and password hashing
├── public/
│   ├── css/
│   │   ├── variables.css          # Color tokens and shared styles
│   │   └── layout.css             # Flexbox responsive grid
│   └── js/
│       └── weather.js             # Vanilla JS weather fetcher
├── routes/api/
│   ├── authRoutes.js              # Authentication API endpoints
│   ├── userRoutes.js              # User management API endpoints
│   └── weatherRoutes.js           # Weather API endpoint
├── tests/
│   ├── unit/
│   │   └── auth-user.test.js      # Unit and integration test suite
│   └── e2e/
│       └── auth-session.spec.js   # Playwright end-to-end browser suite
├── views/
│   ├── pages/
│   │   ├── home.ejs               # Main newsfeed view
│   │   ├── login.ejs              # Login form view
│   │   ├── workspace.ejs          # Reporter drafting view
│   │   ├── editor.ejs             # Editor management hub
│   │   └── error.ejs              # Error display page
│   └── partials/
│       ├── header.ejs             # Global head and opening layout
│       ├── navbar.ejs             # Top navigation bar
│       ├── weather-widget.ejs     # Sidebar weather card
│       └── footer.ejs             # Footer and script loader
├── app.js                         # Express application setup
├── server.js                      # Server startup and shutdown handling
├── package.json                   # Dependencies and scripts
└── README.md
```

---

## Getting Started

### Prerequisites
- Node.js 20 or higher
- MongoDB 6.0 or higher

### Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env`:
```ini
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/the_daily_web
SESSION_SECRET=your-secure-session-key
WEATHER_CITY=Tel Aviv
OPENWEATHER_API_KEY=your_openweathermap_api_key
NODE_ENV=development
```

3. Run the development server:
```bash
npm run dev
```

The application will be accessible at `http://localhost:3000`.

---

## Running Tests

### Unit and Integration Tests
```bash
npm test
```
Runs the Jest suite against an in-memory MongoDB instance with full code coverage verification.

### End-to-End Tests
```bash
npx playwright test
```
Executes headless browser tests validating login workflows, session persistence, and UI component rendering.

---

## Module 4 — Publishing Workflow, Diff Viewer & Impact Analytics

Owns the `Article` and `ViewAnalytics` models and the reporter/editor/analytics
surface built on top of the shared foundation (User, auth, RBAC, sessions).

### Features
- **Continuous autosave** — the reporter workspace (`/workspace`) saves on every
  keystroke (800 ms debounce) to both the server and `localStorage`. No save
  button. Reloading, closing the tab, or switching machines restores the latest
  version (server-backed), so work is never lost.
- **Dual-version publishing** — editing an already-published article stages the
  changes in `pendingUpdate`. The public keeps seeing the live version until an
  editor approves; approval promotes the staged fields and records a milestone.
- **Strict state machine** — `draft → pending`, `pending → published`,
  `pending → rejected` (with mandatory notes), `rejected → pending`. All other
  transitions are refused server-side.
- **Editor hub** (`/editor`) — filterable, paginated table with a review modal:
  side-by-side **word-level diff** (pure Vanilla JS, no library), inline edit,
  approve, return-for-corrections, and delete.
- **Impact Analytics** (`/editor/analytics`) — a pure-Canvas time-series of
  hourly views with vertical milestone markers at each editor update, so the
  before/after readership impact is visible. Hover for exact values and the
  changelog note.

### API (all permission-checked server-side)
| Method | Endpoint | Role |
|---|---|---|
| `GET` | `/api/reporter/articles` | Reporter |
| `POST` | `/api/reporter/articles` | Reporter |
| `PUT` | `/api/reporter/articles/:id/autosave` | Reporter |
| `POST` | `/api/reporter/articles/:id/submit` | Reporter |
| `GET` | `/api/editor/articles` | Editor |
| `GET` | `/api/editor/articles/:id/diff` | Editor |
| `PUT` | `/api/editor/articles/:id` | Editor |
| `POST` | `/api/editor/articles/:id/approve` | Editor |
| `POST` | `/api/editor/articles/:id/reject` | Editor |
| `DELETE` | `/api/editor/articles/:id` | Editor |
| `GET` | `/api/analytics/:articleId` | Editor |

`recordView(articleId)` in `controllers/analyticsController.js` is the helper the
public article page calls to increment `viewsCount` and the hourly bucket.

### Demo data
```bash
npm run seed
```
Generates 4 reporters + 1 editor (password `password123`), 520 articles across
all 7 categories and all 4 states, 168 hours of hourly view curves with
post-update bumps, update histories, and 15 live articles with a staged revision
for the diff demo.
