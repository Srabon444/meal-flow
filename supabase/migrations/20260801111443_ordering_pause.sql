-- Kill-switch for new meal orders. A row present for a date means ordering
-- is closed that date; deleting the row reopens it. No cron/cleanup needed
-- for the "auto-resets tomorrow" requirement — tomorrow's date simply has
-- no row yet.

create table public.ordering_pause (
  paused_date date primary key,
  paused_by uuid not null references public.profiles(id),
  paused_at timestamptz not null default now()
);

alter table public.ordering_pause enable row level security;

-- Anyone logged in can see whether ordering is paused today (employees need
-- this to show the "closed" banner); only admins can open/close it.
create policy "ordering_pause_select_authed" on public.ordering_pause
  for select using (auth.uid() is not null);

create policy "ordering_pause_admin_write" on public.ordering_pause
  for all using (is_admin()) with check (is_admin());

grant select, insert, update, delete on public.ordering_pause to authenticated;
grant select, insert, update, delete on public.ordering_pause to service_role;

-- Defense in depth: the real gate against new meal_entries on a paused date.
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
