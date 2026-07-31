# Prompt: Build "OfficeMeal" — Office Meal Management System

Copy everything below into Claude (or Claude Code) to start building the app.

---

## 1. Project Summary

Build a cross-platform application called **OfficeMeal** that manages daily office lunch/meal ordering, tracks who is eating, tallies totals for the admin to place bulk orders, tracks each employee's payments and dues, and requires admin approval for order cancellations.

The app must run as:
- A **mobile app** (Android + iOS) via **Tauri v2** (mobile support)
- A **desktop app** via Tauri (Windows/macOS/Linux)
- A **web app** (same frontend, deployed as a normal website)

**Frontend:** SvelteKit (single codebase shared across Tauri and web targets)
**Backend:** REST (or tRPC) API server with **PostgreSQL** database
**CI/CD:** GitHub Actions — on push to `main`, automatically build and release the Tauri apps (and deploy the web build)

---

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Frontend framework | SvelteKit (TypeScript) |
| Cross-platform shell | Tauri v2 (desktop + mobile) |
| Styling | Tailwind CSS |
| Charts | Chart.js or Layerchart (Svelte-native) |
| Backend | Node.js (Fastify or Express) or Rust (Axum) — pick one and justify |
| Database | PostgreSQL |
| ORM | Drizzle ORM or Prisma |
| Auth | JWT-based session auth, per-user login |
| CI/CD | GitHub Actions + `tauri-apps/tauri-action` for auto-release |
| Hosting (web + API) | Any Docker-friendly host (mention options, don't hardcode) |

---

## 3. User Roles

1. **Employee (regular user)**
   - Logs in with their own account
   - Can only see **their own** data (their meal entries, their dues/payments, their cancel requests)
   - Marks daily: "eating today" / "not eating today" (before a daily cutoff time)
   - Can request cancellation of an already-confirmed meal entry — this does **not** cancel it immediately, it creates a **pending cancel request**

2. **Admin**
   - Sees **everyone's** entries and data
   - Sets/updates the **meal rate** (price per meal), which can change over time (keep history, don't overwrite past rates used in past calculations)
   - Sees the daily tally (total number of people eating today) to place the actual food order
   - Approves or rejects employee **cancel requests** — a meal entry is only cancelled after admin approval
   - Records/adjusts payments made by each employee, and sees who owes how much (dues)
   - Views charts/reports (e.g., meals per day/week/month, dues outstanding, revenue collected)

---

## 4. Core Features (Detailed)

### 4.1 Authentication
- Each employee has their own login (username/email + password)
- JWT-based sessions, refresh token support
- Role field: `employee` or `admin`
- Row-level access control: employees can only query/mutate their own records; admin endpoints check role

### 4.2 Daily Meal Entry
- Each day, an employee marks whether they will eat (`YES`) or not (`NO`) — a simple toggle/entry per date
- Optional: a daily cutoff time (e.g., 10:00 AM) after which entries lock for that day (configurable by admin)
- One entry per user per date (unique constraint)
- Employees can see their own history of past entries

### 4.3 Meal Rate Management
- Admin sets the **current meal rate** (amount per meal, e.g., in BDT)
- Keep a **rate history table** with `effective_from` date, so past calculations always use the rate that was active on that date, even if the rate later changes
- Admin can update rate anytime (creates a new rate record, doesn't edit old ones)

### 4.4 Admin Tally / Order View
- Dashboard showing: how many people marked "eating today" (and the list of names)
- Filter/view by date
- This is what the admin uses to decide how much food to order

### 4.5 Payment & Due Tracking
- Each employee accumulates a running balance: `total owed = (number of confirmed meals × applicable rate for each date) - total paid`
- Admin can record a payment made by an employee (amount, date, optional note)
- Employee can see: total eaten, total cost, total paid, current due (or credit if overpaid)
- Admin can see this breakdown for **all** employees, sortable/filterable (e.g., show everyone with outstanding dues)

### 4.6 Cancellation Request Workflow (important business rule)
- An employee **cannot directly cancel** a confirmed meal entry themselves
- Instead, they submit a **cancel request** (with optional reason) for a specific date's entry
- This request appears in the admin's queue as `PENDING`
- Admin reviews and either **Approves** or **Rejects**
  - If approved → the underlying meal entry is marked `CANCELLED`, and it's excluded from the cost calculation
  - If rejected → the meal entry stays as-is, request marked `REJECTED`
- Employee can see the status of their own cancel requests (`PENDING` / `APPROVED` / `REJECTED`)

### 4.7 Charts & Reports
- Charts library integrated in the dashboard, e.g.:
  - Line/bar chart: number of meals per day over the last N days (admin view)
  - Bar chart: outstanding dues per employee (admin view)
  - Pie/donut: paid vs due, for an individual employee (employee view)
- Charts should work well on both mobile and web layouts

### 4.8 Notifications (optional, nice-to-have — mention as future scope)
- Push/local notification reminding employees to mark today's meal before cutoff
- Notify employee when their cancel request is approved/rejected

---

## 5. Suggested Database Schema (PostgreSQL)

```sql
-- users
users (
  id UUID PK,
  name TEXT,
  email TEXT UNIQUE,
  password_hash TEXT,
  role TEXT CHECK (role IN ('employee','admin')),
  created_at TIMESTAMPTZ DEFAULT now()
)

-- meal_rates (history-preserving)
meal_rates (
  id UUID PK,
  rate NUMERIC(10,2),
  effective_from DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
)

-- meal_entries
meal_entries (
  id UUID PK,
  user_id UUID REFERENCES users(id),
  entry_date DATE,
  status TEXT CHECK (status IN ('CONFIRMED','CANCELLED')) DEFAULT 'CONFIRMED',
  rate_applied NUMERIC(10,2), -- snapshot of the rate on that date
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, entry_date)
)

-- cancel_requests
cancel_requests (
  id UUID PK,
  meal_entry_id UUID REFERENCES meal_entries(id),
  requested_by UUID REFERENCES users(id),
  reason TEXT,
  status TEXT CHECK (status IN ('PENDING','APPROVED','REJECTED')) DEFAULT 'PENDING',
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
)

-- payments
payments (
  id UUID PK,
  user_id UUID REFERENCES users(id),
  amount NUMERIC(10,2),
  note TEXT,
  recorded_by UUID REFERENCES users(id), -- admin
  paid_at TIMESTAMPTZ DEFAULT now()
)
```

A `user_balance` view/materialized view can compute: `sum(rate_applied where status='CONFIRMED') - sum(payments.amount)` per user.

---

## 6. API Endpoints (example, adjust to chosen backend framework)

**Auth**
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`

**Employee**
- `GET /me` — profile
- `GET /me/entries` — my meal history
- `POST /me/entries` — mark today's entry (YES/NO)
- `GET /me/balance` — my due/paid summary
- `POST /me/entries/:id/cancel-request` — submit cancel request

**Admin**
- `GET /admin/entries?date=YYYY-MM-DD` — daily tally + list
- `GET /admin/users` — all employees + their balances
- `POST /admin/rate` — set new meal rate
- `GET /admin/rate/history`
- `POST /admin/payments` — record a payment for a user
- `GET /admin/cancel-requests?status=PENDING`
- `POST /admin/cancel-requests/:id/approve`
- `POST /admin/cancel-requests/:id/reject`
- `GET /admin/reports/meals-per-day`
- `GET /admin/reports/dues`

---

## 7. Frontend Structure (SvelteKit)

```
src/
  routes/
    login/
    (employee)/
      dashboard/        -> today's status, mark eating, my balance chart
      history/           -> my past entries
      cancel-requests/   -> my requests + status
    (admin)/
      dashboard/         -> today's tally, quick stats, charts
      users/             -> all employees, balances, record payment
      rate/              -> set/view rate history
      cancel-requests/   -> approve/reject queue
      reports/           -> charts (meals/day, dues)
  lib/
    api/                 -> typed API client
    stores/              -> auth store, user store
    components/          -> shared UI (Chart wrappers, Table, Modal, etc.)
src-tauri/                -> Tauri config for desktop + mobile builds
```

Use the same SvelteKit build for:
- **Web**: standard `adapter-static` or `adapter-node` deployment
- **Tauri**: wraps the same frontend into desktop/mobile binaries, talking to the same backend API over HTTPS

---

## 8. CI/CD (GitHub Actions)

Set up `.github/workflows/release.yml` that, on push to `main` (or on tag push):
1. Installs dependencies, builds the SvelteKit frontend
2. Uses `tauri-apps/tauri-action` to build Tauri artifacts for:
   - Windows, macOS, Linux (desktop)
   - Android (and iOS if a macOS runner + signing is set up)
3. Creates a GitHub Release and uploads the built binaries/installers automatically
4. Optionally, a separate workflow deploys the web build (e.g., to a static host or container registry) and runs DB migrations against Postgres

Ask Claude to scaffold this workflow file using the official `tauri-action`, including caching for Rust/Cargo and Node dependencies to speed up builds.

---

## 9. Non-Functional Requirements
- Mobile-first responsive UI (also usable comfortably on web/desktop)
- Bangla + English UI text support would be a plus (mention if wanted)
- Proper input validation and error handling on both frontend and backend
- Database migrations managed via the chosen ORM's migration tool
- Environment-based config (`.env`) for DB connection, JWT secret, API base URL
- Basic seed script to create an initial admin account

---

## 10. What to Ask Claude to Do First

1. Propose the final backend framework choice (Node/Fastify vs Rust/Axum) with a short rationale
2. Scaffold the monorepo structure (frontend + backend + Tauri config)
3. Set up the Postgres schema + migrations from Section 5
4. Build auth (login, JWT, role-based guards)
5. Build employee meal-entry flow end-to-end
6. Build admin tally + rate management
7. Build payment/due tracking + balance view
8. Build the cancel-request approval workflow
9. Add charts to both dashboards
10. Set up the GitHub Actions release pipeline

---

*End of prompt.*
