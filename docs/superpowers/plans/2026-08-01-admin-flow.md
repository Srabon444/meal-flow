# Admin Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin-facing side of OfficeMeal — rate management, daily tally, cancel-request approval, employee balances + payment recording — completing everything except charts.

**Architecture:** Reuses Foundation's schema/RLS and Employee flow's `$lib/meals.ts` helpers. One new migration adds two `security definer` RPC functions for cancel-request approval (there's no RLS UPDATE policy on `meal_entries`, and adding a broad one would let admin edit `rate_applied` directly — the exact hole Employee flow's final review closed). Everything else is frontend calling existing RLS-permitted operations directly.

**Tech Stack:** SvelteKit (existing), Supabase client + RPC (existing pattern), Vitest.

## Global Constraints

- No AI/Claude co-author trailer on any commit. Comments 1-2 lines max.
- `approve_cancel_request`/`reject_cancel_request` must check `is_admin()` internally — never trust that only the admin UI calls them, since RPC endpoints are directly POST-able like any other PostgREST route.
- Balances computed by grouping client-side via `computeBalancesByUser`, reusing the already-tested `computeBalance` — no new aggregation logic duplicated.
- Small, frequent commits; push after each task.

---

## File Structure

```
src/lib/meals.ts                              -> MODIFIED: add computeBalancesByUser
src/lib/meals.test.ts                          -> MODIFIED: add its tests
supabase/migrations/<ts>_cancel_request_review.sql  -> NEW: approve/reject RPC functions
src/routes/admin/
  +layout.svelte                               -> MODIFIED: nav links grow to Dashboard/Rate/Cancel Requests/Employees
  dashboard/+page.svelte                       -> MODIFIED: replaces placeholder with real tally
  rate/+page.svelte                            -> NEW: set rate + history
  cancel-requests/+page.svelte                 -> NEW: approval queue
  employees/+page.svelte                       -> MODIFIED: adds balances + record payment
```

---

### Task 1: `computeBalancesByUser` (TDD)

**Files:**
- Modify: `src/lib/meals.ts`
- Modify: `src/lib/meals.test.ts`

