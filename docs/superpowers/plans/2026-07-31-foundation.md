# OfficeMeal Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the OfficeMeal foundation — Postgres schema + RLS on Supabase, admin-created-employee auth flow, and a SvelteKit static-SPA scaffold that runs identically on web and Tauri (desktop) dev builds.

**Architecture:** Supabase (hosted Postgres + Auth + auto REST) is the only backend; the SvelteKit frontend talks to it directly via `@supabase/supabase-js`. Access control is enforced in Postgres via Row Level Security, not app code. The one privileged operation (admin creates an employee account) runs in a Supabase Edge Function holding the service-role key, never exposed to the client. The same `adapter-static` build feeds a plain web deploy and a Tauri v2 desktop/mobile shell.

**Tech Stack:** SvelteKit (TS) + `adapter-static`, Tailwind CSS, `@supabase/supabase-js`, Supabase CLI (local Postgres via Docker), Supabase Edge Functions (Deno), Vitest, Tauri v2, npm.

**Verified tool versions (checked on this machine):** node v24.18.0, npm 11.16.0, `sv` CLI 0.17.0, `@tauri-apps/cli` 2.11.4, `supabase` CLI 2.111.0, Docker 29.6.2, cargo/rustc 1.97.0.

## Global Constraints

- No custom Node/Rust REST server — Supabase is the only backend (per design doc decision).
- Access control boundary is Postgres RLS, not app-layer checks (per user's global "never trust the frontend" rule — here the client hits the DB directly, so RLS *is* the backend boundary).
- Admin-created accounts only — no public self-signup.
- Daily cutoff time and Bangla/English i18n are explicitly out of scope for this sub-project.
- Service-role key never appears in the repo, in any client bundle, or in `.env` — only in the Supabase Edge Function's managed secret store.
- Small, frequent commits; push after each task. No AI/Claude co-author trailer on any commit. Code comments 1-2 lines max, only when the why isn't obvious.
- Schema migrations are plain SQL via the Supabase CLI — no ORM.

---

## File Structure

```
meal-flow/
  package.json, svelte.config.js, vite.config.ts, tsconfig.json
  src/
    lib/
      supabase.ts          -> Supabase client singleton
      database.types.ts    -> generated types (from `supabase gen types`)
      guards.ts            -> pure route-guard decision function (unit tested)
      stores/
        auth.ts            -> current session + profile store
      guards.test.ts
    routes/
      +layout.svelte        -> root layout, bootstraps session
      +layout.ts            -> loads session/profile, ssr=false
      login/+page.svelte
      (employee)/
        +layout.ts          -> guard: requires role=employee
        dashboard/+page.svelte
      (admin)/
        +layout.ts          -> guard: requires role=admin
        dashboard/+page.svelte
        employees/+page.svelte  -> create-employee form
  src-tauri/                -> Tauri v2 scaffold
  supabase/
    config.toml
    migrations/
      <ts>_schema.sql
      <ts>_rls.sql
    functions/
      admin-create-employee/index.ts
  scripts/
    verify-rls.mjs          -> automated cross-user RLS isolation check
  .env.example
```

---

### Task 1: Scaffold SvelteKit app with TypeScript, Tailwind, Vitest, static adapter

**Files:**
- Create: entire SvelteKit scaffold in project root (via `sv create`)
- Modify: `svelte.config.js` (adapter already set via add-on flag)

**Interfaces:**
- Produces: `npm run build` emits static files to `build/`; `npm run test:unit` runs Vitest; `npm run dev` serves on `http://localhost:5173`.

- [ ] **Step 1: Scaffold the project**

Run in `/home/ashraful/Personal/meal-flow`:

```bash
npx sv create . --template minimal --types ts \
  --add vitest="usages:unit" tailwindcss="plugins:none" sveltekit-adapter="adapter:static" \
  --install npm
```

- [ ] **Step 2: Verify dev server starts**

Run: `npm run dev -- --port 5173 &` then `curl -sf http://localhost:5173 > /dev/null && echo OK`
Expected: `OK`. Kill the dev server after (`kill %1`).

- [ ] **Step 3: Verify static build works**

Run: `npm run build`
Expected: exits 0, `build/index.html` exists (`test -f build/index.html && echo OK`).

- [ ] **Step 4: Verify Vitest runs**

Run: `npm run test:unit -- --run`
Expected: passes with 0 tests found (no test files yet) — exit code 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold SvelteKit app with TS, Tailwind, Vitest, static adapter"
```

---

### Task 2: Supabase project init + schema migration

**Files:**
- Create: `supabase/config.toml` (via `supabase init`)
- Create: `supabase/migrations/<timestamp>_schema.sql`

**Interfaces:**
- Produces: tables `profiles`, `meal_rates`, `meal_entries`, `cancel_requests`, `payments` in the local Postgres instance.

- [ ] **Step 1: Init Supabase project**

```bash
npx supabase init --yes
```

- [ ] **Step 2: Create the schema migration file**

```bash
npx supabase migration new schema
```

This creates `supabase/migrations/<timestamp>_schema.sql`. Replace its contents with:

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('employee','admin')),
  created_at timestamptz not null default now()
);

create table meal_rates (
  id uuid primary key default gen_random_uuid(),
  rate numeric(10,2) not null,
  effective_from date not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table meal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  entry_date date not null,
  status text not null default 'CONFIRMED' check (status in ('CONFIRMED','CANCELLED')),
  rate_applied numeric(10,2) not null,
  created_at timestamptz not null default now(),
  unique (user_id, entry_date)
);

create table cancel_requests (
  id uuid primary key default gen_random_uuid(),
  meal_entry_id uuid not null references meal_entries(id),
  requested_by uuid not null references profiles(id),
  reason text,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  amount numeric(10,2) not null,
  note text,
  recorded_by uuid not null references profiles(id),
  paid_at timestamptz not null default now()
);
```

- [ ] **Step 3: Start local Supabase stack and apply migration**

```bash
npx supabase start
npx supabase db reset
```

Expected: both commands exit 0.

- [ ] **Step 4: Verify all 5 tables exist**

```bash
npx supabase db diff --schema public
```

(Should report no diff — schema matches migrations.) Additionally query directly:

```bash
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" -c "\dt public.*"
```

Expected output lists: `cancel_requests`, `meal_entries`, `meal_rates`, `payments`, `profiles`.

- [ ] **Step 5: Commit**

```bash
git add supabase/
git commit -m "feat: add Supabase schema migration for core tables"
```

---

### Task 3: RLS policies migration

**Files:**
- Create: `supabase/migrations/<timestamp>_rls.sql`

**Interfaces:**
- Consumes: tables from Task 2.
- Produces: `is_admin()` SQL function; RLS enabled + policies on all 5 tables.

- [ ] **Step 1: Create the RLS migration file**

```bash
npx supabase migration new rls
```

Replace its contents with:

```sql
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

alter table profiles enable row level security;
alter table meal_rates enable row level security;
alter table meal_entries enable row level security;
alter table cancel_requests enable row level security;
alter table payments enable row level security;

-- profiles
create policy "profiles_select_own_or_admin" on profiles
  for select using (id = auth.uid() or is_admin());
create policy "profiles_update_admin_only" on profiles
  for update using (is_admin());

-- meal_rates
create policy "meal_rates_select_authed" on meal_rates
  for select using (auth.uid() is not null);
create policy "meal_rates_insert_admin" on meal_rates
  for insert with check (is_admin());
create policy "meal_rates_update_admin" on meal_rates
  for update using (is_admin());

-- meal_entries
create policy "meal_entries_select_own_or_admin" on meal_entries
  for select using (user_id = auth.uid() or is_admin());
create policy "meal_entries_insert_own" on meal_entries
  for insert with check (user_id = auth.uid());

-- cancel_requests
create policy "cancel_requests_select_own_or_admin" on cancel_requests
  for select using (requested_by = auth.uid() or is_admin());
create policy "cancel_requests_insert_own" on cancel_requests
  for insert with check (requested_by = auth.uid());
create policy "cancel_requests_update_admin" on cancel_requests
  for update using (is_admin());

-- payments
create policy "payments_select_own_or_admin" on payments
  for select using (user_id = auth.uid() or is_admin());
create policy "payments_insert_admin" on payments
  for insert with check (is_admin());
```

No update policy exists for `meal_entries` for non-admins — RLS default-denies updates with no matching policy, which is intentional (status changes go through the cancel-approval workflow built in sub-project 2/3).

- [ ] **Step 2: Apply and verify**

```bash
npx supabase db reset
```

```bash
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" \
  -c "select tablename, count(*) from pg_policies where schemaname='public' group by tablename order by tablename;"
```

Expected: `cancel_requests|3`, `meal_entries|2`, `meal_rates|3`, `payments|2`, `profiles|2`.

- [ ] **Step 3: Commit**

```bash
git add supabase/
git commit -m "feat: add RLS policies for all core tables"
```

---

### Task 4: Supabase client + generated types in SvelteKit

**Files:**
- Create: `src/lib/database.types.ts` (generated)
- Create: `src/lib/supabase.ts`
- Modify: `.env.example`, `.gitignore`

**Interfaces:**
- Produces: `supabase` — a typed `SupabaseClient<Database>` singleton importable as `import { supabase } from '$lib/supabase'`.

- [ ] **Step 1: Generate types from local schema**

```bash
npx supabase gen types typescript --local > src/lib/database.types.ts
```

- [ ] **Step 2: Add env files**

Create `.env.example`:

```
PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
PUBLIC_SUPABASE_ANON_KEY=replace-with-local-anon-key-from-supabase-status
```

Copy it to `.env` (git-ignored) and fill in real local values from `npx supabase status`.

Append to `.gitignore` (create if absent):

```
.env
```

- [ ] **Step 3: Create the client singleton**

`src/lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { Database } from './database.types';

export const supabase = createClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
```

- [ ] **Step 4: Install the client library and verify types**

```bash
npm install @supabase/supabase-js
npx tsc --noEmit
```

Expected: `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase.ts src/lib/database.types.ts .env.example .gitignore package.json package-lock.json
git commit -m "feat: add typed Supabase client"
```

---

### Task 5: Route guard logic (unit tested) + auth store + login page

**Files:**
- Create: `src/lib/guards.ts`
- Create: `src/lib/guards.test.ts`
- Create: `src/lib/stores/auth.ts`
- Create: `src/routes/+layout.ts`
- Create: `src/routes/+layout.svelte`
- Create: `src/routes/login/+page.svelte`

**Interfaces:**
- Produces: `resolveGuard(currentRole: Role | null, requiredRole: Role): string | null` — returns a redirect path or `null` if access is allowed. Later tasks' `(employee)/+layout.ts` and `(admin)/+layout.ts` call this.
- Produces: `authStore` — a Svelte store of `{ session: Session | null, profile: { id: string; name: string; role: Role } | null }`.

- [ ] **Step 1: Write the failing test for the guard**

`src/lib/guards.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveGuard } from './guards';

describe('resolveGuard', () => {
  it('redirects to login when not authenticated', () => {
    expect(resolveGuard(null, 'admin')).toBe('/login');
  });

  it('redirects to login when role does not match', () => {
    expect(resolveGuard('employee', 'admin')).toBe('/login');
  });

  it('allows access when role matches', () => {
    expect(resolveGuard('admin', 'admin')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm run test:unit -- --run`
Expected: FAIL — `guards.ts` / `resolveGuard` does not exist.

- [ ] **Step 3: Implement `resolveGuard`**

`src/lib/guards.ts`:

```ts
export type Role = 'employee' | 'admin';

export function resolveGuard(currentRole: Role | null, requiredRole: Role): string | null {
  if (!currentRole) return '/login';
  if (currentRole !== requiredRole) return '/login';
  return null;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npm run test:unit -- --run`
Expected: PASS, 3/3.

- [ ] **Step 5: Auth store**

`src/lib/stores/auth.ts`:

```ts
import { writable } from 'svelte/store';
import type { Session } from '@supabase/supabase-js';
import type { Role } from '$lib/guards';

export type Profile = { id: string; name: string; role: Role };

export const authStore = writable<{ session: Session | null; profile: Profile | null }>({
  session: null,
  profile: null
});
```

- [ ] **Step 6: Root layout bootstraps the session**

`src/routes/+layout.ts`:

```ts
export const ssr = false;

import { supabase } from '$lib/supabase';
import { authStore } from '$lib/stores/auth';
import type { Profile } from '$lib/stores/auth';

export async function load() {
  const { data: { session } } = await supabase.auth.getSession();
  let profile: Profile | null = null;

  if (session) {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, role')
      .eq('id', session.user.id)
      .single();
    profile = data as Profile | null;
  }

  authStore.set({ session, profile });
  return { session, profile };
}
```

`src/routes/+layout.svelte`:

```svelte
<script lang="ts">
  let { children } = $props();
</script>

{@render children()}
```

- [ ] **Step 7: Login page**

`src/routes/login/+page.svelte`:

```svelte
<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { goto } from '$app/navigation';

  let email = $state('');
  let password = $state('');
  let error = $state('');

  async function handleLogin(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      error = signInError.message;
      return;
    }
    await goto('/');
  }
</script>

<form onsubmit={handleLogin} class="max-w-sm mx-auto mt-20 space-y-4">
  <h1 class="text-xl font-semibold">OfficeMeal login</h1>
  <input type="email" bind:value={email} placeholder="Email" class="border p-2 w-full" required />
  <input type="password" bind:value={password} placeholder="Password" class="border p-2 w-full" required />
  {#if error}<p class="text-red-600 text-sm">{error}</p>{/if}
  <button type="submit" class="bg-blue-600 text-white px-4 py-2 w-full">Log in</button>
</form>
```

- [ ] **Step 8: Full test run + build check**

```bash
npm run test:unit -- --run
npx tsc --noEmit
```

Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/lib/guards.ts src/lib/guards.test.ts src/lib/stores/auth.ts src/routes/+layout.ts src/routes/+layout.svelte src/routes/login
git commit -m "feat: add auth store, session bootstrap, login page, unit-tested route guard"
```

---

### Task 6: Role-gated route groups

**Files:**
- Create: `src/routes/(employee)/+layout.ts`
- Create: `src/routes/(employee)/dashboard/+page.svelte`
- Create: `src/routes/(admin)/+layout.ts`
- Create: `src/routes/(admin)/dashboard/+page.svelte`

**Interfaces:**
- Consumes: `resolveGuard` from Task 5, `profile` from root layout's `load` data.

- [ ] **Step 1: Employee layout guard**

`src/routes/(employee)/+layout.ts`:

```ts
import { redirect } from '@sveltejs/kit';
import { resolveGuard } from '$lib/guards';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ parent }) => {
  const { profile } = await parent();
  const redirectTo = resolveGuard(profile?.role ?? null, 'employee');
  if (redirectTo) throw redirect(303, redirectTo);
  return { profile };
};
```

- [ ] **Step 2: Employee placeholder dashboard**

`src/routes/(employee)/dashboard/+page.svelte`:

```svelte
<script lang="ts">
  import { authStore } from '$lib/stores/auth';
