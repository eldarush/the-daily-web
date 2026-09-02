# The Daily Web

> **Modern, High-Performance News Publishing & Editorial Management Platform**  
> An enterprise-ready digital newspaper and newsroom workflow engine engineered strictly with native web standards and Express.js MVC.

---

## Core Architectural Standards & Technology Stack

The platform is built with a zero-dependency client philosophy to guarantee maximum speed, SEO discoverability, and clean maintainability:

| Layer | Technology | Architectural Rationale |
|---|---|---|
| **Backend Framework** | Node.js & Express.js (strict MVC) | Lightweight, predictable routing and controller architecture |
| **Data Layer** | MongoDB & Mongoose ODM | Flexible document storage with schema validation & indexing |
| **Session Persistence** | `connect-mongo` | Distributed session management; user sessions survive server restarts |
| **SSR / Templating** | EJS (Server-Side Rendering) | Fast initial server rendering and optimal SEO indexing |
| **Client Scripting** | Pure Vanilla JavaScript (Native `fetch()`, DOM APIs) | Zero bundle overhead, native browser performance, no framework bloat |
| **Styling & Layout** | Semantic HTML5 & Pure CSS Flexbox | Fully responsive layout across desktop, tablet, and mobile devices |

---

## System Architecture & Modular Division

The system is architected into four decoupled, modular subsystems:

```
                               +-----------------------------+
                               |       Client Browser        |
                               |  (Vanilla JS + CSS Flexbox) |
                               +--------------+--------------+
                                              | HTTP / REST / JSON
                                              v
+----------------------------------------------------------------------------------------+
|                               Express.js MVC Application                               |
+------------------------------+-----------------------------+---------------------------+
| Track 1: Eldar               | Track 2: Segev              | Track 3 & 4: Ofir & Hodara|
| - Express Scaffolding        | - Public Newsfeed SSR & AJAX| - Interactive Comments    |
| - Mongo Session Store        | - Live Search & Filtering   | - Spam Limiting (HTTP 429)|
| - User Model & Bcrypt        | - Client-Side State Machine │ - Real-Time Autosave      │
| - RBAC (reporter, editor)    | - Infinite Scroll (20/batch)| - Dual-Version Revisions  |
| - Weather Cache (15-min TTL) |                             | - Impact Analytics Chart  |
+------------------------------+-----------------------------+---------------------------+
                                              | Mongoose ODM
                                              v
                               +-----------------------------+
                               |       MongoDB Database      |
                               |   users, articles, comments |
                               |   sessions, view_analytics |
                               +-----------------------------+
```

### Subsystem Overview:
1. **Core Platform & Identity (Track 1 - Eldar)**: Express MVC foundation, User model, Bcrypt security, Mongo session persistence, RBAC guards, User management CRUD, and server-cached weather infrastructure.
2. **Newsfeed Engine & Discovery (Track 2 - Segev)**: Public newsfeed SSR and Vanilla AJAX feed engine (infinite scroll, live debounced search, multi-category filtering).
3. **Engagement & Moderation (Track 3 - Ofir)**: Full article SSR view, interactive comment tree, and IP rate limiting (max 3 comments/min, HTTP 429).
4. **Editorial & Publishing Lifecycle (Track 4 - Hodara)**: Dual-version revision workflow, reporter real-time autosave studio, side-by-side diff viewer, and time-series impact analytics.

---

## Authentication, RBAC & Security

### Role-Based Access Control (RBAC) Matrix:
| Endpoint / Resource | Guest | Reporter | Editor |
|---|:---:|:---:|:---:|
| `GET /` (Newsfeed) | Allowed | Allowed | Allowed |
| `GET /api/weather` | Allowed | Allowed | Allowed |
| `POST /api/auth/login` | Allowed | Allowed | Allowed |
| `POST /api/auth/logout` | Denied (401) | Allowed | Allowed |
| `GET /api/auth/me` | Denied (401) | Allowed | Allowed |
| `GET /workspace` (Reporter Studio) | Redirect (302) | Allowed | Redirect (302) |
| `GET /editor` (Editor Hub) | Redirect (302) | Denied (403) | Allowed |
| `GET /api/users` (User Management) | Denied (401) | Denied (403) | Allowed |
| `POST /api/users` (Create User) | Denied (401) | Denied (403) | Allowed |
| `PUT /api/users/:id` (Update User) | Denied (401) | Denied (403) | Allowed |
| `DELETE /api/users/:id` (Delete User) | Denied (401) | Denied (403) | Allowed |