**Interfaces:**
- Consumes: `computeBalance`, `Entry`, `Payment`, `Balance` types (already in `meals.ts` from Employee flow).
- Produces: `computeBalancesByUser(entries: (Entry & { user_id: string })[], payments: (Payment & { user_id: string })[]): Record<string, Balance>` — later tasks (admin employees page) call this by exact name.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/meals.test.ts`:

```ts
describe('computeBalancesByUser', () => {
  it('groups entries and payments by user_id independently', () => {
    const entries = [
      { user_id: 'a', rate_applied: 100, status: 'CONFIRMED' },
      { user_id: 'b', rate_applied: 200, status: 'CONFIRMED' },
      { user_id: 'a', rate_applied: 100, status: 'CANCELLED' }
    ];
    const payments = [{ user_id: 'a', amount: 50 }];
    const result = computeBalancesByUser(entries, payments);
    expect(result['a']).toEqual({ totalEaten: 1, totalCost: 100, totalPaid: 50, due: 50 });
    expect(result['b']).toEqual({ totalEaten: 1, totalCost: 200, totalPaid: 0, due: 200 });
  });

  it('includes a user who only has payments and no entries', () => {
    const result = computeBalancesByUser([], [{ user_id: 'c', amount: 30 }]);
    expect(result['c']).toEqual({ totalEaten: 0, totalCost: 0, totalPaid: 30, due: -30 });
  });
});
```

Add `computeBalancesByUser` to the existing `import { pickActiveRate, computeBalance } from './meals';` line at the top of the test file.

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test:unit -- --run`
Expected: FAIL — `computeBalancesByUser` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/meals.ts`:

```ts
export function computeBalancesByUser(
  entries: (Entry & { user_id: string })[],
  payments: (Payment & { user_id: string })[]
): Record<string, Balance> {
  const userIds = new Set([...entries.map((e) => e.user_id), ...payments.map((p) => p.user_id)]);
  const result: Record<string, Balance> = {};
  for (const id of userIds) {
    result[id] = computeBalance(
      entries.filter((e) => e.user_id === id),
      payments.filter((p) => p.user_id === id)
    );
  }
  return result;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm run test:unit -- --run`
Expected: PASS. Employee flow left 12 tests; this adds 2, so 14/14 total.

- [ ] **Step 5: Commit**

```bash
git add src/lib/meals.ts src/lib/meals.test.ts
git commit -m "feat: add computeBalancesByUser helper"
```

---

### Task 2: Cancel-request approval RPC functions

**Files:**
- Create: `supabase/migrations/<timestamp>_cancel_request_review.sql`

**Interfaces:**
- Produces: `approve_cancel_request(request_id uuid)` and `reject_cancel_request(request_id uuid)`, both callable via `supabase.rpc('approve_cancel_request', { request_id })` / `supabase.rpc('reject_cancel_request', { request_id })` from later tasks.

- [ ] **Step 1: Create the migration file**

```bash
npx supabase migration new cancel_request_review
```

Replace its contents with:

```sql
create or replace function approve_cancel_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_status text;
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;

  select meal_entry_id, status into v_entry_id, v_status
  from cancel_requests where id = request_id;

  if v_entry_id is null then
    raise exception 'cancel request not found';
  end if;
  if v_status <> 'PENDING' then
    raise exception 'cancel request already reviewed';
  end if;

  update meal_entries set status = 'CANCELLED' where id = v_entry_id;
  update cancel_requests
    set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
    where id = request_id;
end;
$$;

create or replace function reject_cancel_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;

  update cancel_requests
    set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now()
    where id = request_id and status = 'PENDING';

  if not found then
    raise exception 'cancel request not found or already reviewed';
  end if;
end;
$$;

grant execute on function approve_cancel_request(uuid) to authenticated;
grant execute on function reject_cancel_request(uuid) to authenticated;
```

- [ ] **Step 2: Apply via a clean reset and verify**

```bash
npx supabase db reset
```

Expected: all migrations apply in order including this new one, seed succeeds (no error — the `meal_rates` seed row from Employee flow's fix is still in `supabase/seed.sql`).

- [ ] **Step 3: Exploit-test — non-admin call is rejected**

Sign in as `employee1@example.com` (self-heal password via service-role key if needed, same pattern as `scripts/verify-rls.mjs`), then call the RPC directly:

```bash
ANON_KEY=$(npx supabase status -o env | grep -o 'ANON_KEY="[^"]*"' | cut -d'"' -f2)
EMP_JWT=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"employee1@example.com","password":"employee1234"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).access_token")

curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "http://127.0.0.1:54321/rest/v1/rpc/approve_cancel_request" \
  -H "Authorization: Bearer $EMP_JWT" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"request_id":"00000000-0000-0000-0000-000000000000"}'
```

Expected: non-200 status, error message containing "forbidden".

- [ ] **Step 4: Exploit-test — admin approve/reject actually work**

Create a real cancel request first (as the employee, submit one for an existing CONFIRMED entry via the app's own flow or a direct insert), then as admin:

```bash
ADMIN_JWT=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin1234"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).access_token")

curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "http://127.0.0.1:54321/rest/v1/rpc/approve_cancel_request" \
  -H "Authorization: Bearer $ADMIN_JWT" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"request_id":"<the real request id>"}'
```

Expected: 200/204. Then verify directly: the `meal_entries` row's `status` is now `CANCELLED`, and the `cancel_requests` row's `status` is `APPROVED` with `reviewed_by` set to the admin's id and `reviewed_at` non-null.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations
git commit -m "feat: add approve/reject cancel request RPC functions"
```

---

### Task 3: Admin rate management page