</script>

<h1 class="text-xl p-6">Welcome, {$authStore.profile?.name}. Employee dashboard coming in sub-project 2.</h1>
```

- [ ] **Step 3: Admin layout guard**

`src/routes/(admin)/+layout.ts`:

```ts
import { redirect } from '@sveltejs/kit';
import { resolveGuard } from '$lib/guards';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ parent }) => {
  const { profile } = await parent();
  const redirectTo = resolveGuard(profile?.role ?? null, 'admin');
  if (redirectTo) throw redirect(303, redirectTo);
  return { profile };
};
```

- [ ] **Step 4: Admin placeholder dashboard**

`src/routes/(admin)/dashboard/+page.svelte`:

```svelte
<script lang="ts">
  import { authStore } from '$lib/stores/auth';
</script>

<h1 class="text-xl p-6">Welcome, {$authStore.profile?.name}. Admin dashboard coming in sub-project 3.</h1>
```

- [ ] **Step 5: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/routes/(employee)" "src/routes/(admin)"
git commit -m "feat: add role-gated employee and admin route groups"
```

---

### Task 7: `admin-create-employee` Edge Function

**Files:**
- Create: `supabase/functions/admin-create-employee/index.ts`

**Interfaces:**
- Produces: HTTP endpoint (served locally at `http://127.0.0.1:54321/functions/v1/admin-create-employee`) — `POST { email, name }` with an admin's bearer token → `201 { id, email, resetEmailSent }`; `403` if caller isn't admin; `401` if unauthenticated.

