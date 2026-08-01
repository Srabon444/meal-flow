# OfficeMeal — Sub-project 2: Employee flow

Source spec: `office-meal-app-prompt.md` §4.2, §4.5, §4.6. Builds on Foundation (schema, auth, RLS already in place — no schema changes needed here, all 5 tables and their RLS policies already exist).

## Scope

Daily meal entry (mark today YES/NO), entry history, cancel-request submission + status tracking, balance view (eaten/cost/paid/due). Employee-side only — admin approval of cancel requests is sub-project 3.

## Decisions

- **No cutoff time enforcement** (carried over from Foundation's decision) — employees can mark today's entry any time during the day.
- **Marking is one-directional and final for the day**: YES inserts a `meal_entries` row; there is no UI to un-mark or change today's choice once set (no edit/delete path here — only the cancel-request workflow removes a CONFIRMED entry, and that requires admin approval).
- **No active meal rate = blocked entry**: `meal_entries.rate_applied` is `NOT NULL`. If no `meal_rates` row has `effective_from <= today`, the dashboard shows "Ask your admin to set a meal rate first" instead of a YES/NO toggle.
- **Rate snapshot**: `rate_applied` is the `rate` from the most recent `meal_rates` row where `effective_from <= today`, looked up client-side (RLS already allows any authed user to read `meal_rates`) at the moment of marking YES.
- **Cancel requests apply to any of the employee's own CONFIRMED entries** shown in history, not just today's — matches the spec's literal wording ("submit a cancel request... for a specific date's entry").
- **Balance computed client-side**: sum of `rate_applied` across own CONFIRMED `meal_entries` minus sum of own `payments.amount`. Two RLS-scoped selects, summed in the browser — no new DB view, consistent with how the rest of the app reads data (RLS is the access boundary; no privileged aggregation needed since the employee only ever sums their own rows).

## Routes

- `src/routes/employee/dashboard/+page.svelte` — replaces the placeholder. Shows: today's status (marked/not marked, with the YES toggle if not yet marked, or the blocked-state message if no rate exists), and a balance summary (total eaten, total cost, total paid, current due).
- `src/routes/employee/history/+page.svelte` — new. List of past `meal_entries` (own rows, newest first): date, status, rate charged. Each CONFIRMED row has a "Request cancellation" action (optional reason, textarea). Below/alongside: "My requests" list showing each `cancel_requests` row's status (PENDING/APPROVED/REJECTED).
- Employee nav (mirrors admin's `+layout.svelte` nav rail): Dashboard, History, Sign out.

## Data model

No changes — reusing Foundation's `meal_entries`, `meal_rates`, `cancel_requests`, `payments` tables and their existing RLS policies as-is.

## Out of scope (this sub-project)

Admin-side: rate management UI, tally dashboard, cancel-request approval queue, payment recording, charts. All sub-project 3/4.

## Verification

- Mark today's entry as an employee with an active rate set → row appears in `meal_entries` with correct `rate_applied`, shows on dashboard as marked.
- No rate set → dashboard shows blocked message, no toggle rendered, no entry created.
- Submit a cancel request from history → row appears in `cancel_requests` with status PENDING, shown in "My requests".
- Balance view matches manual calculation from seeded `meal_entries`/`payments` rows.
- RLS still holds: an employee's dashboard/history never shows another employee's rows (already covered by Foundation's `verify-rls.mjs`, no new RLS to test here since no schema changes).