**Files:**
- Create: `src/routes/admin/rate/+page.svelte`

**Interfaces:**
- Consumes: `supabase` client, `meal_rates` table (RLS: `meal_rates_insert_admin` already permits admin insert).

- [ ] **Step 1: Create the page**

`src/routes/admin/rate/+page.svelte`:

```svelte
<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';

  type RateRow = { id: string; rate: number; effective_from: string; created_at: string };

  let rate = $state('');
  let effectiveFrom = $state(new Date().toLocaleDateString('en-CA'));
  let history = $state<RateRow[]>([]);
  let loading = $state(true);
  let loadError = $state('');
  let submitting = $state(false);
  let error = $state('');

  async function load() {
    loading = true;
    loadError = '';
    const { data, error: selectError } = await supabase
      .from('meal_rates')
      .select('id, rate, effective_from, created_at')
      .order('effective_from', { ascending: false });
    if (selectError) {
      loadError = selectError.message;
      loading = false;
      return;
    }
    history = data ?? [];
    loading = false;
  }

  onMount(load);

  async function submitRate(e: SubmitEvent) {
    e.preventDefault();
    if (submitting) return;
    submitting = true;
    error = '';
    const {
      data: { user }
    } = await supabase.auth.getUser();
    const { error: insertError } = await supabase
      .from('meal_rates')
      .insert({ rate: Number(rate), effective_from: effectiveFrom, created_by: user!.id });
    submitting = false;
    if (insertError) {
      error = insertError.message;
      return;
    }
    rate = '';
    await load();
  }
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Rate</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Meal rate</h1>
</div>

<div class="grid gap-10 md:grid-cols-[320px_1fr] items-start">
  <form onsubmit={submitRate} class="ticket pt-8 pb-6 px-6">
    <div class="space-y-4">
      <label class="block">
        <span class="font-display text-[11px] tracking-widest text-ink/60 uppercase">Rate</span>
        <input
          type="number"
          step="0.01"
          min="0"
          bind:value={rate}
          placeholder="150.00"
          class="mt-1 w-full border-b-2 border-line bg-transparent py-2 outline-none focus:border-stamp transition-colors"
          required
        />
      </label>
      <label class="block">
        <span class="font-display text-[11px] tracking-widest text-ink/60 uppercase">Effective from</span>
        <input
          type="date"
          bind:value={effectiveFrom}
          class="mt-1 w-full border-b-2 border-line bg-transparent py-2 outline-none focus:border-stamp transition-colors"
          required
        />
      </label>
    </div>
    {#if error}<p class="mt-4 text-sm text-stamp-dark">{error}</p>{/if}
    <div class="ticket-tear mt-6 pt-4">
      <button
        type="submit"
        disabled={submitting}
        class="font-display text-sm tracking-wide bg-stamp text-paper px-5 py-2.5 rounded-sm hover:bg-stamp-dark transition-colors disabled:opacity-50 w-full"
      >
        {submitting ? 'Saving…' : 'Set rate →'}
      </button>
    </div>
  </form>

  <div>
    <p class="font-display text-[11px] tracking-widest text-ink/50 uppercase mb-3">History</p>
    {#if loading}
      <p class="text-sm text-ink/50">Loading…</p>
    {:else if loadError}
      <p class="text-sm text-stamp-dark">{loadError}</p>
    {:else if history.length === 0}
      <p class="text-sm text-ink/50">No rates set yet.</p>
    {:else}
      <ul class="divide-y divide-line border-t border-b border-line">
        {#each history as row (row.id)}
          <li class="py-3 flex items-center justify-between text-sm">
            <span>Effective {row.effective_from}</span>
            <span class="font-display">{row.rate.toFixed(2)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
```

- [ ] **Step 2: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both exit 0.

- [ ] **Step 3: Manual verification against the local Supabase stack**

