-- Runs automatically on `supabase db reset`. Seeds one admin so local dev and
-- verify-rls.mjs have a working account without a manual Studio step.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'admin@example.com',
  crypt('admin1234', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now(),
  '', '', '', ''
);

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(),
  id::text,
  id,
  jsonb_build_object('sub', id::text, 'email', email),
  'email',
  now(), now(), now()
from auth.users where email = 'admin@example.com';

insert into public.profiles (id, name, role)
select id, 'Admin', 'admin' from auth.users where email = 'admin@example.com';

-- Without an active rate, meal_entries_enforce_invariants rejects every insert
-- (including verify-rls.mjs's own fixture row) - seed one so a clean reset works.
insert into public.meal_rates (rate, effective_from, created_by)
select 100, '2026-01-01', id from auth.users where email = 'admin@example.com';
