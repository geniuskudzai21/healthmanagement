# HealthFlow

Clinic flow management system: patient register, visits, check-in, live queue,
appointments, room routing, billing and reporting — with role-based access for
front desk, nursing, clinical and admin staff.

Stack: Node.js + Express (layered) + `pg` + Postgres (Neon or embedded PGlite
for local dev), JWT auth in an httpOnly cookie (bcrypt hashing), static
vanilla-JS SPA frontend. Deployable to Render (API) + Vercel (frontend).

Out of scope: pharmacy, lab, stock/inventory, payment-gateway integration.
Billing only shows what a patient owes (invoices and balances); payments are
recorded manually at the front desk — the system does **not** integrate with
payment systems such as EcoCash.

---

## Table of contents

1. [What the system does](#what-the-system-does)
2. [Quick start (run it locally)](#quick-start-run-it-locally)
3. [Demo accounts & data](#demo-accounts--data)
4. [Using the system — screen by screen](#using-the-system--screen-by-screen)
5. [Roles & permissions](#roles--permissions)
6. [How the pieces fit together](#how-the-pieces-fit-together)
7. [API reference](#api-reference)
8. [Authentication & security](#authentication--security)
9. [Configuration (.env)](#configuration-env)
10. [Deploy](#deploy)
11. [Project structure](#project-structure)

---

## What the system does

HealthFlow runs the flow of a small outpatient clinic on a single day:

- **Patient register** — every patient gets an MRN (medical record number).
  Search, register, view history.
- **Check-in** — front desk checks in an existing or brand-new patient,
  chooses queue area (General / Vitals / Consultation), visit type
  (walk-in / appointment / follow-up) and triage level (1 = most urgent).
  One transaction creates the patient (if new), opens a **visit** and prints a
  **queue ticket**.
- **Live queue** — staff see everyone waiting in real time with elapsed wait
  times. "Call next" marks the highest-priority longest-waiting patient, and
  **Assign room** routes them to a free room of the chosen type. Completing or
  cancelling an entry closes the visit and frees the room.
- **Rooms** — a register of consultation, triage and procedure rooms with live
  status (available / occupied / maintenance / reserved). Admins add and remove
  rooms; nurses and clinicians can free a room. The dashboard shows how many are
  free right now, and "call next" auto-routes patients into a free room of the
  right type.
- **Appointments** — schedule patients with a clinician in a room. Double
  booking is impossible: overlapping slots for the same clinician or room are
  rejected with 409. Checking in an appointment opens a visit and adds the
  patient to the live queue; completing, cancelling or marking no-show keeps the
  linked visit and ticket in sync.
- **Billing** — service catalogue with prices, invoices with line items, and
  manual payment records so the desk can see **how much a patient still owes**.
  Invoice lifecycle `draft → issued → partially_paid → paid` (or `void`),
  running balances and a billing summary. This is purely a record of what was
  charged and what was handed over at the desk — no integration with payment
  systems (EcoCash, cards, banks, etc.).
- **Reports** — daily and monthly operational reports: visits, appointments,
  queue waits (avg / median / longest), hourly load, per-clinician activity,
  room utilisation and billing totals (invoiced / paid / outstanding).
- **Audit trail** — every write and every login is recorded with actor + IP.

---

## Quick start (run it locally)

### Option A — no database install (embedded Postgres, dev only)

```bash
cd backend
npm install
copy .env.example .env     # then set DB_DRIVER=pglite
npm run setup              # migrate + seed against ./backend/.pglite
npm run dev                # API on http://localhost:4000
```

With `DB_DRIVER=pglite` the API runs an embedded, file-backed Postgres (via
`@electric-sql/pglite`) stored in `backend/.pglite/` — no Neon or local
Postgres needed. Delete the `.pglite/` folder to reset. Remove `DB_DRIVER`
and set `DATABASE_URL` to use a real Postgres instead.

### Option B — your own Postgres / Neon

```bash
cd backend
npm install
copy .env.example .env     # set DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD
npm run migrate            # applies src/db/migrations/*.sql
npm run seed               # admin + demo staff + catalogue + patients
npm run dev                # API on http://localhost:4000
```

### Frontend

From the `healthflow/` root, start the bundled static server (correct MIME
types for ES modules, zero dependencies):

```bash
node serve-frontend.js     # http://localhost:5500
```

Open http://localhost:5500 and sign in with a demo account (below). Any static
server works too (`npx serve frontend`, VS Code Live Server,
`python -m http.server`); the SPA uses **hash routing**, so no server rewrites
are needed. Keep the frontend's origin in the API's `CORS_ORIGIN` (the dev
`.env` already allows `http://localhost:5500`).

### Pointing the frontend at the API

The API base URL is resolved in this order:

1. `localStorage.hf_api_base` (handy for switching environments at runtime)
2. `window.HEALTHFLOW_API` (set in `frontend/index.html`)
3. `http://localhost:4000` (local default)

The session lives in the `hf_token` httpOnly cookie, so the browser sends it
automatically (`credentials: 'include'`).

---

## Demo accounts & data

`npm run seed` is idempotent and creates:

| Account | Role | Email |
|---|---|---|
| HealthFlow Admin | admin | `admin@healthflow.local` |
| Rita Wanjiru | reception | `rita@healthflow.local` |
| Nurse Peter Mwangi | nurse | `peter@healthflow.local` |
| Dr. Sarah Adhiambo | clinician | `sarah@healthflow.local` |
| Dr. James Kiprono | clinician | `james@healthflow.local` |

Password for all: `ChangeMe123!` (override with `SEED_PASSWORD` / set
`ADMIN_PASSWORD` before seeding; **change it in production**).

Also seeded:

- **10 demo patients** — MRN1001–MRN1010 with names, DOBs, phones, emails.
- **8 service items** — consultation (KES 1,500), vitals (500), drug
  dispensing (2,500), injection (1,500), dressing (800), lab generic (2,500),
  X-ray (3,500), consultation-room charge (500).
- **6 demo rooms** — Vitals 1, Consultation 1–3, Procedure room and a Waiting
  bay (all `available` to start).

---

## Using the system — screen by screen

Sign in at the login screen. The left sidebar shows only the screens your role
may access; the dashboard is the landing page.

### Dashboard

The "at a glance" screen for the whole clinic:

- **Today** stat cards — patients today (open vs total), in queue vs called,
  average wait, appointments scheduled, completed, seen, longest current wait,
  rooms available right now.
- **Live queue** — the active waiting list with status and elapsed times.
- **Today's appointments** — upcoming schedule with statuses.

Everything refreshes live as staff act on other screens.

### Patients

- **Search** the register by name, MRN or phone; filter active/inactive.
- **Register patient** — full demographics (MRN auto-suggested, name, DOB,
  sex, phone, email, address, next-of-kin, notes).
- **Open a patient** to see details and their visit history.

Reception and admin can write; everyone else can read.

### Check-in (reception / nurse / admin)

Two steps on one screen:

1. **Who is being seen?** — search an existing patient, or switch to the
   *New patient* tab and enter minimal details (MRN, DOB, name, sex, phone).
2. **Visit details** — queue area (General / Vitals / Consultation), visit
   type (walk-in / appointment / follow-up), triage level 1–5, chief
   complaint.

On success you get a **queue ticket** with the ticket number and area, plus
buttons to check in the next patient or jump to the queue.

### Queue (everyone)

The live operations board:

- Filter by area (All / General / Vitals / Consultation).
- Stat chips: waiting, called, done, average / median / longest wait.
- Each row: ticket, patient, triage badge, area, wait time, status.
- Role actions per row (nurse / clinician / admin):
  - **Call** a waiting patient (or **Call next** — pulls the highest-triage,
    longest-waiting patient, safe under concurrency).
  - **Assign room** — routes the visit to a free room of the chosen type
    (`FOR UPDATE SKIP LOCKED`); errors clearly if none are free.
  - **Done** — completes the visit and frees its room.
  - **Cancel** — drops the entry from the queue.
- Status flow: waiting → called → done.

### Rooms (everyone)

Where to see whether rooms are available:

- Stat chips: available / occupied / maintenance / total.
- Table of every room with code, name, type, floor and a live status badge.
- Actions: **Set available** (nurse / clinician / admin — frees an occupied or
  maintenance room), **Edit** and **Delete** (admin), and **New room** (admin)
  to add one.

If it says "no rooms available", the `rooms` table is empty — an admin adds
rooms here (or re-run `npm run seed` to load the demo rooms).

### Appointments

- Filter by day and status; **New appointment** picks patient, clinician,
  room, start/end time, reason and notes.
- Overlap protection: the same clinician or the same room cannot be booked
  twice for overlapping times (API returns 409 with a clear message).
- Row actions: **Check in** (opens a visit and adds the patient to the live
  queue), **Complete**, **No show**, **Cancel**, **Delete**. Checking in again,
  or completing/cancelling, keeps the linked visit and queue ticket in sync.

Reception and admin create/edit; nurses and clinicians can update statuses
from the queue workflow.

### Billing (reception / clinician read / admin)

Purpose: show **how much a patient needs to pay**. There is no payment-gateway
integration — nothing here talks to EcoCash, card terminals or banks. A
"payment" is just a manual note by the desk that money was handed over.

**How a bill is calculated** (always recomputed in SQL, so nothing can drift):

- Each line stores `line_total = quantity × unit_price`.
- `subtotal = Σ line_total`.
- `total = max(subtotal − discount_amount, 0) × (1 + tax_rate / 100)`.
- `paid_total = Σ amount` of non-void payments.
- `balance_due = max(total − paid_total, 0)`.
- Status follows the money: `0 paid → issued`, `paid ≥ total → paid`,
  otherwise `partially_paid`.

Three tabs:

- **Invoices** — list with invoice number, patient, status badge, total,
  paid, balance and creation date. **New invoice** picks a patient (+ optional
  discount/tax), then **Open** shows the detail: add / edit / remove line
  items (pick a catalogue service or enter a custom line), see the running
  subtotal, discount, tax, total, paid and balance, then **Issue invoice**,
  **Record payment**, **Void** and **Delete** (draft, admin).
- **Payments** — manual records of money received, with invoice number,
  amount, method label (cash / card / insurance / bank transfer / mobile
  money / other), reference, who took it and when. Admin can void a record
  (the balance and status are recalculated).
- **Service catalogue** — the priced services used as invoice line items
  (code, name, category, price, active). Admin can create and edit items.

Invoice lifecycle: `draft → issued → partially_paid → paid` (payments push it
along; `void` is terminal). Only draft invoices can be edited or deleted;
issued/paid invoices are locked and admin can void them (only when no money is
recorded against them).


### Reports (admin / clinician)

- **Daily** (`?date=`) — visits by status and type, appointments, queue waits
  (avg/median/longest), hourly arrival load, per-clinician breakdown, room
  utilisation, billing totals (invoiced / paid / outstanding).
- **Monthly** (`?month=`) — month totals, per-day table, per-clinician,
  visit types and the same billing block.

### Admin screens

- **Users** — create staff accounts, change roles, deactivate (soft delete).
  Password changes invalidate older sessions.
- **Audit** — every write and login, filterable by entity, actor and action
  (create / update / delete / void / login).

---

## Roles & permissions

| Area | reception | nurse | clinician | admin |
|---|---|---|---|---|
| Patients read | yes | yes | yes | yes |
| Patients write | yes | – | – | yes |
| Check-in / queue enqueue | yes | yes | – | yes |
| Visit status, call next, room routing | – | yes | yes | yes |
| Appointments create/edit | yes | – | – | yes |
| Billing (invoices, payments) | yes | – | read-only | yes |
| Service catalogue | – | – | read-only | yes |
| Rooms create/delete | – | – | – | yes |
| Users, audit, reports | – | – | reports | yes |

Enforced twice: the API checks roles on every route (`requireRole`), and the
frontend hides navigation and actions the role cannot use.

---

## How the pieces fit together

```
Browser (SPA, hash routes)
   │  fetch, credentials: include  →  hf_token httpOnly cookie
   ▼
Express API  /api/*
   │  middleware: helmet → CORS → rate limits → cookie/JWT → validate
   ▼
Controllers (HTTP shape)  →  Services (business rules + SQL, transactions)
   ▼
Postgres (Neon in prod, PGlite embedded in dev)
```

- **Routes** define paths and role guards; **controllers** validate and shape
  requests/responses; **services** own all SQL and transactions. Errors are
  uniform: `{ "error": { "message": "...", "details": {...}? } }`
  (400 with `details.fields`, 401, 403, 404, 409, 429, 500).
- **Migrations** are checksummed SQL files applied in one transaction and
  recorded in `schema_migrations` (`npm run migrate`). Schema highlights:
  `users`, `patients`, `visits`, `queue_entries`, `rooms`, `appointments`,
  `service_items`, `invoices`, `invoice_lines`, `payments`, `audit_logs`.
- **Queue concurrency**: room pickup uses `FOR UPDATE SKIP LOCKED` and ticket
  numbers are serialised with an advisory lock, so parallel staff never
  double-assign a room or duplicate a ticket.
- **Frontend** is a tiny SPA toolkit (`ui.js` tagged templates with escaping,
  hash `router.js`, `api.js` wrapper with 401 handling) and one file per
  screen in `js/views/`.

---

## API reference

All routes under `/api`, auth required unless noted.

| Method & path | Notes |
|---|---|
| `GET /health`, `GET /ready` | Public liveness / DB readiness probes |
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/password` | Session |
| `GET/POST /patients`, `GET/PATCH/DELETE /patients/:id`, `GET /patients/stats` | `?q=&active=&limit=&offset=`; stats = total/active/inactive counts |
| `POST /check-in` | Find-or-create patient + open visit + queue entry in one transaction |
| `GET/POST /visits`, `GET /visits/:id`, `PATCH /visits/:id/status`, `PATCH /visits/:id/assign`, `DELETE /visits/:id` | |
| `GET /queue`, `GET /queue/summary` | Live queue with `wait_seconds`, `in_queue_seconds`, `service_seconds`; summary has avg/median/longest wait |
| `POST /queue/enqueue`, `POST /queue/call-next`, `PATCH /queue/:id/status` | `done` completes the visit and frees its room |
| `GET /rooms`, `GET /rooms/available`, `POST /rooms/route`, `POST /rooms/:id/release` | Auto-routing picks a free room of the requested type |
| `GET/POST /appointments`, `PATCH /appointments/:id`, `PATCH /appointments/:id/status` | Unique clinician/room slot + overlap check → 409; `status: checked_in` opens a visit and enqueues a ticket |
| `GET /billing/service-items`, `POST/PATCH /billing/service-items/:id` | Billing catalogue (admin for write) |
| `GET/POST/PATCH/DELETE /billing/invoices`, `/billing/invoices/:id`, `/billing/invoices/:id/lines`, `/billing/invoices/:id/issue`, `/billing/invoices/:id/void` | Draft-only mutables; issue/void constraints |
| `GET/POST /billing/payments`, `POST /billing/payments/:paymentId/void`, `GET /billing/summary` | Payment tracking and period summary |
| `GET /reports/daily?date=YYYY-MM-DD` | Visits, appointments, queue waits, hourly load, per-clinician, room utilisation, billing |
| `GET /reports/monthly?month=YYYY-MM` | Month totals, per-day breakdown, per-clinician, visit types, billing |
| `GET /users`, `GET/POST/PATCH/DELETE /users/:id` | Admin only (DELETE = deactivate) |
| `GET /clinicians` | Active clinician directory for any authenticated user |
| `GET /audit` | Admin only; `?entity=&actor_id=&action=` |

Example — log in with curl and call the API with the cookie:

```bash
curl -i -c cookies.txt -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@healthflow.local","password":"ChangeMe123!"}'

curl -b cookies.txt http://localhost:4000/api/queue
```

---

## Authentication & security

- `POST /api/auth/login` verifies the bcrypt hash and sets a signed JWT in the
  `hf_token` httpOnly cookie (`SameSite=Lax`, `Secure` when
  `COOKIE_SECURE=true`). A `Bearer` token is also accepted (scripts/tests).
- Changing a password invalidates tokens issued before the change
  (`users.password_changed_at`).
- Login is rate limited separately (`AUTH_RATE_LIMIT_MAX`, default 20/15 min);
  a global limit covers everything else.
- `helmet`, configurable CORS with credentials (`CORS_ORIGIN`, comma
  separated), body-size cap, `trust proxy` behind Render's TLS terminator.
- All input validated by a schema validator (`src/middleware/validate.js`).
- Every write and login lands in `audit_logs` with actor + IP.

---

## Configuration (.env)

See `backend/.env.example`. The important keys:

| Key | Meaning |
|---|---|
| `PORT` | API port (default 4000) |
| `DATABASE_URL` | Postgres connection string (Neon: add `?sslmode=require`) |
| `DB_DRIVER=pglite` | Use embedded Postgres in `backend/.pglite/` instead (dev only) |
| `JWT_SECRET` | Long random string; required in production |
| `JWT_EXPIRES_IN` | Token lifetime (default `8h`) |
| `COOKIE_SECURE` | `true` in production (HTTPS only) |
| `CORS_ORIGIN` | Comma-separated allowed frontend origins |
| `RATE_LIMIT_*`, `AUTH_RATE_LIMIT_MAX` | Throttling |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Seed admin account |
| `SEED_PASSWORD` | Password for the demo staff accounts |

---

## Deploy

### API on Render

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select the repo (uses `render.yaml`).
3. When prompted, set `DATABASE_URL` (Neon, `?sslmode=require`),
   `ADMIN_PASSWORD` (strong) and `CORS_ORIGIN` (your frontend URL).
4. Deploy. Build runs `npm ci && npm run migrate && npm run seed`
   (idempotent), then `npm start`. Health check: `/api/health`.

### Frontend on Vercel

1. Vercel → **Add New → Project** → import the repo.
2. Root Directory: `frontend`; Framework Preset: *Other* (static, no build).
3. Set `window.HEALTHFLOW_API` in `frontend/index.html` to your Render API
   URL, and keep the API's `CORS_ORIGIN` in sync with the Vercel URL.

---

## Project structure

```
healthflow/
├── backend/
│   ├── src/
│   │   ├── config/          db pool, jwt/cookie config
│   │   ├── middleware/      auth (JWT + roles), validation, logger, 404, errors
│   │   ├── routes/          route definitions + role guards
│   │   ├── controllers/     request/response handling
│   │   ├── services/        business logic + SQL
│   │   ├── utils/           ApiError, bcrypt, validation helpers, cookies
│   │   ├── db/
│   │   │   ├── migrations/  001_init.sql, 002_auth.sql, 003_billing.sql
│   │   │   ├── migrate.js   checksummed, transactional migration runner
│   │   │   └── seed.js      admin, demo staff, patients, service catalogue
│   │   ├── app.js
│   │   └── server.js
│   ├── scripts/check.js     syntax-check every source file
│   └── .env.example
├── frontend/                static SPA (vanilla JS ES modules, hash router)
│   ├── index.html           app shell
│   ├── css/styles.css       design system (teal/blue, light)
│   ├── js/                  config, api, auth, ui, router, components, icons, app
│   │   └── views/           login, dashboard, patients, check-in, queue,
│   │                        appointments, billing, reports, notFound
│   └── vercel.json          Vercel static config
├── render.yaml              Render Blueprint (API + static site)
├── serve-frontend.js        zero-dependency static server for local dev
└── README.md
```

## Scripts (backend)

| Command | Purpose |
|---|---|
| `npm run setup` | migrate + seed in one step |
| `npm run migrate` | Apply pending migrations |
| `npm run seed` | Upsert admin, demo staff, patients, service catalogue |
| `npm run dev` | Server with auto-reload |
| `npm run start` | Production server |
| `npm run check` | Syntax-check every source file |