### Security Guarantees:
- **Password Hashing**: Passwords hashed with `bcrypt` (12 salt rounds) via Mongoose `pre('save')` hooks. Plaintext passwords are never stored.
- **Session Durability**: Sessions are persisted in the MongoDB `sessions` collection via `connect-mongo` with a 14-day TTL. Restarting the server never invalidates active user sessions.
- **Role Enforcement**: Every privileged route is protected server-side with `middlewares/auth.js` and `middlewares/rbac.js`.
- **Safe Object Serialization**: Outbound user models serialize via `toSafeObject()`, ensuring password hashes are excluded from responses.

---

## Weather Service Architecture

The weather component displays live conditions while operating under a strict 15-minute server-side caching policy:

- **In-Memory Cache TTL**: 15 minutes (`15 * 60 * 1000` ms).
- **Behavior**: External API is queried only once every 15 minutes. Subsequent client requests are served instantly from cache (`cached: true`).
- **Resilience**: In offline environments or when an external API key is absent, the service falls back gracefully to default meteorological data, maintaining continuous system availability.

---

## Directory Structure

```text
the-daily-web/
├── .github/workflows/ci.yml       # Automated CI pipeline
├── config/
│   ├── db.js                      # Mongoose connection & lifecycle manager
│   └── session.js                 # connect-mongo persistent session configuration
├── controllers/
│   ├── authController.js          # Authentication (login, logout, session profile)
│   ├── userController.js          # Editor user administration CRUD
│   └── weatherController.js       # Weather service with 15-minute server cache
├── middlewares/
│   ├── auth.js                    # Session authentication guard
│   ├── rbac.js                    # Role-based authorization middleware
│   └── errorHandler.js            # Centralized error logging and JSON/HTML handler
├── models/
│   └── User.js                    # User schema with bcrypt hashing & role validation
├── public/
│   ├── css/
│   │   ├── variables.css          # Design tokens & color system
│   │   └── layout.css             # Pure CSS Flexbox responsive layout
│   └── js/
│       └── weather.js             # Vanilla JS weather fetcher & DOM poller
├── routes/api/
│   ├── authRoutes.js              # Authentication API routes (/api/auth)
│   ├── userRoutes.js              # User management routes (/api/users)
│   └── weatherRoutes.js           # Weather API route (/api/weather)
├── tests/
│   ├── unit/
│   │   └── auth-user.test.js      # Unit and integration test suite (100% coverage)
│   └── e2e/
│       └── auth-session.spec.js   # Playwright end-to-end browser tests
├── views/
│   ├── pages/
│   │   ├── home.ejs               # Public newsfeed view
│   │   ├── login.ejs              # Responsive authentication view
│   │   ├── workspace.ejs          # Reporter drafting studio view
│   │   ├── editor.ejs             # Editor review hub view
│   │   └── error.ejs              # Centralized error view
│   └── partials/
│       ├── header.ejs             # Semantic HTML5 head & top layout
│       ├── navbar.ejs             # Dynamic navigation bar with session state
│       ├── weather-widget.ejs     # Sidebar weather card
│       └── footer.ejs             # Semantic footer & closing tags
├── app.js                         # Express MVC application bootstrap
├── server.js                      # HTTP listener & process signal handler
├── package.json                   # Application dependencies & test scripts
└── README.md                      # Comprehensive application documentation
```

---

## Getting Started

### 1. Prerequisites
- **Node.js**: v20.x or higher
- **MongoDB**: v6.x or higher (or MongoDB Atlas)

### 2. Installation
```bash
git clone https://github.com/eldarush/the-daily-web.git
cd the-daily-web
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory:
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

# Or with nodemon for live development
npm run dev
```
Open `http://localhost:3000` in your web browser.

---

## Testing & Quality Assurance

### Unit & Integration Tests (Jest)
Executes the comprehensive test suite with `mongodb-memory-server` and strict coverage gates:
```bash
npm test
```

**Quality Metrics:**
- **Statements**: 100.0%
- **Lines**: 100.0%
- **Functions**: 100.0%
- **Branches**: 100.0%
- **Passing Tests**: 100% pass rate

### End-to-End Browser Tests (Playwright)
```bash
npx playwright test
```
Validates real browser scenarios:
- Authentication flow with credential verification.
- Redirection to role-specific views (`/workspace` vs. `/editor`).
- Session persistence across browser reloads.
- Sidebar weather widget loading.
- Clean session invalidation upon sign-out.
