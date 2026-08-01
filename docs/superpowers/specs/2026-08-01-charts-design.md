# OfficeMeal — Sub-project 4: Charts & Reports

Source spec: `office-meal-app-prompt.md` §4.7. Final sub-project — completes the app. Builds on Foundation, Employee flow, and Admin flow (all data/RLS/RPCs already exist).

## Scope

Three charts per spec: admin meals-per-day, admin dues-per-employee, employee paid-vs-due. No new tables, no new RLS, no new privileged operations — pure read/render on top of what already exists.

## Decisions

- **Library: Chart.js** (v4, no peer deps, self-contained via `<canvas>`). The original prompt offered Chart.js or LayerChart; LayerChart is Svelte-native but less mature — Chart.js's canvas-imperative API is a well-understood, stable pattern (`onMount` creates the chart against a canvas ref, `onDestroy` calls `chart.destroy()` to avoid leaking instances across client-side navigation). Tree-shaken import (register only `BarController`/`DoughnutController`/`CategoryScale`/`LinearScale`/`BarElement`/`ArcElement`/`Tooltip`/`Legend`) to keep bundle size down.
- **Admin charts live on a new `/admin/reports` route** (matches the original spec's route sketch). Two charts on one page: meals-per-day (bar, last 30 days) and dues-per-employee (bar, reuses the existing `employee_balances()` RPC from Admin flow — no new query).
- **Meals-per-day** is a plain client-side query (`meal_entries` where `entry_date >= today-30d` and `status = 'CONFIRMED'`, grouped by date in JS) — bounded by the 30-day filter, so it doesn't repeat Admin flow's unbounded-fetch mistake.
- **Employee paid-vs-due chart lives on the existing `/employee/dashboard`** page, next to the balance summary numbers already there — not a new route, since it's one small chart for the logged-in employee's own data (already fetched by that page's existing `load()`).
- **Overpayment/credit handling**: if an employee's `due <= 0` (paid in full or overpaid), a two-slice "paid vs due" pie doesn't make sense — show a plain "Paid in full" / "Credit of X" message instead of a broken/empty chart.
- **Chart colors** reuse the existing design tokens: `stamp` (#c4432b) for cost/due, `sage` (#5b7553) for paid, `ink` for meals-per-day bars — no new palette.

## Routes

- `src/routes/admin/reports/+page.svelte` — new. Two `<canvas>`-backed bar charts.
- `src/routes/admin/+layout.svelte` — nav grows one more tab: Reports.
- `src/routes/employee/dashboard/+page.svelte` — extended with a donut chart next to the existing balance `<dl>`.

## Data model

None — no migration in this sub-project.

## Out of scope

Notifications (deferred in the original spec itself, permanently out of scope for this build). Anything beyond the 3 specified charts (e.g. date-range pickers, export) — YAGNI, not asked for.

## Verification

- Admin visits `/admin/reports`: meals-per-day bar chart shows a bar for each of the last 30 days with the correct CONFIRMED count (cross-check a couple of days by hand); dues-per-employee bar chart matches the `/admin/employees` balance figures already verified in Admin flow.
- Employee visits `/employee/dashboard` with an outstanding due: donut shows paid vs due slices summing to total cost. Employee with `due <= 0`: message shown instead of a chart, no rendering error.
- Navigating away from a chart page and back doesn't leak Chart.js instances (no console warnings about canvas reuse, no visible chart duplication) — confirms `onDestroy` cleanup works.