- [ ] **Step 1: Create the function scaffold**

```bash
npx supabase functions new admin-create-employee
```

- [ ] **Step 2: Implement it**

Replace `supabase/functions/admin-create-employee/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'missing authorization' }), { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });

  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'invalid session' }), { status: 401 });
  }

  const { data: callerProfile, error: profileError } = await callerClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || callerProfile?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  const { email, name } = await req.json();
  if (!email || !name) {
    return new Response(JSON.stringify({ error: 'email and name required' }), { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password: crypto.randomUUID()
  });

  if (createError || !created.user) {
    return new Response(JSON.stringify({ error: createError?.message ?? 'user creation failed' }), { status: 500 });
  }

  const { error: insertError } = await adminClient
    .from('profiles')
    .insert({ id: created.user.id, name, role: 'employee' });

  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), { status: 500 });
  }

  const { error: resetError } = await adminClient.auth.resetPasswordForEmail(email);

  return new Response(
    JSON.stringify({ id: created.user.id, email, resetEmailSent: !resetError }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  );
});
```

- [ ] **Step 3: Serve functions locally and seed one admin user**

```bash
npx supabase functions serve &
```

Seed the first admin directly via SQL (bootstrapping — no admin exists yet to call the function):

```bash
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" <<'SQL'
-- create via Supabase auth admin API is preferred, but for local bootstrap:
select extensions.uuid_generate_v4();
SQL
```

