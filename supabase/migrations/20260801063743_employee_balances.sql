-- Fixes from the admin-flow final review.

-- 1. Server-side balance aggregation.
-- The admin employees page used to fetch every meal_entries and payments row
-- into the browser and reduce them there. PostgREST caps responses at
-- max_rows = 1000 (supabase/config.toml) with no error, so past ~1000 rows the
-- fetch silently truncated and every employee's `due` went quietly wrong.
-- Aggregating in Postgres removes the row cap from the path entirely: the
-- result is one row per employee no matter how many entries exist.
create or replace function employee_balances()
returns table (user_id uuid, total_eaten bigint, total_cost numeric, total_paid numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;

  return query
  select p.id,
         coalesce(e.n, 0)::bigint,
         coalesce(e.cost, 0)::numeric,
         coalesce(pay.paid, 0)::numeric
  from profiles p
  left join (
    select me.user_id, count(*) n, sum(me.rate_applied) cost
    from meal_entries me where me.status = 'CONFIRMED' group by me.user_id
  ) e on e.user_id = p.id
  left join (
    select pm.user_id, sum(pm.amount) paid from payments pm group by pm.user_id
  ) pay on pay.user_id = p.id
  where p.role = 'employee';
end;
$$;

grant execute on function employee_balances() to authenticated;
revoke execute on function employee_balances() from public;

-- 4. Payment amount had no validation anywhere: a blank field submitted
-- Number('') = 0 and inserted a phantom zero-amount payment. The `min="0"`
-- attribute on the input is inert (the inputs aren't in a <form>, the Save
-- button is a plain onclick). The DB is the real boundary.
alter table payments add constraint payments_amount_positive check (amount > 0);

-- 8. Pin the audit-trail attribution columns to the caller. Without this an
-- admin could attribute a rate change or a payment to a different profile via
-- a raw REST call.
drop policy "meal_rates_insert_admin" on meal_rates;
create policy "meal_rates_insert_admin" on meal_rates
  for insert with check (is_admin() and created_by = auth.uid());

drop policy "payments_insert_admin" on payments;
create policy "payments_insert_admin" on payments
  for insert with check (is_admin() and recorded_by = auth.uid());

-- 9. `create function` grants EXECUTE to PUBLIC by default, so the existing
-- `grant ... to authenticated` didn't actually exclude anon the way it reads.
-- is_admin() still gates the bodies, but make the grant match the intent.
revoke execute on function approve_cancel_request(uuid) from public;
revoke execute on function reject_cancel_request(uuid) from public;
