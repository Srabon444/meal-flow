-- Admin "notify to order" broadcast. Web/desktop get the actual push via
-- push_subscriptions + web-push (see notify-order edge function); Android has
-- no background push (no FCM), so an open Android app instead listens to this
-- table over Realtime and fires a local notification with a custom sound.
-- Row content carries no sensitive data - just a timestamp - so any signed-in
-- user can read it.

create table public.order_broadcasts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.order_broadcasts enable row level security;

create policy "order_broadcasts_select_authed" on public.order_broadcasts
  for select using (auth.uid() is not null);

create policy "order_broadcasts_admin_insert" on public.order_broadcasts
  for insert with check (is_admin());

grant select, insert on public.order_broadcasts to authenticated;
grant select, insert on public.order_broadcasts to service_role;

alter publication supabase_realtime add table public.order_broadcasts;
