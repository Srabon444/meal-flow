# Admin Self-Order and Extended 9am Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin can mark themselves as eating today and see their own balance (same as an employee); the 9am "haven't ordered" reminder now also reaches admins; the existing Android-only foreground reminder fallback is extended to desktop Tauri builds too.

**Architecture:** Extract the employee dashboard's order-ticket+balance+chart markup into a shared `MealOrderCard.svelte` component, reused by both the employee dashboard (unchanged behavior) and a new section on the admin dashboard. Broaden the `send-reminders` edge function's employee-reminder query to include admin profiles. Generalize the existing Android foreground-reminder loop (`androidReminders.ts`) to run on any Tauri build, renaming it `nativeReminders.ts`, and make it run the "haven't ordered" check for admins too.

**Tech Stack:** SvelteKit 5 (runes), Supabase Postgres/RLS (unchanged — no migration in this plan), Supabase Edge Functions (Deno), `@tauri-apps/plugin-notification` (already cross-platform, already a dependency).

## Global Constraints

- No DB schema/RLS/trigger change in this plan. Confirmed by reading
  `supabase/migrations/20260731154045_rls.sql` (`meal_entries_insert_own` checks only
  `user_id = auth.uid()`, no role restriction) and
  `supabase/migrations/20260801111443_ordering_pause.sql`'s
  `enforce_meal_entry_invariants()` (checks `active`/pause/rate for any `user_id`,
  role-agnostic). Admin profiles already default `active = true`.
- `send-reminders`'s cron `kind` values (`"employee-reminder"`, `"admin-reminder"`)
  stay unchanged — they're referenced by an already-configured Supabase Dashboard Cron
  Job outside this repo; renaming them would silently break that job.
- Use `npm run check` (svelte-check), never `npx tsc --noEmit` alone — this project's
  established rule, `tsc` alone skips `.svelte` files entirely.
- No new vitest file in this plan — no new pure-logic function is introduced (the
  reminder-check and balance-math functions are relocated/reused, not changed in
  behavior). Existing `meals.test.ts`/`guards.test.ts` must keep passing.
- `@tauri-apps/plugin-notification` and its permission (`notification:default` in
  `src-tauri/capabilities/default.json`) are already installed/granted with no
  platform restriction — confirmed by reading `src-tauri/Cargo.toml` and
  `src-tauri/capabilities/default.json`. No Tauri config change needed.

---

### Task 1: Extract `MealOrderCard` component, use it on the employee dashboard

**Files:**
- Create: `src/lib/components/MealOrderCard.svelte`
- Modify: `src/routes/employee/dashboard/+page.svelte`

**Interfaces:**
- Produces: `MealOrderCard` Svelte component, prop `userId: string`. Renders the full
  order-ticket + balance + due-donut-chart UI, self-contained (owns its own data
  loading and the `markEating()` handler). Consumed by Task 2 (admin dashboard).

- [ ] **Step 1: Write the component**

Create `src/lib/components/MealOrderCard.svelte` with exactly the employee
dashboard's current script and markup, minus the page header, with `userId` now a
prop instead of read from `page.data.profile.id` directly:

```svelte
<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { pickActiveRate, computeBalance, localToday } from '$lib/meals';
  import { onMount, onDestroy, tick } from 'svelte';
  import { Chart, DoughnutController, ArcElement, Tooltip, Legend } from 'chart.js';

  Chart.register(DoughnutController, ArcElement, Tooltip, Legend);

  let { userId }: { userId: string } = $props();

  type TodayEntry = { id: string; entry_date: string; status: string; rate_applied: number };

  let loading = $state(true);
  let activeRate = $state<number | null>(null);
  let todayEntry = $state<TodayEntry | null>(null);
  let balance = $state({ totalEaten: 0, totalCost: 0, totalPaid: 0, due: 0 });
  let marking = $state(false);
  let error = $state('');
  let loadError = $state('');
  let paused = $state(false);
  let donutCanvas: HTMLCanvasElement | undefined;
  let donutChart: Chart | null = null;

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
    await tick();
    donutChart?.destroy();
    donutChart = null;
    if (balance.due > 0 && donutCanvas) {
      donutChart = new Chart(donutCanvas, {
        type: 'doughnut',
        data: {
          labels: ['Paid', 'Due'],
          datasets: [{ data: [balance.totalPaid, balance.due], backgroundColor: ['#5b7553', '#c4432b'] }]
        },
        options: { responsive: true }
      });
    }
  }

  onMount(load);
  onDestroy(() => donutChart?.destroy());

  async function markEating() {
    if (marking) return;
    if (activeRate === null) return;
    marking = true;
    error = '';
    // rate_applied is recomputed server-side by a trigger; this value is only a hint.
    const { error: insertError } = await supabase
      .from('meal_entries')
      .insert({ user_id: userId, entry_date: localToday(), rate_applied: activeRate });
    marking = false;
    if (insertError) {
      error = insertError.message;
      return;
    }
    await load();
  }
</script>

{#if loading}
  <p class="text-sm text-ink/50">Loading…</p>
{:else if loadError}
  <p class="text-sm text-stamp-dark">{loadError}</p>
{:else}
  <div class="grid gap-10 md:grid-cols-[320px_1fr] items-start">
    <div class="ticket pt-8 pb-6 px-6">
      {#if todayEntry?.status === 'CONFIRMED'}
        <p class="font-display text-[11px] tracking-widest text-sage uppercase mb-2">Marked</p>
        <p class="text-sm">You're eating today. Charged at {todayEntry.rate_applied.toFixed(2)}.</p>
      {:else if todayEntry}
        <!-- unique(user_id, entry_date) means a cancelled day can't be re-marked. -->
        <p class="font-display text-[11px] tracking-widest text-ink/50 uppercase mb-2">Cancelled</p>
        <p class="text-sm text-ink/60">Today's entry was cancelled.</p>
      {:else if paused}
        <img src="/order-closed-employee.png" alt="Ordering closed for today" class="w-full mx-auto" />
      {:else if activeRate === null}
        <p class="font-display text-[11px] tracking-widest text-stamp uppercase mb-2">No rate set</p>
        <p class="text-sm text-ink/60">Ask your admin to set a meal rate first.</p>
      {:else}
        <p class="font-display text-[11px] tracking-widest text-ink/60 uppercase mb-3">Eating today?</p>
        {#if error}<p class="text-sm text-stamp-dark mb-3">{error}</p>{/if}
        <button
          onclick={markEating}
          disabled={marking}
          class="flex flex-col items-center gap-2 mx-auto disabled:opacity-50 hover:brightness-105 transition-[filter]"
        >
          <img src="/order-button.png" alt="Order now" class="w-full max-w-70" />
          <span class="font-display text-xs tracking-wide text-ink/50">
            {marking ? 'Marking…' : `Charged at ${activeRate.toFixed(2)}`}
          </span>
        </button>
      {/if}
    </div>

    <div>
      <p class="font-display text-[11px] tracking-widest text-ink/50 uppercase mb-3">Balance</p>
      <dl class="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt class="text-ink/50">Meals eaten</dt>
          <dd class="font-display text-lg">{balance.totalEaten}</dd>
        </div>
        <div>
          <dt class="text-ink/50">Total cost</dt>
          <dd class="font-display text-lg">{balance.totalCost.toFixed(2)}</dd>
        </div>
        <div>
          <dt class="text-ink/50">Total paid</dt>
          <dd class="font-display text-lg">{balance.totalPaid.toFixed(2)}</dd>
        </div>
        <div>
          <dt class="text-ink/50">Due</dt>
          <dd class="font-display text-lg {balance.due > 0 ? 'text-stamp' : 'text-sage'}">{balance.due.toFixed(2)}</dd>
        </div>
      </dl>
      {#if balance.due > 0}
        <div class="mt-6 max-w-xs">
          <canvas bind:this={donutCanvas} height="160"></canvas>
        </div>
      {:else}
        <p class="mt-6 text-sm text-sage">
          {balance.due < 0 ? `Credit of ${(-balance.due).toFixed(2)}` : 'Paid in full'}
        </p>
      {/if}
    </div>
  </div>
{/if}
```

- [ ] **Step 2: Shrink the employee dashboard to use it**