Log in as admin, visit `/admin/rate`, set a new rate with today's date, confirm it appears in the history list immediately and `select * from meal_rates order by effective_from desc;` via psql shows the new row.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin/rate
git commit -m "feat: add admin rate management page"
```

---

### Task 4: Admin dashboard — real tally

**Files:**
- Modify: `src/routes/admin/dashboard/+page.svelte` (replaces the Foundation placeholder entirely)

**Interfaces:**
- Consumes: `supabase` client. `meal_entries.user_id` has a foreign key to `profiles.id` (single FK, unambiguous for PostgREST embedding).

- [ ] **Step 1: Replace the page**

`src/routes/admin/dashboard/+page.svelte`:

```svelte
<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';

  type Row = { id: string; user_id: string; profiles: { name: string } | null };

  let selectedDate = $state(new Date().toLocaleDateString('en-CA'));
  let rows = $state<Row[]>([]);
  let loading = $state(true);
  let loadError = $state('');

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

  onMount(load);
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Tally</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Who's eating</h1>
</div>

<label class="block mb-6 max-w-xs">
  <span class="font-display text-[11px] tracking-widest text-ink/60 uppercase">Date</span>
  <input
    type="date"
    bind:value={selectedDate}
    onchange={load}
    class="mt-1 w-full border-b-2 border-line bg-transparent py-2 outline-none focus:border-stamp transition-colors"
  />
</label>

