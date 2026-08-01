# Employee Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the employee-facing meal ordering flow — mark today's meal, view history, request cancellations, see balance — on top of Foundation's existing schema/RLS/auth.

**Architecture:** No schema or RLS changes — Foundation already has `meal_entries`, `meal_rates`, `cancel_requests`, `payments` tables with RLS scoping employees to their own rows. This sub-project is pure frontend: two pure/testable helper functions (`pickActiveRate`, `computeBalance`) plus three Svelte routes that call Supabase directly, matching the pattern already established in `src/routes/admin/employees/+page.svelte`.

**Tech Stack:** SvelteKit (existing), Supabase client (existing), Vitest.

## Global Constraints

- No cutoff time enforcement (Foundation decision, carried over).
- `meal_entries.rate_applied` is `NOT NULL` — entry creation must be blocked with a clear message when no `meal_rates` row applies yet, never silently defaulted.
- Balance is computed client-side from two RLS-scoped selects (own `meal_entries` + own `payments`) — no new DB view or function.
- Comments 1-2 lines max, only when the why isn't obvious. No AI/Claude co-author trailer on any commit.
- Small, frequent commits; push after each task.

---

## File Structure

```
src/lib/
  meals.ts                        -> pickActiveRate, computeBalance (pure functions)
  meals.test.ts
  components/
    NavRail.svelte                 -> extracted shared nav (used by admin AND employee layouts)
src/routes/
  admin/+layout.svelte             -> MODIFIED: uses NavRail instead of inline markup
  employee/+layout.svelte          -> NEW: uses NavRail with employee links
  employee/dashboard/+page.svelte  -> MODIFIED: replaces placeholder with real dashboard
  employee/history/+page.svelte    -> NEW: past entries + cancel-request UI
```

---

### Task 1: `pickActiveRate` and `computeBalance` (TDD)

**Files:**
- Create: `src/lib/meals.ts`
- Create: `src/lib/meals.test.ts`

**Interfaces:**
- Produces: `pickActiveRate(rates: { rate: number; effective_from: string }[], today: string): number | null`
- Produces: `computeBalance(entries: { rate_applied: number; status: string }[], payments: { amount: number }[]): { totalEaten: number; totalCost: number; totalPaid: number; due: number }`

- [ ] **Step 1: Write the failing tests**

`src/lib/meals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickActiveRate, computeBalance } from './meals';

describe('pickActiveRate', () => {
  it('returns null when no rates exist', () => {
    expect(pickActiveRate([], '2026-08-01')).toBeNull();
  });

  it('returns null when all rates start after today', () => {
    expect(pickActiveRate([{ rate: 100, effective_from: '2026-09-01' }], '2026-08-01')).toBeNull();
  });

  it('picks the most recent rate that has already started', () => {
    const rates = [
      { rate: 100, effective_from: '2026-01-01' },
      { rate: 120, effective_from: '2026-07-01' },
      { rate: 150, effective_from: '2026-09-01' }
    ];
    expect(pickActiveRate(rates, '2026-08-01')).toBe(120);
  });
});

describe('computeBalance', () => {
  it('returns zeros with no entries or payments', () => {
    expect(computeBalance([], [])).toEqual({ totalEaten: 0, totalCost: 0, totalPaid: 0, due: 0 });
  });

  it('only counts CONFIRMED entries toward eaten/cost', () => {
    const entries = [
      { rate_applied: 100, status: 'CONFIRMED' },
      { rate_applied: 100, status: 'CANCELLED' }
    ];
    expect(computeBalance(entries, [])).toEqual({ totalEaten: 1, totalCost: 100, totalPaid: 0, due: 100 });
  });

  it('subtracts total payments from total cost to get due', () => {
    const entries = [{ rate_applied: 100, status: 'CONFIRMED' }];
    const payments = [{ amount: 60 }];
    expect(computeBalance(entries, payments)).toEqual({ totalEaten: 1, totalCost: 100, totalPaid: 60, due: 40 });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test:unit -- --run`
Expected: FAIL — `src/lib/meals.ts` does not exist.

- [ ] **Step 3: Implement**

`src/lib/meals.ts`:

```ts
export type Rate = { rate: number; effective_from: string };
export type Entry = { rate_applied: number; status: string };
export type Payment = { amount: number };
export type Balance = { totalEaten: number; totalCost: number; totalPaid: number; due: number };

export function pickActiveRate(rates: Rate[], today: string): number | null {
  const applicable = rates.filter((r) => r.effective_from <= today);
  if (applicable.length === 0) return null;
  applicable.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  return applicable[0].rate;
}

export function computeBalance(entries: Entry[], payments: Payment[]): Balance {
  const confirmed = entries.filter((e) => e.status === 'CONFIRMED');
  const totalEaten = confirmed.length;
  const totalCost = confirmed.reduce((sum, e) => sum + e.rate_applied, 0);
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  return { totalEaten, totalCost, totalPaid, due: totalCost - totalPaid };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm run test:unit -- --run`
Expected: PASS, 6/6 (3 existing guard tests + 6 new — wait, expect 3 + 6 = 9 total. State this exactly: existing suite has 3 tests (guards.test.ts); this adds 6 more (3 pickActiveRate + 3 computeBalance); total after this task is 9/9).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meals.ts src/lib/meals.test.ts
git commit -m "feat: add pickActiveRate and computeBalance helpers"
```

---

### Task 2: Extract shared NavRail, add employee layout

**Files:**
- Create: `src/lib/components/NavRail.svelte`
- Modify: `src/routes/admin/+layout.svelte`
- Create: `src/routes/employee/+layout.svelte`

**Interfaces:**
- Produces: `NavRail` component, prop `links: { href: string; label: string }[]`. Renders the wordmark, active-tab-highlighted nav links, and a sign-out button that calls `supabase.auth.signOut()` then redirects to `/login`.
- Consumes: `page` from `$app/state`, `supabase` from `$lib/supabase` (both already used elsewhere in the codebase).

- [ ] **Step 1: Create the shared component**

`src/lib/components/NavRail.svelte`:

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase';

  let { links }: { links: { href: string; label: string }[] } = $props();

  function isActive(href: string) {
    return page.url.pathname === href;
  }

  async function signOut() {
    await supabase.auth.signOut();
    await goto('/login');
  }
</script>

<header class="border-b border-line bg-paper">
  <div class="max-w-4xl mx-auto px-6 flex items-center justify-between h-16">
    <span class="font-display font-bold text-sm tracking-wide">OFFICEMEAL</span>

    <nav class="flex items-center gap-1">
      {#each links as link (link.href)}
        <a
          href={link.href}
          class="font-display text-xs tracking-widest uppercase px-3 py-2 border-b-2 transition-colors {isActive(
            link.href
          )
            ? 'border-stamp text-ink'
            : 'border-transparent text-ink/50 hover:text-ink'}"
        >
          {link.label}
        </a>
      {/each}
    </nav>

    <button
      onclick={signOut}
      class="font-display text-xs tracking-widest uppercase text-ink/50 hover:text-stamp transition-colors"
    >
      Sign out
    </button>
  </div>
</header>
```

- [ ] **Step 2: Refactor the admin layout to use it**

Replace the full contents of `src/routes/admin/+layout.svelte`:

```svelte
<script lang="ts">
  import NavRail from '$lib/components/NavRail.svelte';

  let { children } = $props();

  const links = [
    { href: '/admin/dashboard', label: 'Dashboard' },
    { href: '/admin/employees', label: 'Employees' }
  ];
</script>

<div class="min-h-screen">
  <NavRail {links} />
  <main class="max-w-4xl mx-auto px-6 py-10">
    {@render children()}
  </main>
</div>
```

- [ ] **Step 3: Create the employee layout**

`src/routes/employee/+layout.svelte`:

```svelte
<script lang="ts">
  import NavRail from '$lib/components/NavRail.svelte';

  let { children } = $props();

  const links = [
    { href: '/employee/dashboard', label: 'Dashboard' },
    { href: '/employee/history', label: 'History' }
  ];
</script>

<div class="min-h-screen">
  <NavRail {links} />
  <main class="max-w-4xl mx-auto px-6 py-10">
    {@render children()}
  </main>
</div>
```

