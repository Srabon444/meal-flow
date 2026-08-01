# OfficeMeal

Office meal ordering, tally, dues, and cancel-approval workflow. See `office-meal-app-prompt.md` for the full source spec and `docs/superpowers/specs/` for sub-project designs.

## Local development

1. `npm install`
2. `npx supabase start` (requires Docker running)
3. Copy `.env.example` to `.env`, fill in values from `npx supabase status`
4. `npm run dev` for web, or `npm run tauri dev` for the desktop shell

`supabase db reset` seeds one admin account (`admin@example.com` / `admin1234`) via
`supabase/seed.sql` — that's the only account with no set-up step; every employee
account is created through the admin UI (`/admin/employees`), which hands back a
temporary password to share with them. There is no public signup.

In production, seed.sql doesn't run — bootstrap the first admin manually: create the
user in the Supabase dashboard, then `insert into profiles (id, name, role) values
('<their auth user id>', '<name>', 'admin');`.

## Deploying

- **Database:** `npx supabase link --project-ref <ref>` once, then `npx supabase db push`
  for any new migration and `npx supabase functions deploy` for any new/changed edge
  function. Neither runs automatically — always a manual step after merging.
- **Web:** Vercel is wired to this repo's GitHub integration outside this codebase —
  pushing to `master` deploys automatically. Framework preset "Other", build command
  `npm run build`, output directory `build` (this is `adapter-static`, not
  `adapter-vercel`, since the same build also feeds Tauri). Needs `PUBLIC_SUPABASE_URL`
  / `PUBLIC_SUPABASE_ANON_KEY` set in Vercel's project environment variables.
- **Desktop/mobile:** `.github/workflows/release.yml` builds Linux/Windows/Android on
  every push to `master` and publishes a GitHub Release. Needs the same two
  `PUBLIC_SUPABASE_*` values as GitHub Actions repo secrets (separate from Vercel's).

## Sub-projects

1. Foundation (schema, auth, scaffold) — this repo's current state
2. Employee flow — meal entry, history, cancel request, balance
3. Admin flow — tally, rate management, payments, cancel approval, reports
4. Charts
5. CI/CD release pipeline