{#if loading}
  <p class="text-sm text-ink/50">Loading…</p>
{:else if loadError}
  <p class="text-sm text-stamp-dark">{loadError}</p>
{:else}
  <p class="font-display text-lg mb-4">{rows.length} eating on {selectedDate}</p>
  {#if rows.length === 0}
    <p class="text-sm text-ink/50">Nobody marked yet.</p>
  {:else}
    <ul class="divide-y divide-line border-t border-b border-line">
      {#each rows as row (row.id)}
        <li class="py-2 text-sm">{row.profiles?.name ?? 'Unknown'}</li>
      {/each}
    </ul>
  {/if}
{/if}
```

- [ ] **Step 2: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both exit 0. If the `profiles(name)` embed syntax errors (PostgREST sometimes needs an explicit hint even for a single FK, depending on version), check the actual error message from a live query first — adjust to `profiles!meal_entries_user_id_fkey(name)` only if the plain form fails; verify the real constraint name via `\d meal_entries` in psql rather than guessing.

- [ ] **Step 3: Manual verification against the local Supabase stack**

As an employee, mark today's meal (via `/employee/dashboard`). As admin, visit `/admin/dashboard`, confirm the count is at least 1 and the employee's name appears. Change the date to a day with no entries, confirm "Nobody marked yet."

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin/dashboard/+page.svelte
git commit -m "feat: build admin dashboard as a real daily tally"
```

---

### Task 5: Admin cancel-requests approval queue

**Files:**
- Create: `src/routes/admin/cancel-requests/+page.svelte`

**Interfaces:**
- Consumes: `approve_cancel_request`/`reject_cancel_request` RPCs from Task 2.
- Note: `cancel_requests` has TWO foreign keys into `profiles` (`requested_by` and `reviewed_by`), so a PostgREST embed like `profiles(name)` would be ambiguous. This page fetches `cancel_requests`, `meal_entries`, and `profiles` as three separate queries and joins client-side with lookup maps — avoids the ambiguity entirely and matches the pattern already used in `src/routes/employee/history/+page.svelte`.

- [ ] **Step 1: Create the page**

`src/routes/admin/cancel-requests/+page.svelte`:

```svelte
<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';

  type CancelRequestRow = {
    id: string;
    meal_entry_id: string;
    requested_by: string;
    reason: string | null;
    created_at: string;
  };

  let requests = $state<CancelRequestRow[]>([]);
  let entryDates = $state<Record<string, string>>({});
  let names = $state<Record<string, string>>({});
  let loading = $state(true);
  let loadError = $state('');
  let actingId = $state<string | null>(null);
  let error = $state('');

  async function load() {
    loading = true;
    loadError = '';
    const { data: reqData, error: reqError } = await supabase
      .from('cancel_requests')
      .select('id, meal_entry_id, requested_by, reason, created_at')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: true });
    if (reqError) {
      loadError = reqError.message;
      loading = false;
      return;
    }
    requests = reqData ?? [];

    const entryIds = [...new Set(requests.map((r) => r.meal_entry_id))];
    const userIds = [...new Set(requests.map((r) => r.requested_by))];

    const [entriesRes, profilesRes] = await Promise.all([
      entryIds.length
        ? supabase.from('meal_entries').select('id, entry_date').in('id', entryIds)
        : Promise.resolve({ data: [] as { id: string; entry_date: string }[] }),
      userIds.length
        ? supabase.from('profiles').select('id, name').in('id', userIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] })
    ]);

    entryDates = Object.fromEntries((entriesRes.data ?? []).map((e) => [e.id, e.entry_date]));
    names = Object.fromEntries((profilesRes.data ?? []).map((p) => [p.id, p.name]));
    loading = false;
  }

  onMount(load);

  async function act(id: string, fn: 'approve_cancel_request' | 'reject_cancel_request') {
    actingId = id;
    error = '';
    const { error: rpcError } = await supabase.rpc(fn, { request_id: id });
    actingId = null;
    if (rpcError) {
      error = rpcError.message;
      return;
    }
    await load();
  }
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Requests</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Cancel requests</h1>
</div>

{#if error}<p class="mb-4 text-sm text-stamp-dark">{error}</p>{/if}

{#if loading}
  <p class="text-sm text-ink/50">Loading…</p>
{:else if loadError}
  <p class="text-sm text-stamp-dark">{loadError}</p>
{:else if requests.length === 0}
  <p class="text-sm text-ink/50">No pending requests.</p>
{:else}
  <ul class="divide-y divide-line border-t border-b border-line">
    {#each requests as req (req.id)}
      <li class="py-3 flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">
            {names[req.requested_by] ?? 'Unknown'} — {entryDates[req.meal_entry_id] ?? '—'}
          </p>
          {#if req.reason}<p class="text-xs text-ink/50">{req.reason}</p>{/if}
        </div>
        <div class="flex items-center gap-3">
          <button
            onclick={() => act(req.id, 'approve_cancel_request')}
            disabled={actingId === req.id}
            class="font-display text-[11px] tracking-widest uppercase text-sage hover:opacity-70 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onclick={() => act(req.id, 'reject_cancel_request')}
            disabled={actingId === req.id}
            class="font-display text-[11px] tracking-widest uppercase text-stamp hover:text-stamp-dark disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      </li>
    {/each}
  </ul>
{/if}
```

- [ ] **Step 2: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both exit 0.

- [ ] **Step 3: Manual verification against the local Supabase stack**

As an employee, submit a cancel request (via `/employee/history`) for a CONFIRMED entry. As admin, visit `/admin/cancel-requests`, confirm it appears with the employee's name and entry date. Click Approve, confirm it disappears from the queue and (via psql) the underlying `meal_entries` row is now `CANCELLED` and the `cancel_requests` row is `APPROVED`. Repeat with a second request and Reject instead — confirm the `meal_entries` row stays `CONFIRMED`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin/cancel-requests
git commit -m "feat: add admin cancel-request approval queue"
```

---

### Task 6: Admin employees page — balances + record payment

**Files:**
- Modify: `src/routes/admin/employees/+page.svelte` (extends the existing create-employee form + roster list; does not remove anything)

**Interfaces:**
- Consumes: `computeBalancesByUser` from Task 1, `Balance` type from `$lib/meals`.

- [ ] **Step 1: Replace the page with the extended version**

`src/routes/admin/employees/+page.svelte` (full file — the create form and remove-employee logic are unchanged from the existing file, balances and payment recording are new):

```svelte
<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { FunctionsHttpError } from '@supabase/supabase-js';
  import { onMount } from 'svelte';
  import { computeBalancesByUser, type Balance } from '$lib/meals';

  type Employee = { id: string; name: string; email: string | null; createdAt: string };

  let name = $state('');
  let email = $state('');
  let created = $state<{ email: string; tempPassword: string } | null>(null);
  let error = $state('');
  let loading = $state(false);

  let employees = $state<Employee[]>([]);
  let balances = $state<Record<string, Balance>>({});
  let listLoading = $state(true);
  let listError = $state('');
  let removingId = $state<string | null>(null);
  let removeError = $state('');

  let payingId = $state<string | null>(null);
  let paymentAmount = $state('');
  let paymentNote = $state('');
  let paymentSubmitting = $state(false);
  let paymentError = $state('');

  async function messageFor(err: Error): Promise<string> {
    if (err instanceof FunctionsHttpError) {
      const body = await err.context.json().catch(() => null);
      if (body?.error) return body.error;
    }
    return err.message;
  }

  async function loadEmployees() {
    listLoading = true;
    listError = '';
    const { data, error: invokeError } = await supabase.functions.invoke<{ employees: Employee[] }>(
      'admin-list-employees',
      { method: 'GET' }
    );
    if (invokeError) {
      listLoading = false;
      listError = await messageFor(invokeError);
      return;
    }
    employees = data?.employees ?? [];

    const [entriesRes, paymentsRes] = await Promise.all([
      supabase.from('meal_entries').select('user_id, rate_applied, status').eq('status', 'CONFIRMED'),
      supabase.from('payments').select('user_id, amount')
    ]);
    balances = computeBalancesByUser(entriesRes.data ?? [], paymentsRes.data ?? []);
    listLoading = false;
  }

  onMount(loadEmployees);

  async function createEmployee(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    created = null;
    loading = true;

    const { data, error: invokeError } = await supabase.functions.invoke<{
      id: string;
      email: string;
      tempPassword: string;
    }>('admin-create-employee', { body: { name, email } });

    loading = false;
    if (invokeError) {
      error = await messageFor(invokeError);
      return;
    }
    created = { email: data!.email, tempPassword: data!.tempPassword };
    name = '';
    email = '';
    await loadEmployees();
  }

  function addAnother() {
    created = null;
  }

  async function confirmRemove(id: string) {
    removeError = '';
    const { error: invokeError } = await supabase.functions.invoke('admin-delete-employee', {
      body: { id }
    });
    removingId = null;
    if (invokeError) {
      removeError = await messageFor(invokeError);
      return;
    }
    employees = employees.filter((emp) => emp.id !== id);
  }

  function startPayment(id: string) {
    payingId = id;
    paymentAmount = '';
    paymentNote = '';
    paymentError = '';
  }

  async function submitPayment(id: string) {
    if (paymentSubmitting) return;
    paymentSubmitting = true;
    paymentError = '';
    const {
      data: { user }
    } = await supabase.auth.getUser();
    const { error: insertError } = await supabase
      .from('payments')
      .insert({ user_id: id, amount: Number(paymentAmount), note: paymentNote || null, recorded_by: user!.id });
    paymentSubmitting = false;
    if (insertError) {
      paymentError = insertError.message;
      return;
    }
    payingId = null;
    await loadEmployees();
  }
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Roster</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Employees</h1>
</div>

<div class="grid gap-10 md:grid-cols-[320px_1fr] items-start">
  <div>
    {#if created}
      <div class="ticket pt-8 pb-6 px-6">
        <p class="font-display text-[11px] tracking-widest text-sage uppercase mb-3">Account created</p>
        <dl class="space-y-3 text-sm">
          <div>
            <dt class="font-display text-[11px] tracking-widest text-ink/50 uppercase">Email</dt>
            <dd class="mt-0.5">{created.email}</dd>
          </div>
          <div>
            <dt class="font-display text-[11px] tracking-widest text-ink/50 uppercase">Temporary password</dt>
            <dd class="mt-0.5 font-display">{created.tempPassword}</dd>
          </div>
        </dl>
        <p class="mt-4 text-xs text-ink/60">
          Share this with the employee directly — it won't be shown again. They should change it after
          signing in.
        </p>
        <div class="ticket-tear mt-6 pt-4">
          <button
            onclick={addAnother}
            class="font-display text-sm tracking-wide bg-stamp text-paper px-5 py-2.5 rounded-sm hover:bg-stamp-dark transition-colors"
          >
            Add another →
          </button>
        </div>
      </div>
    {:else}
      <form onsubmit={createEmployee} class="ticket pt-8 pb-6 px-6">
        <div class="space-y-4">
          <label class="block">
            <span class="font-display text-[11px] tracking-widest text-ink/60 uppercase">Name</span>
            <input
              bind:value={name}
              placeholder="Jane Doe"
              class="mt-1 w-full border-b-2 border-line bg-transparent py-2 outline-none focus:border-stamp transition-colors"
              required
            />
          </label>
          <label class="block">
            <span class="font-display text-[11px] tracking-widest text-ink/60 uppercase">Email</span>
            <input
              type="email"
              bind:value={email}
              placeholder="jane@company.com"
              class="mt-1 w-full border-b-2 border-line bg-transparent py-2 outline-none focus:border-stamp transition-colors"
              required
            />
          </label>
        </div>

        {#if error}
          <p class="mt-4 text-sm text-stamp-dark">{error}</p>
        {/if}

        <div class="ticket-tear mt-6 pt-4 flex items-center justify-between">
          <span class="font-display text-[11px] tracking-widest text-ink/40 uppercase">No. 002</span>
          <button
            type="submit"
            disabled={loading}
            class="font-display text-sm tracking-wide bg-stamp text-paper px-5 py-2.5 rounded-sm hover:bg-stamp-dark transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating…' : 'Create employee →'}
          </button>
        </div>
      </form>
    {/if}
  </div>

  <div>
    <p class="font-display text-[11px] tracking-widest text-ink/50 uppercase mb-3">
      {employees.length} on staff
    </p>

    {#if removeError}
      <p class="mb-3 text-sm text-stamp-dark">{removeError}</p>
    {/if}
    {#if paymentError}
      <p class="mb-3 text-sm text-stamp-dark">{paymentError}</p>
    {/if}

    {#if listLoading}
      <p class="text-sm text-ink/50">Loading…</p>
    {:else if listError}
      <p class="text-sm text-stamp-dark">{listError}</p>
    {:else if employees.length === 0}
      <p class="text-sm text-ink/50">No employees yet — add one to get started.</p>
    {:else}
      <ul class="divide-y divide-line border-t border-b border-line">
        {#each employees as emp (emp.id)}
          {@const bal = balances[emp.id]}
          <li class="py-3">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium">{emp.name}</p>
                <p class="text-xs text-ink/50">{emp.email ?? '—'}</p>
                <p class="text-xs text-ink/50">
                  eaten {bal?.totalEaten ?? 0} · due {(bal?.due ?? 0).toFixed(2)}
                </p>
              </div>
              <div class="flex items-center gap-3">
                {#if payingId !== emp.id}
                  <button
                    onclick={() => startPayment(emp.id)}
                    class="font-display text-[11px] tracking-widest uppercase text-sage hover:opacity-70"
                  >
                    Record payment
                  </button>
                {/if}
                {#if removingId === emp.id}
                  <span class="font-display text-[11px] tracking-widest text-stamp uppercase">Remove?</span>
                  <button
                    onclick={() => confirmRemove(emp.id)}
                    class="font-display text-[11px] tracking-widest uppercase text-stamp hover:text-stamp-dark"
                  >
                    Confirm
                  </button>
                  <button
                    onclick={() => (removingId = null)}
                    class="font-display text-[11px] tracking-widest uppercase text-ink/40 hover:text-ink"
                  >
                    Cancel
                  </button>
                {:else}
                  <button
                    onclick={() => (removingId = emp.id)}
                    class="font-display text-[11px] tracking-widest uppercase text-ink/40 hover:text-stamp transition-colors"
                  >
                    Remove
                  </button>
                {/if}
              </div>
            </div>
            {#if payingId === emp.id}
              <div class="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  bind:value={paymentAmount}
                  placeholder="Amount"
                  class="w-28 border-b-2 border-line bg-transparent py-1 text-sm outline-none focus:border-stamp transition-colors"
                />
                <input
                  bind:value={paymentNote}
                  placeholder="Note (optional)"
                  class="flex-1 border-b-2 border-line bg-transparent py-1 text-sm outline-none focus:border-stamp transition-colors"
                />
                <button
                  onclick={() => submitPayment(emp.id)}
                  disabled={paymentSubmitting}
                  class="font-display text-[11px] tracking-widest uppercase text-sage hover:opacity-70 disabled:opacity-50"
                >
                  {paymentSubmitting ? 'Saving…' : 'Save'}
                </button>
                <button
                  onclick={() => (payingId = null)}
                  disabled={paymentSubmitting}
                  class="font-display text-[11px] tracking-widest uppercase text-ink/40 hover:text-ink disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
```

- [ ] **Step 2: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both exit 0.

- [ ] **Step 3: Manual verification against the local Supabase stack**

Visit `/admin/employees`, confirm existing employees show `eaten`/`due` figures matching a hand calculation from their `meal_entries`/`payments`. Click "Record payment" on one, enter an amount, save — confirm `due` decreases by that amount immediately and `select * from payments where user_id = '<id>';` shows the new row with `recorded_by` set to the admin.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin/employees/+page.svelte
git commit -m "feat: add balances and payment recording to admin employees page"
```

---

### Task 7: Nav update

**Files:**
- Modify: `src/routes/admin/+layout.svelte`

**Interfaces:** none new — just data.

- [ ] **Step 1: Update the links array**

In `src/routes/admin/+layout.svelte`, change the `links` const to:

```ts
const links = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/rate', label: 'Rate' },
  { href: '/admin/cancel-requests', label: 'Requests' },
  { href: '/admin/employees', label: 'Employees' }
];
```

- [ ] **Step 2: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both exit 0. Confirm `build/admin/rate.html` and `build/admin/cancel-requests.html` both exist (new routes prerendered).

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin/+layout.svelte
git commit -m "feat: add Rate and Requests tabs to admin nav"
```

---

### Task 8: Final verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full automated check**

```bash
npm run test:unit -- --run
npx tsc --noEmit
npm run build
```

Expected: all exit 0. 14/14 unit tests.

- [ ] **Step 2: Confirm prerendered routes**

```bash
ls build/admin/rate.html build/admin/cancel-requests.html build/admin/dashboard.html build/admin/employees.html
```

Expected: all four exist.

- [ ] **Step 3: End-to-end manual pass against the local Supabase stack**

Full cycle as both roles: admin sets a rate → employee marks eating today at that rate → admin's tally shows it → employee requests cancellation → admin approves it via the queue → employee's balance (on `/employee/dashboard`) now excludes it → admin records a payment for a different employee → that employee's due decreases on `/admin/employees`.

- [ ] **Step 4: Commit (if fixes were needed) or confirm clean**

If Steps 1-3 required no changes, confirm `git status` is clean — nothing to commit.

---

## Post-plan state

Admin can set meal rates, see the daily tally, approve/reject cancellation requests, and track/record employee payments — completing every feature from the original spec except charts (sub-project 4).