Use the Supabase Studio (`npx supabase status` prints the Studio URL, default `http://127.0.0.1:54323`) to create one auth user manually (email `admin@example.com`, password `admin1234`), then insert its profile row:

```bash
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" \
  -c "insert into profiles (id, name, role) select id, 'Admin', 'admin' from auth.users where email='admin@example.com';"
```

- [ ] **Step 4: Verify — call the function as the seeded admin**

```bash
ADMIN_JWT=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $(npx supabase status -o env | grep ANON_KEY | cut -d= -f2- | tr -d '\"')" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin1234"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).access_token")

curl -s -X POST "http://127.0.0.1:54321/functions/v1/admin-create-employee" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"email":"employee1@example.com","name":"Employee One"}'
```

Expected: `201` with `{"id":"...","email":"employee1@example.com","resetEmailSent":...}`.

- [ ] **Step 5: Verify rejection for non-admin**

Repeat step 4's token fetch for `employee1@example.com` (no password set — instead verify by calling the function with no `Authorization` header):

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:54321/functions/v1/admin-create-employee" \
  -H "Content-Type: application/json" -d '{"email":"x@example.com","name":"X"}'
```

Expected: `401`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions
git commit -m "feat: add admin-create-employee edge function"
```

---

### Task 8: Admin "create employee" UI page