- [ ] **Step 4: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both exit 0. Manually confirm `build/admin/dashboard.html` and `build/employee/dashboard.html` both still exist (prerendering still covers both sections).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/NavRail.svelte src/routes/admin/+layout.svelte src/routes/employee/+layout.svelte
git commit -m "refactor: extract shared NavRail, add employee nav layout"
```

---

### Task 3: Employee dashboard — mark today, show balance

**Files:**
- Modify: `src/routes/employee/dashboard/+page.svelte` (replaces the Foundation placeholder entirely)

**Interfaces:**
- Consumes: `pickActiveRate`, `computeBalance` from `$lib/meals` (Task 1); `page.data.profile` (`{ id, name, role }`, from root layout, already flowing through `employee/+layout.ts`'s guard).
- Produces: nothing consumed by later tasks in this plan.

- [ ] **Step 1: Replace the page**

`src/routes/employee/dashboard/+page.svelte`:

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import { supabase } from '$lib/supabase';
  import { pickActiveRate, computeBalance } from '$lib/meals';
  import { onMount } from 'svelte';

  const today = new Date().toISOString().slice(0, 10);
  const userId = page.data.profile?.id as string;

  type TodayEntry = { id: string; entry_date: string; status: string; rate_applied: number };

  let loading = $state(true);
  let activeRate = $state<number | null>(null);
  let todayEntry = $state<TodayEntry | null>(null);
  let balance = $state({ totalEaten: 0, totalCost: 0, totalPaid: 0, due: 0 });
  let marking = $state(false);
  let error = $state('');

  async function load() {
    loading = true;
    const [ratesRes, entriesRes, paymentsRes] = await Promise.all([
      supabase.from('meal_rates').select('rate, effective_from'),
      supabase.from('meal_entries').select('id, entry_date, status, rate_applied').eq('user_id', userId),
      supabase.from('payments').select('amount').eq('user_id', userId)
    ]);

    activeRate = pickActiveRate(ratesRes.data ?? [], today);
    todayEntry = (entriesRes.data ?? []).find((e) => e.entry_date === today) ?? null;
    balance = computeBalance(entriesRes.data ?? [], paymentsRes.data ?? []);
    loading = false;
  }

  onMount(load);

  async function markEating() {
    if (activeRate === null) return;
    marking = true;
    error = '';
    const { error: insertError } = await supabase
      .from('meal_entries')
      .insert({ user_id: userId, entry_date: today, rate_applied: activeRate });
    marking = false;
    if (insertError) {
      error = insertError.message;
      return;
    }
    await load();
  }
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Today</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Welcome, {page.data.profile?.name}</h1>
</div>

{#if loading}
  <p class="text-sm text-ink/50">Loading…</p>
{:else}
  <div class="grid gap-10 md:grid-cols-[320px_1fr] items-start">
    <div class="ticket pt-8 pb-6 px-6">
      {#if todayEntry}
        <p class="font-display text-[11px] tracking-widest text-sage uppercase mb-2">Marked</p>
        <p class="text-sm">You're eating today. Charged at {todayEntry.rate_applied}.</p>
      {:else if activeRate === null}
        <p class="font-display text-[11px] tracking-widest text-stamp uppercase mb-2">No rate set</p>
        <p class="text-sm text-ink/60">Ask your admin to set a meal rate first.</p>
      {:else}
        <p class="font-display text-[11px] tracking-widest text-ink/60 uppercase mb-3">Eating today?</p>
        {#if error}<p class="text-sm text-stamp-dark mb-3">{error}</p>{/if}
        <button
          onclick={markEating}
          disabled={marking}
          class="font-display text-sm tracking-wide bg-stamp text-paper px-5 py-2.5 rounded-sm hover:bg-stamp-dark transition-colors disabled:opacity-50 w-full"
        >
          {marking ? 'Marking…' : `Yes, count me in (${activeRate}) →`}
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
          <dd class="font-display text-lg">{balance.totalCost}</dd>
        </div>
        <div>
          <dt class="text-ink/50">Total paid</dt>
          <dd class="font-display text-lg">{balance.totalPaid}</dd>
        </div>
        <div>
          <dt class="text-ink/50">Due</dt>
          <dd class="font-display text-lg {balance.due > 0 ? 'text-stamp' : 'text-sage'}">{balance.due}</dd>
        </div>
      </dl>
    </div>
  </div>
{/if}
```

- [ ] **Step 2: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both exit 0.

- [ ] **Step 3: Manual verification against the live Supabase project**

Using the production project (already linked via `supabase link` earlier in this project):
1. As admin, ensure at least one `meal_rates` row exists with `effective_from` on or before today (insert one via SQL Editor if not: `insert into meal_rates (rate, effective_from, created_by) values (150, '2026-01-01', '<admin id>');`).
2. Log in as an employee, visit `/employee/dashboard`.
3. Confirm the "Eating today?" button shows the correct rate, click it, confirm it flips to "You're eating today. Charged at 150." and the balance numbers update.
4. Refresh the page — confirm the marked state persists (re-fetches from `meal_entries`).

- [ ] **Step 4: Commit**

```bash
git add src/routes/employee/dashboard/+page.svelte
git commit -m "feat: build employee dashboard (mark today, balance summary)"
```

---

### Task 4: Employee history — past entries + cancel requests

**Files:**
- Create: `src/routes/employee/history/+page.svelte`

**Interfaces:**
- Consumes: `page.data.profile.id`, `supabase` client (both already established patterns).

- [ ] **Step 1: Create the page**

