# OfficeMeal

Office meal ordering, tally, dues, and cancel-approval workflow. Web (Vercel), desktop
(Linux/Windows via Tauri), and Android — one SvelteKit static build feeds all three.
See `office-meal-app-prompt.md` for the full source spec and `docs/superpowers/specs/`
for sub-project designs.

## Setup (local development)

1. `npm install`
2. `npx supabase start` (requires Docker running — pulls images on first run, can take
   a few minutes)
3. Copy `.env.example` to `.env`, fill in `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY`
   from `npx supabase status`; also set `PUBLIC_VAPID_PUBLIC_KEY` to any non-empty value
   (a throwaway string works locally — `npm run build`/`npm run check` fail without it,
   see "Push reminders setup" for the real value)
4. `npm run dev` for web, or `npm run tauri dev` for the desktop shell

`supabase db reset` seeds one admin account (`admin@example.com` / `admin1234`) via
`supabase/seed.sql` — that's the only account with no set-up step; every employee
account is created through the admin UI (`/admin/employees`), which hands back a
temporary password to share with them (they can change it themselves from
`/employee/settings` after signing in). There is no public signup.

In production, `seed.sql` doesn't run — bootstrap the first admin manually: create the
user in the Supabase dashboard, then `insert into profiles (id, name, role) values
('<their auth user id>', '<name>', 'admin');`.

## Build

- `npm run check` — type-checks **including `.svelte` files** (svelte-check). Always
  use this, not `npx tsc --noEmit` — the latter silently skips every `.svelte` file in
  the repo, which let real type errors ship undetected for a while during development.
- `npm run build` — produces the static site in `build/` (`adapter-static`). This same
  output feeds Vercel, and it's what Tauri wraps for desktop/mobile.
- `npm run tauri dev` / `npm run tauri build` — desktop dev/build locally (needs Rust +
  platform build tools; see [Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/)).

## Release (deploying to production)

None of this is automated end-to-end yet — treat it as a manual checklist after
merging to `master`.

- **Database:** `npx supabase link --project-ref <ref>` once, then `npx supabase db push`
  for any new migration and `npx supabase functions deploy` for any new/changed edge
  function.
- **Web:** Vercel is wired to this repo's GitHub integration outside this codebase —
  pushing to `master` deploys automatically. Framework preset "Other", build command
  `npm run build`, output directory `build`. Needs `PUBLIC_SUPABASE_URL` /
  `PUBLIC_SUPABASE_ANON_KEY` / `PUBLIC_VAPID_PUBLIC_KEY` set in Vercel's project
  environment variables.
- **Desktop/mobile:** `.github/workflows/release.yml` builds Linux, Windows, and
  Android on every push to `master` and publishes a GitHub Release (`app-v<version>`,
  taken from `src-tauri/tauri.conf.json`'s `version` field — bump it before a release
  push if you want a new tag rather than updating the existing one). Needs the same
  three `PUBLIC_SUPABASE_*` / `PUBLIC_VAPID_PUBLIC_KEY` values set as GitHub Actions
  **repo secrets** (Settings → Secrets and variables → Actions) — separate from
  Vercel's copies, same values.

## Push reminders setup

**Set `PUBLIC_VAPID_PUBLIC_KEY` in Vercel and in GitHub Actions repo secrets
BEFORE merging this branch to `master`** — `src/lib/push.ts` imports it from
`$env/static/public`, and SvelteKit only emits an export for an env var that's
actually set, so an unset value is a build-time Rollup error on Vercel (the
deploy fails outright), while an empty-string GitHub Actions secret still
counts as "set" and just ships a silently no-op push feature. This is the
general rule for every env var this branch introduces: they need to exist
pre-merge, not as a manual post-merge checklist item — unlike the rest of the
Release section below, a fresh build depends on this one at compile time.

Employees get a push at 9am (Asia/Dhaka) if they haven't ordered yet; admins get
one at 10:30am if ordering is still open. Real push for the web app. Desktop
and Android builds currently show no reminder in the background — Android gets
an in-app reminder only while the app is open (Tauri has no Firebase Cloud
Messaging plugin for true background push); desktop's webview generally lacks
push service support.

1. **Generate a VAPID keypair** (needed once):
   ```bash
   npx web-push generate-vapid-keys
   ```
2. **Frontend public key** — add to Vercel's project environment variables and
   to this repo's GitHub Actions secrets (Settings → Secrets and variables →
   Actions):
   - `PUBLIC_VAPID_PUBLIC_KEY` — the "Public Key" from step 1
