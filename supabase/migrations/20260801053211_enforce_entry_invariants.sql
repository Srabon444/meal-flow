-- Money-integrity invariants enforced in Postgres, not just the browser.
-- RLS only checks ownership, so a raw REST insert could previously set any
-- rate_applied / status it liked. These triggers overwrite both server-side.
-- Deliberately NOT validating entry_date against the server clock: "is this
-- really today" needs per-user timezone data this schema doesn't carry.

create or replace function enforce_meal_entry_invariants()
returns trigger
language plpgsql
as $$
declare
  active_rate numeric(10,2);
begin
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

create trigger meal_entries_enforce_invariants
before insert on meal_entries
for each row execute function enforce_meal_entry_invariants();

create unique index cancel_requests_one_pending_per_entry
on cancel_requests (meal_entry_id)
where status = 'PENDING';

create or replace function enforce_cancel_request_status()
returns trigger
language plpgsql
as $$
begin
  new.status := 'PENDING';
  new.reviewed_by := null;
  new.reviewed_at := null;
  return new;
end;
$$;

create trigger cancel_requests_enforce_status
before insert on cancel_requests
for each row execute function enforce_cancel_request_status();
