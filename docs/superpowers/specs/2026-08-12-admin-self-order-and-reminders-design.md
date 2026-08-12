# Admin Self-Order and Extended 9am Reminder — Design

## Goal

Two features, one branch:
1. Admin currently has no way to mark themselves as eating today, or see their own
   eaten/paid/due numbers — the admin dashboard is purely a tally/management view of
   *other* people's entries. Give admin the same personal ordering + balance view
   employees already have.
2. The 9am "you haven't ordered yet" reminder currently only targets employees, and
   only reaches web (real push, if configured) and Android (real push via FCM). Once
   admin can self-order, admin should get the same 9am nudge. Desktop currently gets
   zero reminder of any kind — extend the existing Android foreground-fallback
   mechanism to desktop too, since it's cross-platform already.

## Decisions (confirmed with user)

- Admin's order UI lives on the existing Admin Dashboard page (`/admin/dashboard`), as
  a new section above the existing ordering-pause/reminder/tally cards — not a new nav
  item.
- Admin also receives the 9am "haven't ordered" push, in addition to the existing
  10:30am "ordering still open" nudge. Both fire independently.
- The `ordering_pause` kill-switch stays symmetric: if admin pauses ordering for the
  day, admin's own insert is blocked too, same as employees. No trigger change.

## Constraints

- No DB schema/RLS/trigger change needed for feature 1. `meal_entries_insert_own`
  already checks only `user_id = auth.uid()` (no role restriction), and
  `enforce_meal_entry_invariants()` already applies uniformly to any `user_id` —
  confirmed by reading `supabase/migrations/20260801111443_ordering_pause.sql`.
  Admin profiles already default `active = true`
  (`20260801103709_employee_deactivation.sql`), so the trigger's active-check passes.
- `send-reminders`'s cron `kind` value (`"employee-reminder"`) stays unchanged even
  though it will now also target admins — renaming it would require updating the
  already-configured Supabase Dashboard Cron Job body, which is outside this repo and
  not something this change should force.
- Desktop's webview cannot receive push while the app is fully closed (unchanged
  limitation, see README). The desktop fallback added here only fires while the
  Tauri desktop app is open (foreground or backgrounded-but-running) — same
  limitation Android had before FCM was added.

## 1. Admin self-order

**New component:** `src/lib/components/MealOrderCard.svelte` — extract the existing
`{#if loading}...{/if}` block (ticket card + balance grid + due donut chart) out of
`src/routes/employee/dashboard/+page.svelte` verbatim, parameterized by a `userId`
prop. Owns its own data loading (`meal_rates`, `meal_entries`, `payments`,
`ordering_pause`), the `markEating()` handler, and the donut chart lifecycle —
identical behavior to today's employee dashboard, just relocated.

**Employee dashboard:** keeps its own `<h1>Welcome, {name}</h1>` header; body becomes
`<MealOrderCard userId={page.data.profile?.id} />`.

**Admin dashboard:** add a new section before the existing "Ordering" card:
```svelte
<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Your meal</p>
  <MealOrderCard userId={adminId} />
</div>
```
Matches the existing small-label-then-card pattern already used for "Ordering" and
"Reminder" on this page. No other admin-dashboard behavior changes.

**Cancellation:** out of scope. Employees cancel via a request-then-approve flow on
`/employee/history`; admin gets no cancel UI for their own meal in this change (they
have no history page). If admin needs to undo a self-order later, that's a follow-up.

## 2. 9am reminder for admin + desktop fallback

**Edge function** (`supabase/functions/send-reminders/index.ts`): broaden the
`employee-reminder` branch's target query from `.eq('role', 'employee')` to
`.in('role', ['employee', 'admin'])`. The rest of the branch (confirmed-today
exclusion, push payload) is already role-agnostic. Requires
`npx supabase functions deploy send-reminders` to take effect — no code change reaches
production without that manual redeploy step (existing project convention, not new).

**Local fallback** (`src/lib/androidReminders.ts` → renamed
`src/lib/nativeReminders.ts`, since it no longer only covers Android):
- Add `isTauriNative()` (`'__TAURI_INTERNALS__' in window`, no OS check) alongside the
  existing `isTauriAndroid()`. The scheduled foreground check-loop
  (`initAndroidReminders`, renamed `initNativeReminders`) gates on `isTauriNative()`
  instead of `isTauriAndroid()`, so it now runs on desktop Tauri builds too.
- For `role === 'admin'`, the loop's per-tick check calls both
  `checkEmployeeReminder(userId)` (9am, "have you ordered" — reusing the existing
  generic function unchanged) and `checkAdminReminder(userId)` (10:30, pause check).
  For `role === 'employee'`, unchanged (`checkEmployeeReminder` only).
- The Android-only order-broadcast realtime listener (`initOrderBroadcastListener`,
  FCM registration) stays gated on `isTauriAndroid()` specifically — desktop does not
  get FCM or the on-demand broadcast fallback, only the two scheduled local checks.
  This matches what was asked (9am reminder everywhere); the on-demand "notify to
  order" broadcast was not part of this request.
- Update the two call sites (`src/routes/admin/+layout.svelte`,
  `src/routes/employee/+layout.svelte`): import path and the renamed
  `initNativeReminders` function.

**README:** update the "Push reminders setup" section — admin now also gets the 9am
push, and desktop gets the same foreground-only local fallback Android had pre-FCM
(explicitly note: no notification if the desktop app is fully closed).

## Testing

- `npm run check` (svelte-check, catches `.svelte` type errors `tsc` alone would miss
  per this repo's existing convention).
- `npm test` (vitest) — no new pure-logic function is introduced (the reminder checks
  and balance math are unchanged), so no new unit test file; existing
  `meals.test.ts`/`guards.test.ts` must keep passing.
- Manual smoke test (per this repo's existing convention of headless-Chrome / real
  browser checks): log in as the seeded admin, confirm the "Your meal" card appears on
  `/admin/dashboard`, mark eating, confirm balance updates and matches the same numbers
  an equivalent employee would see for one meal at the current rate.
- Cannot verify the 9am/10:30am cron firing end-to-end in this session (depends on
  whether VAPID keys / Supabase Cron Jobs / FCM secrets are already configured per
  README — that's an operational prerequisite outside this branch's code).

## Out of scope

- Admin cancelling their own self-ordered meal (no history/cancel-request UI for
  admin) — follow-up if needed.
- True background push on desktop when the app is fully closed (would need OS-level
  integration beyond `tauri-plugin-notification`'s foreground/running capability) —
  not attempted here.
- Configurable reminder times/timezone — unchanged, still hardcoded Asia/Dhaka
  9:00/10:30 per the original design.