Replace the entire contents of `src/routes/employee/dashboard/+page.svelte` with:

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import MealOrderCard from '$lib/components/MealOrderCard.svelte';
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Today</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Welcome, {page.data.profile?.name}</h1>
</div>

<MealOrderCard userId={page.data.profile?.id} />
```

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 4: Manual verification**

```bash
npm run build && npm run preview
```
Log in as an employee (any seeded employee account, or create one via
`/admin/employees`). Confirm `/employee/dashboard` looks and behaves identically to
before: mark eating, balance numbers update, donut chart renders when `due > 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/MealOrderCard.svelte src/routes/employee/dashboard/+page.svelte
git commit -m "refactor: extract MealOrderCard from employee dashboard"
```

---

### Task 2: Admin can order their own meal

**Files:**
- Modify: `src/routes/admin/dashboard/+page.svelte`

**Interfaces:**
- Consumes: `MealOrderCard` from Task 1.

- [ ] **Step 1: Add the import**

In `src/routes/admin/dashboard/+page.svelte`, add to the existing `<script>` block's
imports (alongside `import { supabase } from '$lib/supabase';`):

```svelte
import MealOrderCard from '$lib/components/MealOrderCard.svelte';
```

- [ ] **Step 2: Add the "Your meal" section**

Insert this block immediately after the existing header `<div class="mb-8">…</div>`
(the "Tally / Who's eating" heading) and before the existing `<div class="ticket mb-8 px-6 py-5">` "Ordering" section:

```svelte
<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Your meal</p>
  <MealOrderCard userId={adminId} />
</div>
```

(`adminId` already exists in this file's script as
`const adminId = page.data.profile?.id as string;` — no new variable needed.)

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 4: Manual verification**

```bash
npm run build && npm run preview
```
Log in as the seeded admin (`admin@example.com` / `admin1234`). On `/admin/dashboard`,
confirm a new "Your meal" section appears above "Ordering", showing the same
mark-eating ticket and balance panel an employee sees. Mark eating as admin, confirm
the entry shows up in the tally list below (the existing "who's eating" roster) for
today's date, and confirm the admin's own balance numbers update.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin/dashboard/+page.svelte
git commit -m "feat: admin can order their own meal from the admin dashboard"
```

---

### Task 3: 9am reminder also targets admins

**Files:**
- Modify: `supabase/functions/send-reminders/index.ts`

**Interfaces:**
- Consumes: `profiles` table (`role`, `active` columns, unchanged).

- [ ] **Step 1: Broaden the employee-reminder query**

In `supabase/functions/send-reminders/index.ts`, inside the `if (kind === 'employee-reminder')` branch, change:

```ts
        client.from('profiles').select('id').eq('role', 'employee').eq('active', true),
```

to:

```ts
        // Admins can now self-order too (see admin dashboard's "Your meal" card),
        // so they get this same "haven't ordered" nudge, on top of their separate
        // 10:30am "ordering still open" reminder below.
        client.from('profiles').select('id').in('role', ['employee', 'admin']).eq('active', true),
```

- [ ] **Step 2: Local exploit-test — admin now included**

Requires local Supabase running (`npx supabase start`) and the function served:

```bash
npx supabase secrets set --env-file - <<'EOF'
CRON_SECRET=local-test-secret
VAPID_PUBLIC_KEY=local-test-public
VAPID_PRIVATE_KEY=local-test-private
EOF
npx supabase functions serve send-reminders
```

In another terminal, get the admin's id and confirm they have no `meal_entries` row
for today (fresh local DB after `supabase db reset` has none), then call the function
and check the response includes work done without error:

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "http://127.0.0.1:54321/functions/v1/send-reminders" \
  -H "Content-Type: application/json" -H "x-cron-secret: local-test-secret" \
  -d '{"kind":"employee-reminder"}'
```

Expected: `HTTP_STATUS:200`. To confirm the admin is actually now in the target set
(not just that the call succeeds), temporarily add `console.log(targetUserIds)` after
the `targetUserIds = ...` assignment in the employee-reminder branch, re-run the
`functions serve` command, repeat the curl call, and check the served function's
terminal output includes the seeded admin's id (get it via
`select id from profiles where email = 'admin@example.com';` in `npx supabase db
psql` or the Studio SQL editor). Remove the temporary `console.log` before committing.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-reminders/index.ts
git commit -m "feat: include admins in the 9am haven't-ordered reminder"
```

