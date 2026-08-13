-- employee_balances() excluded role='admin' from the start, back when admins
-- couldn't self-order and so never accrued a balance. Now that they can (see
-- admin dashboard's "Your meal" card), this left admin's own meal count/dues
-- invisible on the admin employees page — same bug class as
-- admin-list-employees's role filter, fixed alongside this.

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
  where p.role in ('employee', 'admin');
end;
$$;