`src/routes/employee/history/+page.svelte`:

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

  const userId = page.data.profile?.id as string;

  let entries = $state<Entry[]>([]);
  let requests = $state<CancelRequest[]>([]);
  let loading = $state(true);
  let requestingId = $state<string | null>(null);
  let reason = $state('');
  let error = $state('');

  async function load() {
    loading = true;
    const [entriesRes, requestsRes] = await Promise.all([
      supabase
        .from('meal_entries')
        .select('id, entry_date, status, rate_applied')
        .eq('user_id', userId)
        .order('entry_date', { ascending: false }),
      supabase
        .from('cancel_requests')
        .select('id, meal_entry_id, status, reason, created_at')
        .eq('requested_by', userId)
        .order('created_at', { ascending: false })
    ]);
    entries = entriesRes.data ?? [];
    requests = requestsRes.data ?? [];
    loading = false;
  }

  onMount(load);

  function requestedFor(entryId: string) {
    return requests.find((r) => r.meal_entry_id === entryId);
  }

  function startRequest(entryId: string) {
    requestingId = entryId;
    reason = '';
    error = '';
  }

  async function submitRequest(entryId: string) {
    error = '';
    const { error: insertError } = await supabase
      .from('cancel_requests')
      .insert({ meal_entry_id: entryId, requested_by: userId, reason: reason || null });
    if (insertError) {
      error = insertError.message;
      return;
    }
    requestingId = null;
    await load();
  }
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">History</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Your meal entries</h1>
</div>

{#if loading}
  <p class="text-sm text-ink/50">Loading…</p>
{:else if entries.length === 0}
  <p class="text-sm text-ink/50">No entries yet.</p>
{:else}
  <ul class="divide-y divide-line border-t border-b border-line">
    {#each entries as entry (entry.id)}
      {@const existingRequest = requestedFor(entry.id)}
      <li class="py-3">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium">{entry.entry_date}</p>
            <p class="text-xs text-ink/50">
              {entry.status} · charged {entry.rate_applied}
              {#if existingRequest}· cancel {existingRequest.status.toLowerCase()}{/if}
            </p>
          </div>
          {#if entry.status === 'CONFIRMED' && !existingRequest}
            {#if requestingId === entry.id}
              <div class="flex items-center gap-2">
                <button
                  onclick={() => submitRequest(entry.id)}
                  class="font-display text-[11px] tracking-widest uppercase text-stamp hover:text-stamp-dark"
                >
                  Submit
                </button>
                <button
                  onclick={() => (requestingId = null)}
                  class="font-display text-[11px] tracking-widest uppercase text-ink/40 hover:text-ink"
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
        {/if}
      </li>
    {/each}
  </ul>
  {#if error}<p class="mt-3 text-sm text-stamp-dark">{error}</p>{/if}
{/if}
```

- [ ] **Step 2: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both exit 0.

- [ ] **Step 3: Manual verification against the live Supabase project**

1. Log in as the same employee used in Task 3 (who now has at least one CONFIRMED entry from marking today).
2. Visit `/employee/history` — confirm the entry appears with the right date/status/rate.
3. Click "Request cancellation", type a reason, submit — confirm the row's status line now shows "· cancel pending" and the action button disappears for that row.
4. Confirm via Supabase SQL Editor: `select * from cancel_requests where requested_by = '<employee id>';` shows the new row with status PENDING and the typed reason.

- [ ] **Step 4: Commit**

```bash
git add src/routes/employee/history/+page.svelte
git commit -m "feat: build employee history page with cancel-request flow"
```

---

### Task 5: Final verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full automated check**

```bash
npm run test:unit -- --run
npx tsc --noEmit
npm run build
```

Expected: all exit 0. Unit tests: 9/9 (3 guards + 6 meals).

- [ ] **Step 2: Confirm prerendered routes exist**

```bash
ls build/employee/dashboard.html build/employee/history.html
```

Expected: both files exist.

- [ ] **Step 3: End-to-end manual pass against the live Supabase project**

Repeats Task 3/4's manual checks in one pass as a fresh employee account (create one via `/admin/employees` if needed), confirming: dashboard blocks marking when no rate exists (temporarily, if testing that path) or shows the correct rate; marking today works and persists; balance numbers match a hand calculation; history lists the entry; cancel request submits and shows PENDING; RLS still isolates this employee from any other employee's rows (spot-check by comparing two different employee logins, or trust Foundation's `verify-rls.mjs` since no RLS policies changed in this sub-project).

- [ ] **Step 4: Commit (if any fixes were needed) or confirm clean**

If Steps 1-3 required no changes, there's nothing to commit — just confirm `git status` is clean.

---

## Post-plan state

Employees can mark today's meal, see their running balance, review their history, and request cancellations — all backed by Foundation's existing RLS with no schema changes. Admin approval of those cancel requests, rate management, the tally view, and payment recording are sub-project 3.