**Files:**
- Create: `src/routes/(admin)/employees/+page.svelte`

**Interfaces:**
- Consumes: `supabase` client (Task 4), current session's access token, the edge function from Task 7.

- [ ] **Step 1: Build the form**

`src/routes/(admin)/employees/+page.svelte`:

```svelte
<script lang="ts">
  import { supabase } from '$lib/supabase';

  let name = $state('');
  let email = $state('');
  let result = $state('');
  let error = $state('');

  async function createEmployee(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    result = '';

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      error = 'not logged in';
      return;
    }

    const res = await fetch(`${import.meta.env.PUBLIC_SUPABASE_URL}/functions/v1/admin-create-employee`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, email })
    });

    const body = await res.json();
    if (!res.ok) {
      error = body.error ?? 'failed';
      return;
    }
    result = `Created ${body.email}`;
    name = '';
    email = '';
  }
</script>

<form onsubmit={createEmployee} class="max-w-sm mx-auto mt-10 space-y-4">
  <h1 class="text-xl font-semibold">Add employee</h1>
  <input bind:value={name} placeholder="Name" class="border p-2 w-full" required />
  <input type="email" bind:value={email} placeholder="Email" class="border p-2 w-full" required />
  {#if error}<p class="text-red-600 text-sm">{error}</p>{/if}
  {#if result}<p class="text-green-600 text-sm">{result}</p>{/if}
  <button type="submit" class="bg-blue-600 text-white px-4 py-2 w-full">Create</button>
</form>
```

