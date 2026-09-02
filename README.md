# 📰 The Daily Web (מערכת חדשות)

> **Final Capstone Project — Web Application Development Course**  
> A high-performance, responsive news publishing and editorial management platform built strictly with native web standards and Express.js MVC.

---

## 🚨 Strict Architectural Invariants & Course Bounds

This project strictly adheres to the course constitution with zero deviation:

| Layer | Permitted Technology | Prohibited Technologies (Zero Tolerance) |
|---|---|---|
| **Backend** | Node.js, Express.js (strict MVC) | NestJS, Koa, Fastify |
| **Database** | MongoDB with Mongoose ODM (4+ models) | SQL, Firebase, Prisma |
| **Persistence** | `connect-mongo` (sessions survive server restarts) | In-memory session store |
| **SSR / Views** | EJS (Server-Side Templating for SEO) | React, Next.js, Vue, Angular, Svelte |
| **Client-Side** | Pure Vanilla JavaScript (DOM manipulation, native `fetch()`) | jQuery, Axios (client-side), Alpine.js |
| **Styling** | Semantic HTML5, Pure CSS Flexbox (`variables.css`, `layout.css`) | Bootstrap, Tailwind CSS, Material UI |
| **Build Tools** | Native browser ES modules / scripts | Webpack, Vite, Rollup, Babel |

---

## 🏛️ System Architecture & 4-Way Team Division

The codebase is partitioned into four independent, decoupled tracks owned equally by the peer development team:

```
                               ┌─────────────────────────────┐
                               │       Client Browser        │
                               │  (Vanilla JS + CSS Flexbox) │
                               └──────────────┬──────────────┘
                                              │ HTTP / JSON
                                              ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               Express.js MVC Application                               │
├──────────────────────────────┬─────────────────────────────┬───────────────────────────┤
│ Track 1: Eldar               │ Track 2: Segev              │ Track 3 & 4: Ofir & Hodara│
│ - Express Scaffolding        │ - Public Newsfeed SSR & AJAX│ - Commenting System (Ofir)│
│ - Session (`connect-mongo`)  │ - Live Search & Filtering   │ - Spam Limiting (HTTP 429)│
│ - User Model & Bcrypt        │ - Client-Side State Machine │ - Autosave Engine (Hodara)│
│ - RBAC (`reporter`, `editor`)│ - Infinite Scroll (20/batch)│ - Dual-Version Revisions  │
│ - Weather Cache (15-min TTL) │                             │ - Impact Analytics Chart  │
└──────────────────────────────┴─────────────────────────────┴───────────────────────────┘
                                              │ Mongoose ODM
                                              ▼
                               ┌─────────────────────────────┐
                               │       MongoDB Database      │
                               │   users, articles, comments │
                               │   sessions, view_analytics │
                               └─────────────────────────────┘
```

### Module Ownership Matrix:
1. **Module 1 (Eldar)**: Core Platform Scaffolding, User Model, Bcrypt Security, Persistent Mongo Sessions, RBAC Middleware, Editor User CRUD, and Cached Weather Infrastructure.
2. **Module 2 (Segev)**: Public Newsfeed SSR & Vanilla AJAX Newsfeed Engine (Infinite Scroll, Multi-Filter, Live Debounced Search).
3. **Module 3 (Ofir)**: Article Detail SSR View, Interactive Commenting System, Anti-Spam Rate Limiting (max 3 comments/min, HTTP 429).
4. **Module 4 (Hodara)**: Dual-Version Revision Workflow, Reporter Real-Time Autosave, Side-by-Side Editorial Diff Viewer, and Time-Series Impact Analytics.

---

## 🔐 Authentication, RBAC & Security (Module 1)

### Role-Based Access Control (RBAC) Matrix:
| Endpoint / Resource | Guest | Reporter | Editor |
|---|:---:|:---:|:---:|
| `GET /` (Newsfeed) | ✅ | ✅ | ✅ |
| `GET /api/weather` | ✅ | ✅ | ✅ |
| `POST /api/auth/login` | ✅ | ✅ | ✅ |
| `POST /api/auth/logout` | ❌ (401) | ✅ | ✅ |
| `GET /api/auth/me` | ❌ (401) | ✅ | ✅ |
| `GET /workspace` (Autosave Studio) | ❌ (302) | ✅ | ❌ (302) |
| `GET /editor` (Review Hub) | ❌ (302) | ❌ (403) | ✅ |
| `GET /api/users` (User Management) | ❌ (401) | ❌ (403) | ✅ |
| `POST /api/users` (Create User) | ❌ (401) | ❌ (403) | ✅ |
| `PUT /api/users/:id` (Update User) | ❌ (401) | ❌ (403) | ✅ |
| `DELETE /api/users/:id` (Delete User) | ❌ (401) | ❌ (403) | ✅ |

