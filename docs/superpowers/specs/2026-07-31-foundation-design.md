# OfficeMeal — Sub-project 1: Foundation (schema + auth + scaffold)

Source spec: `office-meal-app-prompt.md`. Full app scope split into sub-projects (see §Decomposition). This doc covers sub-project 1 only.

## Decomposition

1. **Foundation** (this doc) — DB schema, RLS, auth, admin-create-employee, monorepo + Tauri/web scaffold
2. Employee flow — daily meal entry, history, cancel request, balance view
3. Admin flow — tally, rate management, payments, cancel approval queue, reports
4. Charts on both dashboards
5. CI/CD release pipeline (GitHub Actions + tauri-action)

## Decisions

- **Backend: Supabase** (hosted Postgres + auto REST/client SDK + Auth), not a custom Node/Rust server. Client talks to Supabase directly.
- **One privileged exception:** Supabase Edge Function `admin-create-employee` holds the service-role key server-side (never shipped to client) to let admin provision employee accounts (no public self-signup).
- **Frontend build:** SvelteKit `adapter-static` (full SPA) — one build feeds web hosting, Tauri desktop, Tauri mobile.
- **Access control boundary: Postgres RLS**, since client hits DB directly — this is the real backend boundary, not app code.
- **Schema migrations:** plain SQL via Supabase CLI, no ORM (Supabase already gives typed client + migrations).
- **Account creation:** admin-created only, no public signup.
- **Daily cutoff time:** out of scope for v1 (deferred to sub-project 2).
- **i18n (Bangla+English):** out of scope for v1, mentioned in source prompt as optional plus.

## Data model

```sql
profiles (extends auth.users)
  id UUID PK REFERENCES auth.users(id)
  name TEXT
  role TEXT CHECK (role IN ('employee','admin'))
  created_at TIMESTAMPTZ DEFAULT now()

meal_rates
  id UUID PK, rate NUMERIC(10,2), effective_from DATE,
  created_by UUID REFERENCES profiles(id), created_at TIMESTAMPTZ DEFAULT now()

meal_entries
  id UUID PK, user_id UUID REFERENCES profiles(id), entry_date DATE,
  status TEXT CHECK (status IN ('CONFIRMED','CANCELLED')) DEFAULT 'CONFIRMED',
  rate_applied NUMERIC(10,2), created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, entry_date)

cancel_requests
  id UUID PK, meal_entry_id UUID REFERENCES meal_entries(id),
  requested_by UUID REFERENCES profiles(id), reason TEXT,
  status TEXT CHECK (status IN ('PENDING','APPROVED','REJECTED')) DEFAULT 'PENDING',
  reviewed_by UUID REFERENCES profiles(id), reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()

payments
  id UUID PK, user_id UUID REFERENCES profiles(id), amount NUMERIC(10,2),
  note TEXT, recorded_by UUID REFERENCES profiles(id), paid_at TIMESTAMPTZ DEFAULT now()
```

No standalone `users` table — Supabase `auth.users` owns login credentials; `profiles` adds role+name only.

## RLS policies

- `is_admin()` SQL helper: `exists (select 1 from profiles where id = auth.uid() and role = 'admin')`. Used across all policies instead of repeating the subquery.
- `profiles`: employee select own row; admin select all. Update: admin only.
- `meal_rates`: all authed users select; insert/update admin only.
- `meal_entries`: employee select/insert own rows (`user_id = auth.uid()`); no direct employee update (status changes only via approved cancel-request path — enforced in sub-project 2/3). Admin select all.
- `cancel_requests`: employee insert/select own; admin select/update all.
- `payments`: employee select own (read-only); admin insert/select all.

## Auth flow

- Login: Supabase Auth email/password. Session held client-side via Supabase JS SDK (static SPA, no server session).
- Admin creates employee: SvelteKit admin UI calls `admin-create-employee` edge function with admin's JWT → function verifies `role=admin` claim → creates `auth.users` row + `profiles` row using service-role key.

## Scaffold layout

```
meal-flow/
  src/               -> SvelteKit app (routes, lib/api, lib/stores)
  src-tauri/         -> Tauri v2 config (desktop + mobile targets)
  supabase/
    migrations/      -> SQL schema + RLS
    functions/
      admin-create-employee/
```

- Env: `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` in `.env` (safe client-side). Service-role key lives only in Supabase's edge function secret store — never in repo or client `.env`.

## Out of scope (this sub-project)

Meal entry UI, tally dashboard, rate management UI, payment recording, cancel-request UI/approval, charts, CI/CD pipeline. These land in sub-projects 2–5.

## Verification

- Log in as admin, log in as employee (created via edge function).
- Employee querying another user's `meal_entries` row returns empty (RLS proof).
- Employee cannot write own `role` column.
- Tauri desktop dev build loads same login screen as web build.

## Working conventions (all sub-projects)

- Small, frequent commits; push incrementally rather than one large batch.
- No AI/Claude co-author trailer in any commit or PR.
- Comments: 1–2 lines max, only where the "why" isn't obvious from code.
- Favor established architecture patterns (clear module boundaries, RLS as the real access-control layer, no speculative abstraction).
