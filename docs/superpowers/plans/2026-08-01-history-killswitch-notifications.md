# Employee History, Ordering Kill-Switch, and Push Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Employees can see their own dated history (meals + payments); admin gets a kill-switch to close ordering for the rest of the day (auto-reopens tomorrow); employees get a push reminder at 9am if they haven't ordered, admin gets one at 10:30am if ordering is still open — real push for web/desktop, in-app-only for Android.

**Architecture:** Two small Postgres tables (`ordering_pause`, `push_subscriptions`) with RLS + grants following this project's existing pattern; one trigger change to enforce the kill-switch server-side; a Web Push (VAPID) subscribe flow wired into the existing root layouts; one cron-triggered edge function that sends the two daily reminders; an Android-only foreground fallback using Tauri's official notification plugin since Tauri has no FCM plugin for true background push.

**Tech Stack:** SvelteKit 5 (runes), Supabase Postgres/RLS/Edge Functions (Deno), `npm:web-push` inside the edge function, browser Push API + Service Worker for web/desktop, `@tauri-apps/plugin-notification` for Android.

## Global Constraints

- Fixed timezone for all reminder scheduling: `Asia/Dhaka` (UTC+6). Use `new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })` server-side (Deno has full ICU/Intl support).
- Android gets no true background push (no FCM plugin work in scope). It shows the same reminder as a local notification only while the app is open/foregrounded, via `@tauri-apps/plugin-notification`.
- Admin recipients for the 10:30 reminder = every `profiles.role = 'admin'` row that has a push subscription. No per-admin scoping.
- The kill-switch's real enforcement is the `enforce_meal_entry_invariants` trigger. Any frontend check is UX only — this project's standing rule is that frontend validation must be mirrored server-side, never trusted alone.
- New tables need explicit `grant` statements (`authenticated`, `service_role`) — Supabase does not auto-expose new tables to PostgREST roles, established in `20260731160500_grants.sql` and true for every table since.
- After every migration: `npx supabase db reset` (full local rebuild), then `npx supabase gen types typescript --local > src/lib/database.types.ts`, then `npm run check`. This is the project's established practice — skipping type regeneration has broken `npm run check` before.
- Use `npm run check`, never `npx tsc --noEmit` alone, to verify — `tsc --noEmit` does not read `.svelte` files at all in this project's config.

---

### Task 1: Employee history page shows payments too

**Files:**
- Modify: `src/routes/employee/history/+page.svelte`

**Interfaces:**
- Consumes: existing `page.data.profile.id`, `supabase` client from `$lib/supabase`.
- Produces: nothing consumed by later tasks — this page is a leaf.

- [ ] **Step 1: Add the `Payment` type and a merged `rows` list**

Replace the top of the `<script>` block (types + state) with:

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';

  type Entry = { id: string; entry_date: string; status: string; rate_applied: number };
  type CancelRequest = {
    id: string;
    meal_entry_id: string;
    status: string;
    reason: string | null;
    created_at: string;
  };
  type Payment = { id: string; amount: number; note: string | null; paid_at: string };
  type Row =
    | { kind: 'meal'; date: string; entry: Entry }
    | { kind: 'payment'; date: string; payment: Payment };

  const userId = page.data.profile?.id as string;

  let entries = $state<Entry[]>([]);
  let payments = $state<Payment[]>([]);
  let requests = $state<CancelRequest[]>([]);
  let loading = $state(true);
  let requestingId = $state<string | null>(null);
  let reason = $state('');
  let error = $state('');
  let loadError = $state('');
  let submitting = $state(false);

  let rows = $derived.by((): Row[] => {
    const meals: Row[] = entries.map((entry) => ({ kind: 'meal' as const, date: entry.entry_date, entry }));
    const pays: Row[] = payments.map((payment) => ({
      kind: 'payment' as const,
      date: payment.paid_at,
      payment
    }));
    return [...meals, ...pays].sort((a, b) => (a.date < b.date ? 1 : -1));
  });
