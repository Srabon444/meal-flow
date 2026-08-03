# Employee History, Ordering Kill-Switch, and Push Reminders — Design

## Goal

Three features, one branch:
1. Employees can see their own dated history (meals eaten, payments) — mirrors the admin roster's per-employee history view.
2. Admin gets a one-tap kill-switch to stop new meal orders for the rest of the current day; it auto-reopens the next day with no cron/cleanup.
3. Reminders: employees who haven't ordered by 9am (Asia/Dhaka) get a push notification; admin gets a push at 10:30am if ordering hasn't been closed yet. Real push for web + desktop. Android originally got only a foreground-only local notification (no FCM — see Constraints below); real background push via FCM was added afterward (`tauri-plugin-fcm`, `fcm_tokens`, `_shared/fcm.ts`), see README's "Android push (FCM) setup". The foreground-only fallback below is kept as a safety net alongside FCM.

## Constraints

- Fixed timezone for all reminder scheduling: `Asia/Dhaka` (UTC+6).
- ~~Android does not get true background push. Tauri has no official FCM plugin; building one is out of scope. Android shows the same reminder as a local notification (`@tauri-apps/plugin-notification`) only while the app is open/foregrounded.~~ Superseded: Android now gets real background push via FCM (`tauri-plugin-fcm`), see README's "Android push (FCM) setup". The local-notification fallback below is kept as a foreground safety net.
- Admin recipients for the 10:30 reminder = every `profiles.role = 'admin'` row with a push subscription. No per-admin scoping.
- Backend is the real enforcement boundary for the kill-switch (trigger), per this project's standing rule that frontend checks are UX only.

## 1. Employee history

**File:** `src/routes/employee/history/+page.svelte` already exists — it lists the employee's own `meal_entries` (dated, with cancel-request actions) but has no payment/top-up data at all. Add a `payments` fetch alongside the existing `entries`/`requests` queries:

```ts
supabase.from('payments').select('id, amount, note, paid_at').eq('user_id', userId).order('paid_at', { ascending: false })
```

Merge `entries` and `payments` into one date-sorted list for display, same row format as the admin roster's history panel (date, label, amount — payment rows in sage with a `+` prefix, meal rows in ink showing status). Keep the existing cancel-request UI on meal rows as-is; payment rows are read-only. No new RLS needed — employees already have `select` on their own `payments` rows (existing policy). No admin-mirrored expand/collapse needed here since this is already a dedicated full-page view, not a roster row — show the merged list directly.

## 2. Ordering kill-switch

**Schema (new migration):**

```sql
create table public.ordering_pause (
  paused_date date primary key,
  paused_by uuid not null references public.profiles(id),
  paused_at timestamptz not null default now()
);

alter table public.ordering_pause enable row level security;

create policy ordering_pause_select_all on public.ordering_pause
  for select using (true);

create policy ordering_pause_admin_write on public.ordering_pause
  for all using (is_admin()) with check (is_admin());
```

**Trigger change** (`enforce_meal_entry_invariants`, modify in place via a new migration — do not edit the already-applied migration file):

```sql
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

**Frontend:**
- Admin dashboard (`src/routes/admin/dashboard/+page.svelte`): big red toggle. Query `ordering_pause` for today's Dhaka-local date on load. On = show "Ordering is CLOSED — reopen" (stamp-red filled). Off = show "Close ordering for today" (outline). Click inserts/deletes the row directly (RLS already permits admin writes — no edge function needed, this is a plain authenticated client call, unlike the employee-management flows which needed service-role for `auth.admin.*`).
- Employee dashboard: on load, also check `ordering_pause` for today. If paused, replace the "mark eating" button with a banner: "Ordering is closed for today by admin." The insert would fail via the trigger anyway (backend is the real gate); this is UX only, matching the project's FE/BE mirroring rule.
- Date basis: use the same `localToday()` helper already in `src/lib/meals.ts` for consistency — the pause is keyed by the browser's local date, same as `entry_date` already is. (Not Dhaka-server-time here; this matches existing app behavior where "today" is always client-local, and the office is in one timezone anyway so this doesn't diverge from Dhaka in practice.)

## 3. Push reminders

**Schema (new migration):**

```sql
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_own on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