### Security Guarantees:
- **Password Hashing**: Passwords hashed with `bcrypt` using 12 salt rounds before persisting to MongoDB. Plaintext passwords are never stored.
- **Session Durability**: User authentication is backed by `connect-mongo` storing sessions in MongoDB collection `sessions` with a 14-day TTL. Restarting the Node.js server does not log users out.
- **Role Enforcement**: Every privileged endpoint executes server-side validation using `middlewares/auth.js` and `middlewares/rbac.js`.
- **Safe Object Serialization**: `User.toSafeObject()` strips password hashes from all outbound API responses.

---

## 🌤️ External Weather Service Architecture

The weather widget integrates with OpenWeatherMap while satisfying the project constraint: **data shown to the user can be delayed up to 15 minutes max**.

- **In-Memory Cache TTL**: 15 minutes (`15 * 60 * 1000` ms).
- **Behavior**: Calls external API on first request or after cache expiry; all intermediate requests within the 15-minute window are served instantly from cache (`cached: true`).
- **Offline Resilience**: If the API key is not configured or network requests fail, the service returns a realistic fallback payload for Tel Aviv, ensuring uninterrupted UI rendering.

---

## 📁 Directory Structure

```text
the-daily-web/
├── .github/workflows/ci.yml       # GitHub Actions CI pipeline
├── config/
│   ├── db.js                      # Mongoose connection & shutdown lifecycle
│   └── session.js                 # connect-mongo persistent session store
├── controllers/
│   ├── authController.js          # Authentication (login, logout, me)
│   ├── userController.js          # Editor user CRUD operations
│   └── weatherController.js       # Weather service with 15-min cache
├── middlewares/
│   ├── auth.js                    # Session authentication guard
│   ├── rbac.js                    # Role-based authorization guard
│   └── errorHandler.js            # Centralized error formatting & logging
├── models/
│   └── User.js                    # Mongoose User model with bcrypt salt 12
├── public/
│   ├── css/
│   │   ├── variables.css          # Design tokens & color system
│   │   └── layout.css             # Pure CSS Flexbox responsive layout
│   └── js/
│       └── weather.js             # Vanilla JS weather fetcher & DOM updater
├── routes/api/
│   ├── authRoutes.js              # /api/auth routes
│   ├── userRoutes.js              # /api/users routes (Editor only)
│   └── weatherRoutes.js           # /api/weather routes
├── tests/
│   ├── unit/
│   │   └── auth-user.test.js      # Jest unit & integration tests (>95% coverage)
│   └── e2e/
│       └── auth-session.spec.js   # Playwright end-to-end browser tests
├── views/
│   ├── layouts/main.ejs           # Base HTML5 semantic shell
│   ├── pages/
│   │   ├── home.ejs               # Public newsfeed placeholder
│   │   ├── login.ejs              # Responsive sign-in form
│   │   ├── workspace.ejs          # Reporter drafting studio placeholder
│   │   ├── editor.ejs             # Editor review hub placeholder
│   │   └── error.ejs              # Centralized error page
│   └── partials/
│       ├── navbar.ejs             # Responsive header with session state
│       ├── weather-widget.ejs     # Sidebar weather card
│       └── footer.ejs             # Semantic footer
├── app.js                         # Express MVC application setup
├── server.js                      # HTTP server bootstrap & DB listener
├── package.json                   # Dependencies & test thresholds
└── README.md                      # Comprehensive system documentation
```

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js**: v18.x or higher
- **MongoDB**: v6.x or higher (or MongoDB Atlas)

### 2. Installation
```bash
git clone https://github.com/eldarush/the-daily-web.git
cd the-daily-web
npm install
```

### 3. Environment Variables
Create a `.env` file in the root directory (based on `.env.example`):
```ini
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/the_daily_web
SESSION_SECRET=daily-web-ultra-secure-session-key-production
WEATHER_CITY=Tel Aviv
OPENWEATHER_API_KEY=your_openweathermap_api_key_here
NODE_ENV=development
```

### 4. Running the Application
```bash
# Start server
npm start

# Or with nodemon for development
npm run dev
```
Navigate to `http://localhost:3000` in your web browser.

---

## 🧪 Testing & Verification

### Unit & Integration Tests (Jest)
Runs the complete test suite with `mongodb-memory-server` and strict coverage thresholds:
```bash
npm test
```

**Current Test Metrics:**
- **Statements**: `96.9%` (Threshold: `90%`)
- **Lines**: `96.7%` (Threshold: `90%`)
- **Functions**: `100.0%` (Threshold: `95%`)
- **Branches**: `83.6%` (Threshold: `80%`)
- **Passing Tests**: `35 / 35` (100% pass rate)

### End-to-End Browser Tests (Playwright)
```bash
npx playwright test
```
Tests complete browser user flows:
- Login authentication with real credentials.
- Redirection to workspace/editor based on role.
- Session persistence across browser reloads.
- Sidebar weather widget rendering.
- User sign-out and session revocation.