</script>
```

- [ ] **Step 2: Fetch payments alongside entries and requests**

Replace the `load` function with:

```ts
async function load() {
  loading = true;
  loadError = '';
  const [entriesRes, paymentsRes, requestsRes] = await Promise.all([
    supabase
      .from('meal_entries')
      .select('id, entry_date, status, rate_applied')
      .eq('user_id', userId)
      .order('entry_date', { ascending: false }),
    supabase
      .from('payments')
      .select('id, amount, note, paid_at')
      .eq('user_id', userId)
      .order('paid_at', { ascending: false }),
    supabase
      .from('cancel_requests')
      .select('id, meal_entry_id, status, reason, created_at')
      .eq('requested_by', userId)
      .order('created_at', { ascending: false })
  ]);
  const failed = [entriesRes.error, paymentsRes.error, requestsRes.error].find(Boolean);
  if (failed) {
    loadError = failed.message;
    loading = false;
    return;
  }
  entries = entriesRes.data ?? [];
  payments = paymentsRes.data ?? [];
  requests = requestsRes.data ?? [];
  loading = false;
}
```

Leave `onMount(load)`, `requestedFor`, `startRequest`, `submitRequest` unchanged.

- [ ] **Step 3: Render the merged list**

Replace the markup from `{#if loading}` to the closing `{/if}` at the bottom with:

```svelte
{#if loading}
  <p class="text-sm text-ink/50">Loading…</p>
{:else if loadError}
  <p class="text-sm text-stamp-dark">{loadError}</p>
{:else if rows.length === 0}
  <p class="text-sm text-ink/50">No entries yet.</p>
{:else}
  <ul class="divide-y divide-line border-t border-b border-line">
    {#each rows as row (row.kind === 'meal' ? `meal-${row.entry.id}` : `payment-${row.payment.id}`)}
      {#if row.kind === 'payment'}
        <li class="py-3 flex items-center justify-between">
          <div>
            <p class="text-sm font-medium">{row.payment.paid_at.slice(0, 10)}</p>
            <p class="text-xs text-ink/50">{row.payment.note ?? 'Payment'}</p>
          </div>
          <p class="text-sm text-sage">+{row.payment.amount.toFixed(2)}</p>
        </li>
      {:else}
        {@const entry = row.entry}
        {@const existingRequest = requestedFor(entry.id)}
        <li class="py-3">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p class="text-sm font-medium">{entry.entry_date}</p>
              <p class="text-xs text-ink/50">
                {entry.status} · charged {entry.rate_applied.toFixed(2)}
                {#if existingRequest}· cancel {existingRequest.status.toLowerCase()}{/if}
              </p>
            </div>
            {#if entry.status === 'CONFIRMED' && !existingRequest}
              {#if requestingId === entry.id}
                <div class="flex items-center gap-2">
                  <button
                    onclick={() => submitRequest(entry.id)}
                    disabled={submitting}
                    class="font-display text-[11px] tracking-widest uppercase text-stamp hover:text-stamp-dark disabled:opacity-50"
                  >
                    {submitting ? 'Submitting…' : 'Submit'}
                  </button>
                  <button
                    onclick={() => (requestingId = null)}
                    disabled={submitting}
                    class="font-display text-[11px] tracking-widest uppercase text-ink/40 hover:text-ink disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              {:else}
                <button
                  onclick={() => startRequest(entry.id)}
                  class="font-display text-[11px] tracking-widest uppercase text-ink/40 hover:text-stamp transition-colors"
                >
                  Request cancellation
                </button>
              {/if}
            {/if}
          </div>
          {#if requestingId === entry.id}
            <textarea
              bind:value={reason}
              placeholder="Reason (optional)"
              class="mt-2 w-full border-b-2 border-line bg-transparent py-2 text-sm outline-none focus:border-stamp transition-colors"
              rows="2"
            ></textarea>
            {#if error}<p class="mt-2 text-sm text-stamp-dark">{error}</p>{/if}
          {/if}
        </li>
      {/if}
    {/each}
  </ul>
{/if}
```

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: 0 errors (pre-existing `donutCanvas` warning elsewhere is unrelated and fine).

Run: `npm run build`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src/routes/employee/history/+page.svelte
git commit -m "feat: show payments in employee history"
```

---

### Task 2: Ordering kill-switch — schema + trigger

**Files:**
- Create: `supabase/migrations/20260801110000_ordering_pause.sql`
- Modify: `src/lib/database.types.ts` (regenerated, not hand-edited)

**Interfaces:**
- Produces: table `ordering_pause(paused_date date primary key, paused_by uuid, paused_at timestamptz)`. A row present for a given date means ordering is closed that date. Consumed by Task 3 (admin/employee UI) and Task 6 (edge function's admin-reminder check).

- [ ] **Step 1: Create the migration file**

Run: `npx supabase migration new ordering_pause`

This creates a timestamped file — rename/confirm it matches `20260801110000_ordering_pause.sql` (adjust the exact generated timestamp is fine, just keep the `_ordering_pause` suffix; use whatever timestamp the CLI assigns).

- [ ] **Step 2: Write the migration**

```sql
-- Kill-switch for new meal orders. A row present for a date means ordering
-- is closed that date; deleting the row reopens it. No cron/cleanup needed
-- for the "auto-resets tomorrow" requirement — tomorrow's date simply has
-- no row yet.

create table public.ordering_pause (
  paused_date date primary key,
  paused_by uuid not null references public.profiles(id),
  paused_at timestamptz not null default now()
);

alter table public.ordering_pause enable row level security;

-- Anyone logged in can see whether ordering is paused today (employees need
-- this to show the "closed" banner); only admins can open/close it.
create policy "ordering_pause_select_authed" on public.ordering_pause
  for select using (auth.uid() is not null);

create policy "ordering_pause_admin_write" on public.ordering_pause
  for all using (is_admin()) with check (is_admin());

grant select, insert, update, delete on public.ordering_pause to authenticated;
grant select, insert, update, delete on public.ordering_pause to service_role;

-- Defense in depth: the real gate against new meal_entries on a paused date.
create or replace function enforce_meal_entry_invariants()
returns trigger
language plpgsql
as $$
declare
  active_rate numeric(10,2);
begin
  if not exists (select 1 from profiles where id = new.user_id and active) then
    raise exception 'account is deactivated';
  end if;

  if exists (select 1 from ordering_pause where paused_date = new.entry_date) then
    raise exception 'ordering is closed for today';
  end if;

  select rate into active_rate
  from meal_rates
  where effective_from <= new.entry_date
  order by effective_from desc, created_at desc
  limit 1;

  if active_rate is null then
    raise exception 'no active meal rate for %', new.entry_date;
  end if;

  new.rate_applied := active_rate;
  new.status := 'CONFIRMED';
  return new;
end;
$$;
```

- [ ] **Step 3: Apply locally and regenerate types**

Run:
```bash
npx supabase db reset
npx supabase gen types typescript --local > src/lib/database.types.ts
```
Expected: reset succeeds with no errors (all prior migrations + this one + seed apply cleanly); `database.types.ts` now includes an `ordering_pause` table entry.

- [ ] **Step 4: Exploit-test — trigger actually blocks a paused date**

```bash
ANON_KEY=$(npx supabase status -o env | grep -o 'ANON_KEY="[^"]*"' | cut -d'"' -f2)
ADMIN_JWT=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin1234"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).access_token")
ADMIN_ID=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin1234"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).user.id")
TODAY=$(date +%F)