**VAPID keys:** generate once with `npx web-push generate-vapid-keys`. Public key → `PUBLIC_VAPID_PUBLIC_KEY` in frontend env (Vercel + local `.env`). Private key → Supabase Edge Function secret `VAPID_PRIVATE_KEY` (`npx supabase secrets set`).

**Service worker:** `static/sw.js` — minimal, handles `push` event (show notification from payload) and `notificationclick` (focus/open the app). Registered from a new `src/lib/push.ts` helper called on app load (`+layout.svelte`) for web/desktop builds only (guarded by `!('__TAURI_INTERNALS__' in window) || <desktop check>` — need to confirm Tauri desktop webview supports `navigator.serviceWorker` and `PushManager`; if the local dev test shows it doesn't, desktop silently no-ops and only web gets real push — acceptable degradation, not a blocker).

**Subscribe flow:** after login, if `Notification.permission` isn't `denied`, request permission, `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <public key> })`, upsert `(user_id, endpoint, p256dh, auth)` into `push_subscriptions` (unique on `endpoint` so re-subscribing on the same browser updates, not duplicates).

**Edge Function `send-reminders`:**
- Not user-invoked — triggered only by Supabase's scheduled Cron Jobs (dashboard-configured, two schedules: `0 3 * * *` and `30 4 * * *` UTC = 9:00 / 10:30 Dhaka). Verify the request via a shared secret header (`x-cron-secret`) set in the cron job config and checked in the function, since this endpoint must not be publicly triggerable to spam pushes.
- At 3:00 UTC: `today := (now() at Dhaka offset)::date`. Select `profiles` where `role='employee' and active` and no `meal_entries` row with that `entry_date` and `status='CONFIRMED'`. For each, look up their `push_subscriptions`, send via `npm:web-push` (Deno npm specifier) using the VAPID keys.
- At 4:30 UTC: same `today`. If no `ordering_pause` row for `today`, select `profiles` where `role='admin'`, push all their subscriptions: "Ordering still open — close it if needed."
- A subscription that errors with 404/410 (expired/unsubscribed) gets deleted from `push_subscriptions` in the same run — standard web-push hygiene, prevents the table from accumulating dead rows that fail every day.

**Android local fallback:**
- `@tauri-apps/plugin-notification` added to the Tauri app (Rust + JS sides, plus Android manifest permission `POST_NOTIFICATIONS` for Android 13+).
- On app foreground (Tauri's `visibilitychange`/resume-equivalent, or simplest: check once on load and every 15 min while open via `setInterval`), reuse the exact same "no confirmed entry today past 9am Dhaka" / "no pause row past 10:30am Dhaka, role=admin" checks the dashboards already compute for their banners, and additionally fire a local notification via the plugin when true (once per day — track with `localStorage` flag keyed by date to avoid re-firing every 15 min).
- This code path is guarded to only run inside the Tauri Android build (`__TAURI_INTERNALS__` check + platform check) — web/desktop already get real push, don't double-notify them.

## Testing

- Trigger: attempt insert with a `ordering_pause` row present → expect rejection with the exact message; delete row → insert succeeds. Existing `verify-rls.mjs`-style pattern.
- `send-reminders`: local test invokes the function directly with a fake `x-cron-secret`, seeds one employee with no entry + one with a confirmed entry, asserts only the former would receive a push (can stub the actual `web-push.sendNotification` call and assert call count/args rather than needing a real browser subscription).
- Manual: real headless-Chrome check (existing pattern in this project) for the admin toggle button and the employee "closed" banner at 375px mobile width.

## Out of scope

- iOS (needs a Mac, already noted as out of scope earlier in this project).
- ~~Android true background push (FCM) — explicitly deferred per Constraints.~~ Added later, see README's "Android push (FCM) setup".
- Configurable reminder times / configurable timezone — hardcoded Dhaka, 9:00/10:30, matching what was asked for.