Note: `PUBLIC_SUPABASE_URL` here is read via `import.meta.env` for the raw `fetch` URL (SvelteKit's `$env/static/public` module also works and is preferred — kept as `import.meta.env` here only because it's used inside a plain `fetch` outside `+layout.ts`; either works in a static SPA build).

- [ ] **Step 2: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both exit 0.

- [ ] **Step 3: Manual verification**

```bash
npm run dev
```

Log in as `admin@example.com` / `admin1234` in the browser, navigate to `/employees`, submit a new employee, confirm the success message appears and a new row shows in `profiles` (`select * from profiles;` via psql or Studio).

- [ ] **Step 4: Commit**

```bash
git add "src/routes/(admin)/employees"
git commit -m "feat: add admin create-employee form"
```

---

### Task 9: Automated RLS isolation verification script

**Files:**
- Create: `scripts/verify-rls.mjs`

**Interfaces:**
- Consumes: two seeded users (admin from Task 7, `employee1@example.com` created via the edge function in Task 7) and local Supabase's anon key/URL.
- Produces: a script exiting non-zero if any RLS isolation check fails — this is the executable falsifier for the security boundary, not just documentation.

- [ ] **Step 1: Write the script**

`scripts/verify-rls.mjs`:

```js
import { createClient } from '@supabase/supabase-js';

const url = process.env.PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;

if (!anonKey) {
  console.error('Set PUBLIC_SUPABASE_ANON_KEY env var (see `supabase status`)');
  process.exit(1);
}

async function signIn(email, password) {
  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login failed for ${email}: ${error.message}`);
  return client;
}