# Admin closes ordering for today
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "http://127.0.0.1:54321/rest/v1/ordering_pause" \
  -H "Authorization: Bearer $ADMIN_JWT" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"paused_date\":\"$TODAY\",\"paused_by\":\"$ADMIN_ID\"}"

EMP_JWT=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"employee1@example.com","password":"employee1234"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).access_token")
EMP_ID=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"employee1@example.com","password":"employee1234"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).user.id")

# Employee tries to mark eating -> must be rejected
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "http://127.0.0.1:54321/rest/v1/meal_entries" \
  -H "Authorization: Bearer $EMP_JWT" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"user_id\":\"$EMP_ID\",\"entry_date\":\"$TODAY\",\"rate_applied\":0}"

# Admin reopens -> insert must now succeed
curl -s -X DELETE "http://127.0.0.1:54321/rest/v1/ordering_pause?paused_date=eq.$TODAY" \
  -H "Authorization: Bearer $ADMIN_JWT" -H "apikey: $ANON_KEY"

curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "http://127.0.0.1:54321/rest/v1/meal_entries" \
  -H "Authorization: Bearer $EMP_JWT" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"user_id\":\"$EMP_ID\",\"entry_date\":\"$TODAY\",\"rate_applied\":0}"
```

Expected: the admin insert into `ordering_pause` returns 201; the employee's first `meal_entries` insert returns non-2xx with an error body containing `ordering is closed for today`; after the admin deletes the pause row, the employee's second insert returns 201. If the second employee insert fails for a different reason (e.g. `unique(user_id, entry_date)` because an earlier test run already inserted today's row), delete that row via psql/`supabase db reset` first — that's a test-setup collision, not a defect.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260801110000_ordering_pause.sql src/lib/database.types.ts
git commit -m "feat: add ordering kill-switch table and trigger enforcement"
```

---

### Task 3: Admin kill-switch button + employee closed banner

**Files:**
- Modify: `src/routes/admin/dashboard/+page.svelte`
- Modify: `src/routes/employee/dashboard/+page.svelte`

