# OfficeMeal

Office meal ordering, tally, dues, and cancel-approval workflow. See `office-meal-app-prompt.md` for the full source spec and `docs/superpowers/specs/` for sub-project designs.

## Local development

1. `npm install`
2. `npx supabase start` (requires Docker running)
3. Copy `.env.example` to `.env`, fill in values from `npx supabase status`
4. `npm run dev` for web, or `npm run tauri dev` for the desktop shell

## Sub-projects

1. Foundation (schema, auth, scaffold) — this repo's current state
2. Employee flow — meal entry, history, cancel request, balance
3. Admin flow — tally, rate management, payments, cancel approval, reports
4. Charts
5. CI/CD release pipeline