Note: this edge function change has no effect in production until redeployed —
`npx supabase functions deploy send-reminders` — same manual step this project's
existing edge functions already require (see README).

---

### Task 4: Extend the foreground reminder fallback to desktop

**Files:**
- Rename: `src/lib/androidReminders.ts` → `src/lib/nativeReminders.ts`
- Modify: `src/routes/employee/+layout.svelte`
- Modify: `src/routes/admin/+layout.svelte`

**Interfaces:**
- Produces: `initNativeReminders(userId: string, role: 'employee' | 'admin'): () => void`
  (renamed from `initAndroidReminders`), consumed by both layouts.

- [ ] **Step 1: Rename the file**

```bash
git mv src/lib/androidReminders.ts src/lib/nativeReminders.ts
```

- [ ] **Step 2: Generalize the platform gate and the admin check**

In `src/lib/nativeReminders.ts`, add a new helper next to the existing
`isTauriAndroid()`:

```ts
function isTauriNative(): boolean {
  return '__TAURI_INTERNALS__' in window;
}
```

Replace the exported function at the bottom of the file:

```ts
export function initAndroidReminders(userId: string, role: 'employee' | 'admin'): () => void {
  if (!isTauriAndroid()) return () => {};
  const check = () => {
    if (role === 'employee') void checkEmployeeReminder(userId);
    else void checkAdminReminder(userId);
  };
  check();
  const interval = setInterval(check, 15 * 60 * 1000);
  const stopBroadcastListener = role === 'employee' ? initOrderBroadcastListener() : () => {};
  return () => {
    clearInterval(interval);
    stopBroadcastListener();
  };
}
```

with:

```ts
/** Starts the foreground reminder loop: everyone gets the 9am "haven't ordered"
 *  check, admins additionally get the 10:30am "ordering still open" check. Runs on
 *  any Tauri build (desktop or Android) — web already gets real push instead (see
 *  push.ts). The on-demand order-broadcast listener and FCM stay Android-only:
 *  desktop has no FCM registration and wasn't asked to get the on-demand broadcast,
 *  only this scheduled check. Returns a cleanup function for onDestroy. */
export function initNativeReminders(userId: string, role: 'employee' | 'admin'): () => void {
  if (!isTauriNative()) return () => {};
  const check = () => {
    void checkEmployeeReminder(userId);
    if (role === 'admin') void checkAdminReminder(userId);
  };
  check();
  const interval = setInterval(check, 15 * 60 * 1000);
  const stopBroadcastListener = role === 'employee' && isTauriAndroid() ? initOrderBroadcastListener() : () => {};
  return () => {
    clearInterval(interval);
    stopBroadcastListener();
  };
}
```

Leave every other function in the file (`ensureOrderBroadcastChannel`, `isTauriAndroid`,
`alreadyNotifiedToday`, `markNotifiedToday`, `notifyOnce`, `checkEmployeeReminder`,
`checkAdminReminder`, `initOrderBroadcastListener`) unchanged.

- [ ] **Step 3: Update both layouts**

In `src/routes/employee/+layout.svelte`, change:

```svelte
  import { initAndroidReminders } from '$lib/androidReminders';
```
to
```svelte
  import { initNativeReminders } from '$lib/nativeReminders';
```

and change every occurrence of `stopAndroidReminders` to `stopNativeReminders`, and
`initAndroidReminders(userId, 'employee')` to `initNativeReminders(userId, 'employee')`.
The full script block becomes:

```svelte
<script lang="ts">
  import NavRail from '$lib/components/NavRail.svelte';
  import { page } from '$app/state';
  import { onMount, onDestroy } from 'svelte';
  import { initWebPush } from '$lib/push';
  import { initNativeReminders } from '$lib/nativeReminders';
  import { initFcm } from '$lib/fcm';

  let { children } = $props();

  const links = [
    { href: '/employee/dashboard', label: 'Dashboard' },
    { href: '/employee/history', label: 'History' },
    { href: '/employee/settings', label: 'Settings' }
  ];

  let stopNativeReminders: () => void = () => {};
  let stopFcm: () => void = () => {};

  onMount(() => {
    const userId = page.data.profile?.id;
    if (userId) {
      initWebPush(userId).catch((e) => console.error('push init failed', e));
      stopNativeReminders = initNativeReminders(userId, 'employee');
      initFcm(userId)
        .then((stop) => (stopFcm = stop))
        .catch((e) => console.error('fcm init failed', e));
    }
  });
  onDestroy(() => {
    stopNativeReminders();
    stopFcm();
  });
</script>
```

Apply the identical rename pattern to `src/routes/admin/+layout.svelte`
(`initNativeReminders(userId, 'admin')`, same `links` array, unchanged otherwise):

```svelte
<script lang="ts">
  import NavRail from '$lib/components/NavRail.svelte';
  import { page } from '$app/state';
  import { onMount, onDestroy } from 'svelte';
  import { initWebPush } from '$lib/push';
  import { initNativeReminders } from '$lib/nativeReminders';
  import { initFcm } from '$lib/fcm';

  let { children } = $props();

  const links = [
    { href: '/admin/dashboard', label: 'Dashboard' },
    { href: '/admin/rate', label: 'Rate' },
    { href: '/admin/cancel-requests', label: 'Requests' },
    { href: '/admin/employees', label: 'Employees' },
    { href: '/admin/reports', label: 'Reports' },
    { href: '/admin/settings', label: 'Settings' }
  ];

  let stopNativeReminders: () => void = () => {};
  let stopFcm: () => void = () => {};

  onMount(() => {
    const userId = page.data.profile?.id;
    if (userId) {
      initWebPush(userId).catch((e) => console.error('push init failed', e));
      stopNativeReminders = initNativeReminders(userId, 'admin');
      initFcm(userId)
        .then((stop) => (stopFcm = stop))
        .catch((e) => console.error('fcm init failed', e));
    }
  });
  onDestroy(() => {
    stopNativeReminders();
    stopFcm();
  });
</script>
```

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: 0 errors.

Run: `npm test`
Expected: existing `meals.test.ts`/`guards.test.ts` still pass (untouched by this
task, confirms nothing else broke).

- [ ] **Step 5: Manual verification (desktop)**

```bash
npm run build && npm run tauri dev
```
Sign in on the desktop app as an employee whose local system clock reads past 9am and
who has no confirmed entry for today. Within 15 minutes (or restart the dev app to
force the immediate on-load check), a native OS notification should appear ("You
haven't ordered today yet."). This wasn't possible before this task — confirms the
gap this task closes. (Android device verification, if available, follows the same
pattern as before — unaffected by this change.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/nativeReminders.ts src/routes/employee/+layout.svelte src/routes/admin/+layout.svelte
git commit -m "feat: extend foreground reminder fallback to desktop, add admin 9am check"
```

---

### Task 5: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the "Push reminders setup" intro paragraph**

Replace:

```markdown
Employees get a push at 9am (Asia/Dhaka) if they haven't ordered yet; admins get
one at 10:30am if ordering is still open. Real push for the web app and for
Android (via Firebase Cloud Messaging, see below — delivered even if the app
is fully closed). Desktop's webview generally lacks push service support, so
desktop builds currently show no background reminder.
```

with:

```markdown
Employees and admins both get a push at 9am (Asia/Dhaka) if they haven't ordered
yet (admins can now order their own meal too, from the admin dashboard); admins
additionally get one at 10:30am if ordering is still open. Real push for the web
app and for Android (via Firebase Cloud Messaging, see below — delivered even if
the app is fully closed). Desktop's webview lacks push service support for
background delivery — while the desktop app is open (foreground or running in the
background), it falls back to the same local-notification check Android used
before FCM was added. There is still no notification if the desktop app is fully
closed.
```

- [ ] **Step 2: Verify**

Run: `grep -n "Desktop's webview" README.md`
Expected: one match, showing the updated sentence.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update push reminder description for admin + desktop fallback"
```