**Interfaces:**
- Consumes: `ordering_pause` table from Task 2 (`paused_date`, `paused_by`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the toggle button to the admin dashboard**

In `src/routes/admin/dashboard/+page.svelte`, replace the `<script>` block with:

```svelte
<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';
  import { localToday } from '$lib/meals';
  import { page } from '$app/state';

  type Row = { id: string; user_id: string; profiles: { name: string } | null };

  const adminId = page.data.profile?.id as string;

  let selectedDate = $state(localToday());
  let rows = $state<Row[]>([]);
  let loading = $state(true);
  let loadError = $state('');
  let paused = $state(false);
  let pauseLoading = $state(false);
  let pauseError = $state('');

  async function load() {
    loading = true;
    loadError = '';
    const { data, error } = await supabase
      .from('meal_entries')
      .select('id, user_id, profiles(name)')
      .eq('entry_date', selectedDate)
      .eq('status', 'CONFIRMED');
    if (error) {
      loadError = error.message;
      loading = false;
      return;
    }
    rows = (data ?? []) as unknown as Row[];
    loading = false;
  }

  async function loadPauseState() {
    const { data } = await supabase
      .from('ordering_pause')
      .select('paused_date')
      .eq('paused_date', localToday())
      .maybeSingle();
    paused = !!data;
  }

  async function togglePause() {
    if (pauseLoading) return;
    pauseLoading = true;
    pauseError = '';
    const today = localToday();
    const { error } = paused
      ? await supabase.from('ordering_pause').delete().eq('paused_date', today)
      : await supabase.from('ordering_pause').insert({ paused_date: today, paused_by: adminId });
    pauseLoading = false;
    if (error) {
      pauseError = error.message;
      return;
    }
    paused = !paused;
  }

  onMount(() => {
    load();
    loadPauseState();
  });
</script>
```

Add this block right after the existing `<div class="mb-8">…</div>` header, before the date `<label>`:

```svelte
<div class="ticket mb-8 px-6 py-5">
  <p class="font-display text-[11px] tracking-widest text-ink/50 uppercase mb-2">Ordering</p>
  {#if pauseError}<p class="text-sm text-stamp-dark mb-2">{pauseError}</p>{/if}
  <button
    onclick={togglePause}
    disabled={pauseLoading}
    class="font-display text-sm tracking-wide px-5 py-3 rounded-sm w-full transition-colors disabled:opacity-50 {paused
      ? 'bg-ink/10 text-ink hover:bg-ink/20'
      : 'bg-stamp text-paper hover:bg-stamp-dark'}"
  >
    {pauseLoading ? 'Working…' : paused ? 'Reopen ordering for today' : 'Close ordering for today'}
  </button>
  {#if paused}
    <p class="mt-2 text-xs text-ink/50">
      Employees can't mark new meals today. Reopens automatically tomorrow.
    </p>
  {/if}
</div>
```

- [ ] **Step 2: Add the paused check + banner to the employee dashboard**

In `src/routes/employee/dashboard/+page.svelte`, add `let paused = $state(false);` next to the other `$state` declarations (near `let error = $state('');`).

Replace the `load` function's Promise.all block and the lines through `loading = false;` (before `await tick();`) with:

```ts
async function load() {
  loading = true;
  loadError = '';
  // Read the date fresh each load — a tab left open past midnight must not
  // keep reporting yesterday as "today".
  const today = localToday();
  const [ratesRes, entriesRes, paymentsRes, pauseRes] = await Promise.all([
    supabase.from('meal_rates').select('rate, effective_from, created_at'),
    supabase.from('meal_entries').select('id, entry_date, status, rate_applied').eq('user_id', userId),
    supabase.from('payments').select('amount').eq('user_id', userId),
    supabase.from('ordering_pause').select('paused_date').eq('paused_date', today).maybeSingle()
  ]);

  const failed = [ratesRes.error, entriesRes.error, paymentsRes.error, pauseRes.error].find(Boolean);
  if (failed) {
    loadError = failed.message;
    loading = false;
    donutChart?.destroy();
    donutChart = null;
    return;
  }

  activeRate = pickActiveRate(ratesRes.data ?? [], today);
  todayEntry = (entriesRes.data ?? []).find((e) => e.entry_date === today) ?? null;
  balance = computeBalance(entriesRes.data ?? [], paymentsRes.data ?? []);
  paused = !!pauseRes.data;
  loading = false;
```

(Leave the rest of `load` — the `await tick();` onward — unchanged.)

In the markup, insert a `{:else if paused}` branch between the `{:else if todayEntry}` (cancelled) branch and the `{:else if activeRate === null}` branch:

```svelte
{:else if paused}
  <p class="font-display text-[11px] tracking-widest text-stamp uppercase mb-2">Closed</p>
  <p class="text-sm text-ink/60">Ordering is closed for today. Check back tomorrow.</p>
```

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 4: Manual verification**

```bash
npm run build && npm run preview
```
As admin, visit `/admin/dashboard`, click "Close ordering for today" — button flips to "Reopen ordering for today" and the helper text appears. As employee (different browser/incognito), visit `/employee/dashboard` — the "Eating today?" button is replaced by the "Closed" message. As admin, click "Reopen ordering for today" — refresh the employee tab, the mark-eating button is back.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin/dashboard/+page.svelte src/routes/employee/dashboard/+page.svelte
git commit -m "feat: wire ordering kill-switch into admin and employee dashboards"
```

---

### Task 4: Push subscriptions — schema

**Files:**
- Create: `supabase/migrations/20260801120000_push_subscriptions.sql`
- Modify: `src/lib/database.types.ts` (regenerated)

**Interfaces:**
- Produces: table `push_subscriptions(id uuid, user_id uuid, endpoint text unique, p256dh text, auth text, created_at timestamptz)`. Consumed by Task 5 (subscribe/upsert) and Task 6 (edge function reads + deletes stale rows).

- [ ] **Step 1: Create the migration file**

Run: `npx supabase migration new push_subscriptions`

- [ ] **Step 2: Write the migration**

```sql
-- Web Push subscriptions for the 9am/10:30am reminders (web + desktop only —
-- Android has no entry here, it uses a local-notification fallback instead,
-- see the send-reminders edge function and androidReminders.ts).

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_own" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;
```

- [ ] **Step 3: Apply locally and regenerate types**

```bash
npx supabase db reset
npx supabase gen types typescript --local > src/lib/database.types.ts
```
Expected: reset succeeds, `database.types.ts` now includes `push_subscriptions`.

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260801120000_push_subscriptions.sql src/lib/database.types.ts
git commit -m "feat: add push_subscriptions table"
```

---

### Task 5: Web push subscribe flow (web + desktop)

**Files:**
- Create: `static/sw.js`
- Create: `src/lib/push.ts`
- Modify: `src/routes/employee/+layout.svelte`
- Modify: `src/routes/admin/+layout.svelte`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `push_subscriptions` table (Task 4), `PUBLIC_VAPID_PUBLIC_KEY` env var.
- Produces: `initWebPush(userId: string): Promise<void>` from `src/lib/push.ts`, called by Task 7's layout wiring alongside `initAndroidReminders`.

- [ ] **Step 1: Add the service worker**

```js
// static/sw.js
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title ?? 'OfficeMeal';
  const options = { body: data.body ?? '', icon: '/favicon.svg' };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
```

- [ ] **Step 2: Add the VAPID public key env var**

Append to `.env.example`:

```
PUBLIC_VAPID_PUBLIC_KEY=replace-with-vapid-public-key
```

- [ ] **Step 3: Write `src/lib/push.ts`**

```ts
import { PUBLIC_VAPID_PUBLIC_KEY } from '$env/static/public';
import { supabase } from './supabase';

function isTauriAndroid(): boolean {
  return '__TAURI_INTERNALS__' in window && /Android/i.test(navigator.userAgent);
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Registers the service worker and subscribes to web push. No-ops on the
 *  Tauri Android build (no background push there — see androidReminders.ts)
 *  and when the browser lacks Push API support or denies permission. */
export async function initWebPush(userId: string): Promise<void> {
  if (isTauriAndroid()) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission === 'denied') return;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  const registration = await navigator.serviceWorker.register('/sw.js');
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_PUBLIC_KEY)
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

  await supabase.from('push_subscriptions').upsert(
    { user_id: userId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
    { onConflict: 'endpoint' }
  );
}
```

- [ ] **Step 4: Wire into both layouts**

In `src/routes/employee/+layout.svelte`, add the import and an `onMount` call:

```svelte
<script lang="ts">
  import NavRail from '$lib/components/NavRail.svelte';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { initWebPush } from '$lib/push';

  let { children } = $props();

  const links = [
    { href: '/employee/dashboard', label: 'Dashboard' },
    { href: '/employee/history', label: 'History' },
    { href: '/employee/settings', label: 'Settings' }
  ];

  onMount(() => {
    const userId = page.data.profile?.id;
    if (userId) void initWebPush(userId);
  });
</script>
```

Apply the same pattern to `src/routes/admin/+layout.svelte` (same import, same `onMount` block, unchanged `links` array).

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: 0 errors. (`PUBLIC_VAPID_PUBLIC_KEY` will fail at runtime without a real value in `.env` — set a throwaway value locally, e.g. any non-empty string, to get past SvelteKit's env validation for this check; a real VAPID key isn't needed until Task 6/8's live test.)

- [ ] **Step 6: Commit**

```bash
git add static/sw.js src/lib/push.ts src/routes/employee/+layout.svelte src/routes/admin/+layout.svelte .env.example
git commit -m "feat: add web push subscribe flow for web and desktop"
```

---

### Task 6: `send-reminders` edge function

**Files:**
- Create: `supabase/functions/send-reminders/index.ts`

**Interfaces:**
- Consumes: `push_subscriptions` (Task 4), `ordering_pause` (Task 2), `profiles`, `meal_entries`.
- Produces: nothing consumed by later tasks — invoked only by Supabase's scheduled Cron Jobs (configured manually in Task 8's README section, not in code).

- [ ] **Step 1: Write the function**

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

// Cron-only endpoint: Supabase's scheduled Cron Jobs hit this twice a day
// (see README "Push reminders" setup). Never exposed to end users, so auth
// is a shared secret rather than a user session.
Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const client = createClient(supabaseUrl, serviceRoleKey);

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!
  );

  const body = await req.json().catch(() => ({ kind: null }));
  const kind = body.kind;
  if (kind !== 'employee-reminder' && kind !== 'admin-reminder') {
    return new Response(
      JSON.stringify({ error: 'kind must be employee-reminder or admin-reminder' }),
      { status: 400 }
    );
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
  let targetUserIds: string[] = [];

  if (kind === 'employee-reminder') {
    const [{ data: employees, error: employeesError }, { data: confirmedToday, error: entriesError }] =
      await Promise.all([
        client.from('profiles').select('id').eq('role', 'employee').eq('active', true),
        client.from('meal_entries').select('user_id').eq('entry_date', today).eq('status', 'CONFIRMED')
      ]);
    if (employeesError || entriesError) {
      return new Response(
        JSON.stringify({ error: (employeesError ?? entriesError)?.message }),
        { status: 500 }
      );
    }
    const confirmedIds = new Set((confirmedToday ?? []).map((e) => e.user_id));
    targetUserIds = (employees ?? []).map((e) => e.id).filter((id) => !confirmedIds.has(id));
  } else {
    const { data: pauseRow, error: pauseError } = await client
      .from('ordering_pause')
      .select('paused_date')
      .eq('paused_date', today)
      .maybeSingle();
    if (pauseError) {
      return new Response(JSON.stringify({ error: pauseError.message }), { status: 500 });
    }
    if (pauseRow) {
      return new Response(JSON.stringify({ sent: 0, reason: 'already paused' }), { status: 200 });
    }
    const { data: admins, error: adminsError } = await client.from('profiles').select('id').eq('role', 'admin');
    if (adminsError) {
      return new Response(JSON.stringify({ error: adminsError.message }), { status: 500 });
    }
    targetUserIds = (admins ?? []).map((a) => a.id);
  }

  if (targetUserIds.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  const { data: subscriptions, error: subsError } = await client
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', targetUserIds);
  if (subsError) {
    return new Response(JSON.stringify({ error: subsError.message }), { status: 500 });
  }

  const payload = JSON.stringify(
    kind === 'employee-reminder'
      ? { title: 'OfficeMeal', body: "You haven't ordered today yet." }
      : { title: 'OfficeMeal', body: 'Ordering is still open — close it if needed.' }
  );

  let sent = 0;
  const staleIds: string[] = [];
  for (const sub of subscriptions ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) staleIds.push(sub.id);
    }
  }

  if (staleIds.length > 0) {
    await client.from('push_subscriptions').delete().in('id', staleIds);
  }

  return new Response(JSON.stringify({ sent, stale: staleIds.length }), { status: 200 });
});
```

- [ ] **Step 2: Set local secrets and serve**

```bash
npx supabase secrets set --env-file - <<'EOF'
CRON_SECRET=local-test-secret
VAPID_PUBLIC_KEY=local-test-public
VAPID_PRIVATE_KEY=local-test-private
EOF
npx supabase functions serve send-reminders
```
(Leave running in a background terminal for the next step. `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` don't need to be real, valid VAPID keys for this test — no subscriptions exist yet, so `sendNotification` never runs.)

- [ ] **Step 3: Exploit-test — wrong/missing secret is rejected**

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "http://127.0.0.1:54321/functions/v1/send-reminders" \
  -H "Content-Type: application/json" -d '{"kind":"employee-reminder"}'
```
Expected: `HTTP_STATUS:403`.

