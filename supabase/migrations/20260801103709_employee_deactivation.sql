-- "Remove employee" used to hard-delete the auth user, which cascades to
-- profiles but then hits a FK violation on meal_entries/cancel_requests/
-- payments (no cascade there on purpose - deleting someone's history to
-- remove their account would destroy dues/payment records needed after
-- they leave). Deactivating instead: block login via GoTrue's ban_duration,
-- keep every row intact, reversible.

alter table public.profiles add column active boolean not null default true;

-- Defense in depth: GoTrue's ban blocks new token issuance/refresh, but an
-- already-issued JWT stays valid until it expires (up to jwt_expiry). This
-- closes that window server-side for the one insert that creates a charge.
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