3. **Edge function secrets** — `npx supabase secrets set`:
   - `VAPID_PUBLIC_KEY` — same public key as above
   - `VAPID_PRIVATE_KEY` — the "Private Key" from step 1
   - `VAPID_SUBJECT` — `mailto:<your admin email>`
   - `CRON_SECRET` — any random string, e.g. `openssl rand -hex 32`
4. **Deploy the function:** `npx supabase functions deploy send-reminders`
5. **Schedule the two cron jobs** — Supabase Dashboard → Database → Cron Jobs
   → Create job, twice:
   - Name `employee-reminder`, schedule `0 3 * * *` (9:00 Asia/Dhaka), HTTP
     request to `https://<project-ref>.supabase.co/functions/v1/send-reminders`,
     header `x-cron-secret: <the CRON_SECRET value>`, body `{"kind":"employee-reminder"}`
   - Name `admin-reminder`, schedule `30 4 * * *` (10:30 Asia/Dhaka), same URL
     and header, body `{"kind":"admin-reminder"}`

## Signing the Android build

Without this, the CI-built APK is unsigned and every install shows an "unknown app"
warning. This is a **one-time, permanent** setup — the keystore you generate is the
app's identity forever; if you lose it, a future update can never be signed the same
way again (Android/Play would treat it as a different app).

1. **Generate a keystore, on your own machine** (needs a JDK — Android Studio includes
   one):
   ```bash
   keytool -genkeypair -v -keystore officemeal-release.jks -keyalg RSA -keysize 2048 \
     -validity 10000 -alias officemeal
   ```
   Set a real password when prompted and remember it. **Back up the `.jks` file
   somewhere safe outside this repo** — it's never committed, and there's no recovery
   if it's lost.
