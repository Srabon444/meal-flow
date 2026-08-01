-- Data API roles get no table privileges by default (Supabase no longer
-- auto-exposes new tables); RLS only runs after this check passes.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update on
  public.profiles,
  public.meal_rates,
  public.meal_entries,
  public.cancel_requests,
  public.payments
to authenticated;

grant select, insert, update, delete on
  public.profiles,
  public.meal_rates,
  public.meal_entries,
  public.cancel_requests,
  public.payments
to service_role;

grant execute on function public.is_admin() to authenticated, service_role;
