create table public.fcm_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);

alter table public.fcm_tokens enable row level security;

create policy fcm_tokens_own on public.fcm_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