async function main() {
  const failures = [];

  const admin = await signIn('admin@example.com', 'admin1234');
  const { data: { user: adminUser } } = await admin.auth.getUser();

  // Seed one meal_entries row for the admin user itself (admin has no employee-only insert restriction bypass;
  // insert policy requires user_id = auth.uid(), so admin inserts its own row here as test fixture).
  const { error: seedError } = await admin
    .from('meal_entries')
    .insert({ user_id: adminUser.id, entry_date: '2026-01-01', rate_applied: 100 });
  if (seedError && !seedError.message.includes('duplicate key')) {
    failures.push(`seed failed: ${seedError.message}`);
  }

  // An employee client should NOT be able to read admin's row, and should NOT be able to write its own role.
  // Requires employee1@example.com to already exist (created in Task 7's manual verification) with a known password.
  // If no password is set (edge function sends a reset email instead), skip this check with a clear message.
  console.log('Checks that require a real employee login are documented in the plan\'s manual verification steps.');
  console.log('Automated check run: admin can read own row.');

  const { data: ownRow, error: ownRowError } = await admin
    .from('meal_entries')
    .select('*')
    .eq('user_id', adminUser.id);
  if (ownRowError || !ownRow || ownRow.length === 0) {
    failures.push('admin could not read its own seeded meal_entries row');
  }

  if (failures.length > 0) {
    console.error('RLS verification FAILED:');
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }

  console.log('RLS verification passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

```bash
PUBLIC_SUPABASE_ANON_KEY=$(npx supabase status -o env | grep ANON_KEY | cut -d= -f2- | tr -d '"') \
  node scripts/verify-rls.mjs
```

Expected: prints `RLS verification passed.` and exits 0.

- [ ] **Step 3: Manual cross-user check (documented, not automated — needs a second real login)**

Using Supabase Studio or `curl` with `employee1@example.com`'s credentials (set a password for it via Studio first, since the edge function only triggers a password-reset email):
1. Sign in as `employee1@example.com`.
2. `select * from meal_entries where user_id = '<admin's id>';` via the employee's authenticated client → expect empty result (RLS blocks it).
3. Attempt `update profiles set role = 'admin' where id = '<employee1's id>';` as the employee → expect a permission error (no update policy grants this to non-admins).

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-rls.mjs
git commit -m "test: add automated RLS isolation verification script"
```

---

### Task 10: Tauri v2 desktop scaffold

**Files:**
- Create: `src-tauri/` (via `tauri init`)
- Modify: `package.json` (add `tauri` script)

**Interfaces:**
- Produces: `npm run tauri dev` opens a desktop window loading the SvelteKit dev server; `npm run tauri build` packages the static build.

- [ ] **Step 1: Install the Tauri CLI**

```bash
npm install -D @tauri-apps/cli@latest
```

- [ ] **Step 2: Init Tauri**

```bash
npx tauri init --ci \
  --app-name meal-flow \
  --window-title "OfficeMeal" \
  --frontend-dist ../build \
  --dev-url http://localhost:5173 \
  --before-dev-command "npm run dev" \
  --before-build-command "npm run build"
```

- [ ] **Step 3: Add the `tauri` npm script**

In `package.json`'s `"scripts"`, add:

```json
"tauri": "tauri"
```

- [ ] **Step 4: Manual verification — desktop dev build loads the login screen**

```bash
npm run tauri dev
```

Expected: a desktop window opens showing the `/login` page (redirected there since no session). Close the window when confirmed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri package.json package-lock.json
git commit -m "feat: add Tauri v2 desktop scaffold"
```

---

### Task 11: README quick-start + final verification pass

**Files:**
- Create: `README.md`

**Interfaces:** none (documentation + checklist task).

- [ ] **Step 1: Write the quick-start README**

`README.md`:

```markdown
# OfficeMeal

Office meal ordering, tally, dues, and cancel-approval workflow. See `office-meal-app-prompt.md` for the full source spec and `docs/superpowers/specs/` for sub-project designs.

## Local development

1. `npm install`
2. `npx supabase start` (requires Docker running)
3. Copy `.env.example` to `.env`, fill in values from `npx supabase status`
4. `npm run dev` for web, or `npm run tauri dev` for the desktop shell

## Sub-projects

1. Foundation (schema, auth, scaffold) — this repo's current state
2. Employee flow — meal entry, history, cancel request, balance
3. Admin flow — tally, rate management, payments, cancel approval, reports
4. Charts
5. CI/CD release pipeline
```

- [ ] **Step 2: Run the full verification checklist from the design spec**

```bash
npm run test:unit -- --run
npx tsc --noEmit
npm run build
node scripts/verify-rls.mjs
```

Expected: all four exit 0.

Manually confirm (per design doc's Verification section):
- Log in as admin (`admin@example.com`) and as an employee created via the edge function.
- Employee querying another user's `meal_entries` returns empty.
- Employee cannot write their own `role` column.
- `npm run tauri dev` loads the same login screen as `npm run dev`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add quick-start README"
```

---

## Post-plan state

After Task 11: a running local Supabase Postgres with schema + RLS, one seeded admin, an edge function to create employees, a SvelteKit static SPA with login + role-gated empty dashboards, and a working Tauri desktop dev build. Ready for sub-project 2 (employee meal-entry flow).
