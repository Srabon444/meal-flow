# OfficeMeal — Sub-project 3: Admin flow

Source spec: `office-meal-app-prompt.md` §4.3, §4.4, §4.5, §4.6 (admin sides). Builds on Foundation (schema/RLS/auth) and Employee flow (server-enforced invariants pattern, `pickActiveRate`/`computeBalance` in `$lib/meals.ts`).

## Scope

Rate management, daily tally (replaces the admin dashboard placeholder), cancel-request approval queue, employee balances + payment recording. This is everything remaining on the admin side except charts (sub-project 4).

## Decisions

- **Cancel-request approval via two `security definer` Postgres functions**, not a new RLS UPDATE policy on `meal_entries`. There is currently no UPDATE policy on `meal_entries` at all (confirmed gap from sub-project 2's final review). A broad admin UPDATE policy would let admin edit any column including `rate_applied`, reopening the exact class of hole sub-project 2 just closed with server-enforced invariants. Instead:
  - `approve_cancel_request(request_id uuid)`: checks `is_admin()`, verifies the request is PENDING, atomically sets the linked `meal_entries.status = 'CANCELLED'` and the `cancel_requests` row to APPROVED with `reviewed_by`/`reviewed_at`.
  - `reject_cancel_request(request_id uuid)`: checks `is_admin()`, sets the `cancel_requests` row to REJECTED with `reviewed_by`/`reviewed_at` (only if still PENDING) — `meal_entries` untouched.
  - Both callable directly via `supabase.rpc(...)` from the client; both run as the function owner (bypassing RLS internally) but gate on `is_admin()` first, same trust model as `is_admin()` itself.
- **Rate management**: setting a new rate always inserts a new `meal_rates` row (never edits existing ones) — matches Foundation's history-preserving design. `effective_from` defaults to today but is editable (admin might backdate/schedule).
- **Tally is date-filterable**, defaulting to today. Query: `meal_entries` where `entry_date = <selected>` and `status = 'CONFIRMED'`, joined to `profiles` for names via PostgREST embedding (`meal_entries.user_id -> profiles.id` FK already exists).
- **Balances computed by grouping**, not a new DB view: fetch all CONFIRMED `meal_entries` and all `payments` (admin can read all via existing RLS), group by `user_id` client-side, run the already-tested `computeBalance` per employee via a new `computeBalancesByUser` wrapper in `$lib/meals.ts`.
- **Payment recording** reuses the existing `payments_insert_admin` RLS policy — no new privileged operation needed, it's a plain insert.

## Routes

- `src/routes/admin/dashboard/+page.svelte` — replaces the placeholder. Date picker (default today), count of confirmed entries for that date, list of employee names.
- `src/routes/admin/rate/+page.svelte` — new. Form (rate, effective_from) → inserts `meal_rates`. Table of rate history below (all rows, newest first).
- `src/routes/admin/cancel-requests/+page.svelte` — new. Lists PENDING `cancel_requests` (joined to `profiles` for employee name, and `meal_entries` for the entry date) with Approve/Reject buttons calling the two RPC functions.
- `src/routes/admin/employees/+page.svelte` — extended (not replaced): existing create-employee form and roster list stay; roster rows gain balance columns (eaten/cost/paid/due) and a "Record payment" inline action.
- Admin nav (`NavRail` links) grows to: Dashboard, Rate, Cancel Requests, Employees, Sign out.

## Data model

One new migration: the two RPC functions (`approve_cancel_request`, `reject_cancel_request`) plus their `grant execute ... to authenticated`. No table/column changes, no new RLS policies.

## Out of scope (this sub-project)

Charts/reports (sub-project 4). Notifications (deferred in the original spec itself).

## Verification

- Admin sets a new rate → appears in history, becomes the active rate for new employee entries (cross-check with `$lib/meals.ts`'s `pickActiveRate`, already used by the employee dashboard).
- Mark an employee's entry as eating today (via employee flow) → shows in admin's tally for today, count matches.
- Employee submits a cancel request → appears in admin's PENDING queue → Approve → entry flips to CANCELLED (verify via direct query, not just UI), employee's balance recalculates to exclude it (re-verify `computeBalance`'s existing CANCELLED-exclusion, already tested).
- Reject → request shows REJECTED, entry stays CONFIRMED, no balance change.
- A non-admin calling `approve_cancel_request`/`reject_cancel_request` directly (raw RPC POST) is rejected — exploit-test this the same way sub-project 2's trigger fix was tested.
- Record a payment for an employee → their `due` decreases by that amount, admin's employees list reflects it immediately.
