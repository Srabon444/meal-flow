-- Same silent-truncation bug class as employee_balances(): the admin reports
-- meals-per-day chart selected every CONFIRMED meal_entries row in the last 30
-- days and counted them in the browser. PostgREST caps responses at
-- max_rows = 1000 (supabase/config.toml) with no error, so past 1000 entries
-- (~34 employees eating daily) arbitrary days were silently undercounted --
-- worse without an ORDER BY, since which rows survive is unspecified.
-- Aggregating in Postgres bounds the result to one row per day.
create or replace function meals_per_day(since date)
returns table (entry_date date, meal_count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;

  return query
  select me.entry_date, count(*)::bigint
  from meal_entries me
  where me.status = 'CONFIRMED' and me.entry_date >= since
  group by me.entry_date;
end;
$$;

grant execute on function meals_per_day(date) to authenticated;
revoke execute on function meals_per_day(date) from public;
