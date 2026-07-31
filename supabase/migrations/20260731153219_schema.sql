create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('employee','admin')),
  created_at timestamptz not null default now()
);

create table meal_rates (
  id uuid primary key default gen_random_uuid(),
  rate numeric(10,2) not null,
  effective_from date not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table meal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  entry_date date not null,
  status text not null default 'CONFIRMED' check (status in ('CONFIRMED','CANCELLED')),
  rate_applied numeric(10,2) not null,
  created_at timestamptz not null default now(),
  unique (user_id, entry_date)
);

create table cancel_requests (
  id uuid primary key default gen_random_uuid(),
  meal_entry_id uuid not null references meal_entries(id),
  requested_by uuid not null references profiles(id),
  reason text,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  amount numeric(10,2) not null,
  note text,
  recorded_by uuid not null references profiles(id),
  paid_at timestamptz not null default now()
);
