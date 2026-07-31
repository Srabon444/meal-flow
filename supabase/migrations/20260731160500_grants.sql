-- Data API roles (anon, authenticated, service_role) get no table privileges by
-- default on newly created tables (matches the Supabase cloud default). RLS
-- policies from 20260731154045_rls.sql are only evaluated AFTER a role clears
-- this table-privilege check, so without these grants every request is denied
-- before RLS even runs. This grants the baseline CRUD privileges; row-level
-- access is still fully governed by the existing RLS policies.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on
  public.profiles,
  public.meal_rates,
  public.meal_entries,
  public.cancel_requests,
  public.payments
to authenticated, service_role;

grant execute on function public.is_admin() to authenticated, service_role;
