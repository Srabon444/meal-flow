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