- [ ] **Step 4: Verify — correct secret, employee-reminder targets the right people**

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "http://127.0.0.1:54321/functions/v1/send-reminders" \
  -H "Content-Type: application/json" -H "x-cron-secret: local-test-secret" \
  -d '{"kind":"employee-reminder"}'
```
Expected: `HTTP_STATUS:200`, body `{"sent":0}` (or `{"sent":0,"stale":0}`) since no rows exist yet in `push_subscriptions` — this confirms the query logic runs without error, not that a push was delivered (that needs a real subscription, out of scope for local testing per the design).

- [ ] **Step 5: Verify — bad kind is rejected**

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "http://127.0.0.1:54321/functions/v1/send-reminders" \
  -H "Content-Type: application/json" -H "x-cron-secret: local-test-secret" \
  -d '{"kind":"bogus"}'
```
Expected: `HTTP_STATUS:400`.

- [ ] **Step 6: Verify — admin-reminder skips when already paused**

Insert a row into `ordering_pause` for today (reuse Task 2's curl pattern or psql `insert into ordering_pause (paused_date, paused_by) values (current_date, (select id from profiles where role='admin' limit 1));`), then:

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "http://127.0.0.1:54321/functions/v1/send-reminders" \
  -H "Content-Type: application/json" -H "x-cron-secret: local-test-secret" \
  -d '{"kind":"admin-reminder"}'
```
Expected: `HTTP_STATUS:200`, body `{"sent":0,"reason":"already paused"}`. Clean up: `delete from ordering_pause where paused_date = current_date;` via psql so it doesn't linger and break Task 3's manual check.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/send-reminders/index.ts
git commit -m "feat: add send-reminders edge function for 9am/10:30am push"
```

---

### Task 7: Android in-app reminder fallback

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `package.json`
- Create: `src/lib/androidReminders.ts`
- Modify: `src/routes/employee/+layout.svelte`
- Modify: `src/routes/admin/+layout.svelte`

**Interfaces:**
- Consumes: `meal_entries`, `ordering_pause` tables; `localToday()` from `$lib/meals`.
- Produces: `initAndroidReminders(userId: string, role: 'employee' | 'admin'): () => void` — returns a cleanup function, called from both layouts' `onMount`/`onDestroy`.

- [ ] **Step 1: Add the Rust plugin dependency**

In `src-tauri/Cargo.toml`, add to `[dependencies]` (after the existing `tauri-plugin-log = "2"` line):

```toml
tauri-plugin-notification = "2"
```

- [ ] **Step 2: Register the plugin**

Replace `src-tauri/src/lib.rs` with:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
```

- [ ] **Step 3: Grant the notification permission in the capability file**

In `src-tauri/capabilities/default.json`, add `"notification:default"` to the `permissions` array so it reads:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "enables the default permissions",
  "windows": [
    "main"
  ],
  "permissions": [
    "core:default",
    "notification:default"
  ]
}
```

- [ ] **Step 4: Verify the Rust side compiles**

Run: `cd src-tauri && cargo check && cd ..`
Expected: succeeds (desktop target — the Android-specific code inside the plugin is conditionally compiled and doesn't need the Android NDK for this check).

- [ ] **Step 5: Add the JS plugin dependency**

Add to `package.json`'s `"dependencies"` (alongside `@supabase/supabase-js` and `chart.js`):

```json
"@tauri-apps/plugin-notification": "^2"
```

Run: `npm install`

- [ ] **Step 6: Write `src/lib/androidReminders.ts`**

```ts
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { supabase } from './supabase';
import { localToday } from './meals';

function isTauriAndroid(): boolean {
  return '__TAURI_INTERNALS__' in window && /Android/i.test(navigator.userAgent);
}

function alreadyNotifiedToday(key: string): boolean {
  return localStorage.getItem(key) === localToday();
}

function markNotifiedToday(key: string): void {
  localStorage.setItem(key, localToday());
}

async function notifyOnce(key: string, title: string, body: string): Promise<void> {
  if (alreadyNotifiedToday(key)) return;
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === 'granted';
  }
  if (!granted) return;
  sendNotification({ title, body });
  markNotifiedToday(key);
}

// Device-local clock, same philosophy as localToday() elsewhere in this app —
// the office runs in one timezone and every existing "today" check is already
// client-local, not server-side Asia/Dhaka.
async function checkEmployeeReminder(userId: string): Promise<void> {
  const now = new Date();
  if (now.getHours() < 9) return;
  const today = localToday();
  const { data } = await supabase
    .from('meal_entries')
    .select('id')
    .eq('user_id', userId)
    .eq('entry_date', today)
    .eq('status', 'CONFIRMED')
    .maybeSingle();
  if (!data) {
    await notifyOnce('officemeal-employee-reminder', 'OfficeMeal', "You haven't ordered today yet.");
  }
}

async function checkAdminReminder(): Promise<void> {
  const now = new Date();
  if (now.getHours() < 10 || (now.getHours() === 10 && now.getMinutes() < 30)) return;
  const today = localToday();
  const { data } = await supabase
    .from('ordering_pause')
    .select('paused_date')
    .eq('paused_date', today)
    .maybeSingle();
  if (!data) {
    await notifyOnce('officemeal-admin-reminder', 'OfficeMeal', 'Ordering is still open — close it if needed.');
  }
}

/** Starts the Android-only foreground reminder loop. No-ops outside the Tauri
 *  Android build — web/desktop get real push instead (see push.ts). Returns
 *  a cleanup function for onDestroy. */
export function initAndroidReminders(userId: string, role: 'employee' | 'admin'): () => void {
  if (!isTauriAndroid()) return () => {};
  const check = () => {
    if (role === 'employee') void checkEmployeeReminder(userId);
    else void checkAdminReminder();
  };
  check();
  const interval = setInterval(check, 15 * 60 * 1000);
  return () => clearInterval(interval);
}
```

- [ ] **Step 7: Wire into both layouts**

In `src/routes/employee/+layout.svelte`, extend the existing `<script>` block from Task 5:

```svelte
<script lang="ts">
  import NavRail from '$lib/components/NavRail.svelte';
  import { page } from '$app/state';
  import { onMount, onDestroy } from 'svelte';
  import { initWebPush } from '$lib/push';
  import { initAndroidReminders } from '$lib/androidReminders';

  let { children } = $props();

  const links = [
    { href: '/employee/dashboard', label: 'Dashboard' },
    { href: '/employee/history', label: 'History' },
    { href: '/employee/settings', label: 'Settings' }
  ];

  let stopAndroidReminders: () => void = () => {};

  onMount(() => {
    const userId = page.data.profile?.id;
    if (userId) {
      void initWebPush(userId);
      stopAndroidReminders = initAndroidReminders(userId, 'employee');
    }
  });
  onDestroy(() => stopAndroidReminders());
</script>
```

Apply the same pattern to `src/routes/admin/+layout.svelte`, with `initAndroidReminders(userId, 'admin')` and its own `links` array unchanged.

- [ ] **Step 8: Verify**

Run: `npm run check`
Expected: 0 errors.

Run: `npm run build`
Expected: clean build.

Note: the Android build itself (`tauri android build`) needs the Android SDK/NDK and is only exercised by CI's `android` job (`.github/workflows/release.yml`) — this task's verification is `cargo check` + `npm run check`/`build`, consistent with how prior Android-touching work in this project was validated locally.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json package-lock.json src/lib/androidReminders.ts src/routes/employee/+layout.svelte src/routes/admin/+layout.svelte
git commit -m "feat: add Android in-app fallback for 9am/10:30am reminders"
```

---

### Task 8: CI env var + README setup instructions

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `PUBLIC_VAPID_PUBLIC_KEY` (Task 5), `CRON_SECRET`/`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (Task 6).
- Produces: nothing — this is the last task, documentation + CI wiring only.

- [ ] **Step 1: Add the VAPID public key to CI**

In `.github/workflows/release.yml`, the top-level `env:` block currently reads:

```yaml
env:
  PUBLIC_SUPABASE_URL: ${{ secrets.PUBLIC_SUPABASE_URL }}
  PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.PUBLIC_SUPABASE_ANON_KEY }}
```

Add a third line:

```yaml
env:
  PUBLIC_SUPABASE_URL: ${{ secrets.PUBLIC_SUPABASE_URL }}
  PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.PUBLIC_SUPABASE_ANON_KEY }}
  PUBLIC_VAPID_PUBLIC_KEY: ${{ secrets.PUBLIC_VAPID_PUBLIC_KEY }}
```

- [ ] **Step 2: Add a README section for push reminder setup**

Insert a new `## Push reminders setup` section in `README.md` immediately after the existing `## Release (deploying to production)` section (i.e. right before `## Signing the Android build`):

```markdown
## Push reminders setup

Employees get a push at 9am (Asia/Dhaka) if they haven't ordered yet; admins get
one at 10:30am if ordering is still open. Real push for web/desktop; Android
shows the same reminder only while the app is open (see "Making this repo
public" below for why — no Firebase project is used).

1. **Generate a VAPID keypair** (needed once):
   ```bash
   npx web-push generate-vapid-keys
   ```
2. **Frontend public key** — add to Vercel's project environment variables and
   to this repo's GitHub Actions secrets (Settings → Secrets and variables →
   Actions):
   - `PUBLIC_VAPID_PUBLIC_KEY` — the "Public Key" from step 1
3. **Edge function secrets** — `npx supabase secrets set`:
   - `VAPID_PUBLIC_KEY` — same public key as above
   - `VAPID_PRIVATE_KEY` — the "Private Key" from step 1
   - `VAPID_SUBJECT` — `mailto:<your admin email>`
   - `CRON_SECRET` — any random string, e.g. `openssl rand -hex 32`
4. **Deploy the function:** `npx supabase functions deploy send-reminders`
5. **Schedule the two cron jobs** — Supabase Dashboard → Database → Cron Jobs
   → Create job, twice:
   - Name `employee-reminder`, schedule `0 3 * * *` (9:00 Asia/Dhaka), HTTP
     request to `https://<project-ref>.supabase.co/functions/v1/send-reminders`,
     header `x-cron-secret: <the CRON_SECRET value>`, body `{"kind":"employee-reminder"}`
   - Name `admin-reminder`, schedule `30 4 * * *` (10:30 Asia/Dhaka), same URL
     and header, body `{"kind":"admin-reminder"}`
```

- [ ] **Step 3: Verify the README renders sensibly**

Run: `grep -n "^## " README.md`
Expected: `## Push reminders setup` appears between `## Release (deploying to production)` and `## Signing the Android build`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml README.md
git commit -m "docs: add push reminder setup instructions and CI env var"
```