2. **Base64-encode it:**
   - Mac/Linux: `base64 -i officemeal-release.jks | tr -d '\n'`
   - Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("officemeal-release.jks"))`
3. **Add 3 repo secrets** (Settings → Secrets and variables → Actions → **Secrets**
   tab):
   - `ANDROID_KEYSTORE_BASE64` — the base64 output from step 2
   - `ANDROID_KEY_ALIAS` — `officemeal` (or whatever alias you used)
   - `ANDROID_KEY_PASSWORD` — the password from step 1
4. **Add 1 repo variable** (same page, **Variables** tab, not Secrets):
   `ANDROID_SIGNING_ENABLED` = `true`. CI checks this before attempting to sign, so a
   partially-configured secret set fails loudly instead of silently shipping unsigned.

Once all four exist, the next push to `master` produces a signed APK automatically.

## Making this repo public

Right now it's private. Here's what actually changes if you flip it to public, and
what doesn't.

**Stays safe, regardless of visibility:**
- **Repo secrets never become visible.** GitHub secrets are write-only from the moment
  they're set — there's no "reveal" anywhere in the UI or API, for anyone, on a public
  or private repo. Values that end up printed in a workflow log get automatically
  redacted (masked) by GitHub, not by anything this repo does.
- **This repo's CI only triggers on `push` to `master` and manual `workflow_dispatch`**
  (`.github/workflows/release.yml`) — it never runs on `pull_request`. That matters
  because GitHub's one real secret-exposure risk on public repos is a malicious fork
  opening a PR that tricks a `pull_request`-triggered workflow into leaking a secret;
  since this workflow doesn't listen for that event at all, that entire attack class
  doesn't apply here. (If a PR-triggered workflow is ever added later, GitHub itself
  already doesn't pass repo secrets to workflows triggered by a fork's `pull_request` —
  the exception to watch for is `pull_request_target`, which does get secrets and
  should never run code from the PR branch.)
- **`PUBLIC_SUPABASE_ANON_KEY` is already public.** It ships inside the compiled
  JavaScript bundle of every web/desktop/mobile build — anyone using the app can already
  read it from their browser's dev tools today, private repo or not. Making the repo
  public doesn't change its exposure at all.
- **The source code being readable doesn't create a bypass.** This was a deliberate
  design goal across every sub-project's build: access control lives in Postgres RLS
  policies and `security definer` functions (`is_admin()` checks, the invariant-
  enforcing triggers on `meal_entries`/`cancel_requests`, the `employee_balances()` /
  `meals_per_day()` RPCs) — not in anything client-side or in keeping the logic secret.
  Knowing exactly how `enforce_meal_entry_invariants()` works doesn't let anyone bypass
  it; the enforcement happens in the database regardless of who can read the trigger's
  SQL.
- **The Android keystore was never a repo-visibility concern in the first place** — it
  lives only on your machine and in GitHub Secrets, never in the repo. The earlier
  suggestion to keep the repo private applied narrowly to *one alternative path* that
  was considered and not taken (having a CI job generate the keystore and hand it back
  via a workflow log or artifact, both of which are publicly downloadable on a public
  repo) — not to the keystore's ongoing storage, which was never in the repo either way.

**Worth checking before you flip it:**
- Skim `git log -p` (or just trust that nothing was ever hand-typed into a committed
  file rather than a secret store — this project consistently used Supabase/GitHub
  secrets throughout, never committed a real key) for anything that looks like a real
  credential. The only credential-shaped thing that *is* committed on purpose is
  `supabase/seed.sql`'s hardcoded local dev password (`admin1234`) — that's fine, it
  only ever applies to a fresh `supabase db reset` on your own machine, never to the
  linked production project.
- Once public, anyone can read `office-meal-app-prompt.md` and the `docs/` folder,
  which describe the app's full design history. Nothing sensitive in them, just worth
  knowing they become public documentation.

**Bottom line: yes, you can make it public without losing the signing setup or
introducing a security issue.** Nothing about Android signing, Supabase security, or
this app's architecture depends on the repo being private.

## Optional: auto-publishing releases to Google Drive

Not implemented — this section only describes the process, for if you want it later.

**Check first: you may already have this for free.** GitHub Releases already exposes
a stable "always the latest" URL per asset that never changes across releases:
`https://github.com/<owner>/<repo>/releases/latest/download/<exact-asset-filename>`
(e.g. `.../releases/latest/download/meal-flow_0.1.0_amd64.AppImage` — note the
filename itself embeds the version, so this only works cleanly if you link to an
asset type whose name pattern you control, or use the GitHub API to resolve the
latest release's actual asset names first). If a permanent link to "whatever APK is
newest" is really the goal, this may already be enough without touching Google Drive
at all.

**If you still want Google Drive specifically**, here's the process:

1. **Google Cloud setup (one-time):** create a GCP project, enable the Google Drive
   API, create a service account, and download its JSON key. Service accounts have
   effectively no storage quota of their own, so create the target Drive folder under
   your **own** human Google account and share it with the service account's email
   (`...@...iam.gserviceaccount.com`) as an **Editor** — the service account then
   writes into your quota, not its own.
2. **Store the credential:** base64-encode the service account JSON, add it as a new
   GitHub Actions secret (e.g. `GDRIVE_SERVICE_ACCOUNT_JSON`).
3. **Upload step in CI, after the build produces the APK:** use a mature, well-
   maintained tool rather than a bespoke script — `rclone` (configured with a Google
   Drive remote pointed at the service account) is the standard choice; it can
   authenticate non-interactively in CI using the same JSON key.
4. **Keep one stable link, don't delete-and-recreate.** Deleting the old file and
   uploading a new one gives the new file a **different** Drive file ID, so any link
   you'd published stops working — that's the opposite of what "the web version links
   to it" wants. Instead, **overwrite the same file's content** each release (`rclone
   copyto` targeting the same remote path, or the Drive API's `files.update` with a
   fixed file ID) so the file ID — and therefore its share link — never changes across
   releases.
5. **Make that one file's link public:** set its sharing permission to "anyone with
   the link can view" once, the first time it's created (`rclone link`, or the Drive
   API's `permissions.create` with `role: reader, type: anyone`). Because you're
   updating the same file going forward, you only need to set this once, ever.
6. **Surface the link on the website.** Since the file ID (and so the link) never
   changes, the simplest approach is to hardcode it once in the frontend after step 5
   — no ongoing sync needed. If the link ever needs to change, the CI job could instead
   commit an update to a small static file the frontend reads (e.g.
   `static/apk-link.json`), which — since Vercel auto-deploys on push to `master` —
   would propagate automatically without a separate database round trip.

**Tradeoffs to weigh:** Drive adds a Google Cloud project, a service account, and a
new secret to maintain, versus GitHub Releases needing none of that (already working,
already versioned, already has a stable "latest" URL pattern). Drive's real advantage
is only relevant if you want a Play-Store-style single download page separate from
GitHub, or need to hand a link to someone without a GitHub-adjacent audience in mind.

## Sub-projects

1. Foundation (schema, auth, scaffold)
2. Employee flow — meal entry, history, cancel request, balance
3. Admin flow — tally, rate management, payments, cancel approval
4. Charts
5. CI/CD release pipeline
