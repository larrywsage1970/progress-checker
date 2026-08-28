# Progress Checker

Clean phone view of ProgressBook grades and (eventually) missing
assignments — no account, no build step, no logging in on your phone.
Installs as a home-screen app (PWA).

## How it works
A scheduled GitHub Action logs into ProgressBook with Playwright, reads the
Grades page, and writes a summary to `data/grades.json`. The app itself only
ever displays what that scraper last wrote — it never logs in on your
device, and your ProgressBook password is never stored anywhere except the
repo's encrypted GitHub Actions secrets.

## Features
- Per-class current grade, updated automatically on a schedule
- Tap a class to expand it and see every assignment that makes up the
  grade, with missing ones flagged (⚠, red text) — collapsed by default,
  with the card's left border (red/blue) showing at a glance whether
  anything's missing
- Check specific assignments in an expanded class, then tap "Email
  teacher" to open your phone's default mail app with a draft already
  addressed and listing what you checked — edit the To: field to send
  the same draft to your kid instead
- "↻ Refresh" button (top of the page) triggers a fresh ProgressBook
  scrape on demand and force-reloads the app itself — fixes both stale
  grade data and a stuck old version of the app on your phone in one tap
- One tab per kid (currently Avery / Kaleb) — a tab for a student not yet
  linked to the ProgressBook account shows a placeholder instead of erroring
- Fully static — no server, no database
- Install to your phone's home screen like a native app

## How it's built
Plain static files — `index.html` + `app.js` — no npm, no bundler for the
app itself (the scraper is the only piece that needs `npm install`). UI is
[Preact](https://preactjs.com/) + [htm](https://github.com/developit/htm),
loaded straight from the esm.sh CDN as native ES modules. A service worker
(`sw.js`) caches the app shell and those CDN modules on first load.

## Install on iPhone
1. Open the deployed URL in Safari
2. Tap the Share icon → **Add to Home Screen**
3. Launch it from the home screen icon — it opens full-screen, no browser chrome

## Local development
No install required for the app itself. Serve the folder with any static
file server, e.g.:
```
scripts/serve.ps1
```
then open http://localhost:8787. Re-run `python3 scripts/generate-icons.py`
(requires `pip install cairosvg`) if you change the icon design.

## Deploy
Static files only — GitHub Pages serves this repo directly from `main` /
root, no CI needed for the app itself.

## ProgressBook sync (scraper)
`.github/workflows/scrape-progressbook.yml` runs `scripts/scrape-progressbook.mjs`
on a schedule (default: every 3 hours, weekdays — edit the `cron` line to
change it), logging into ProgressBook and committing an updated
`data/grades.json`.

**One-time setup:**
1. In the repo's GitHub settings → **Secrets and variables → Actions**, add:
   - `PROGRESSBOOK_URL` — your district's ParentAccess home page, e.g.
     `https://pa.neonet.org/district/st`. This lands on a public district
     page (calendar etc.) with a "Sign In" button; the scraper clicks it to
     kick off a fresh SSO handshake with the correct app context — the bare
     `https://pa.neonet.org/` root shows a district picker instead and won't
     work on its own. **Don't** use a one-time `?signin=...` link copied from
     a browser session/autofill either — that token is bound to the session
     that created it and fails with a generic SSO error ("There is an error
     determining which application you are signing into") when hit cold from
     a fresh browser.
   - `PROGRESSBOOK_USERNAME`
   - `PROGRESSBOOK_PASSWORD`

   These are encrypted at rest and only ever readable by the workflow run —
   never commit credentials to any file in this repo.
2. Run the workflow once manually (Actions tab → **Scrape ProgressBook** →
   **Run workflow**) to confirm login works.
3. After that it runs automatically on the schedule.

**Status:** login, per-course grade extraction, and full assignment-detail
extraction all work end-to-end, verified against the real ProgressBook site.
For every course with a "see all details" link on the Grades page, the
scraper visits its Assignment/Class detail page and reads every assignment
row (name, due date, and whatever else ProgressBook shows for that row —
category/points/score, joined into one display string since exact columns
weren't fully mapped). Each row's Info-column status badge is checked for a
title/tooltip matching "missing" to flag it — a real ProgressBook status
signal, not inferred from the raw score (an ungraded-but-not-yet-due row
also has a blank score but no such badge). Teacher name and email are read
from the Planner page (matched to each course by name) and shown as a
tappable `mailto:` link in the Grades tab — Planner has no homework data
(see below) but does show each class's teacher contact info. Due-soon
tracking (assignments due in the next few days) isn't built: the Planner
page, which would be the natural source for that, is
empty across every class for both kids — teachers at this school aren't
using that ProgressBook feature, so there's nothing real to build against.

**Multiple students:** the app has a tab per kid (`STUDENT_TABS` in
`app.js`), and `data/grades.json` is shaped as `{ updatedAt, students: [{
name, courses }] }`. The scraper (`STUDENTS` in
`scripts/scrape-progressbook.mjs`) now loops over both Avery and Kaleb,
clicking each one's entry in the Dashboard footer switcher (a client-side
swap — no URL change, confirmed by testing it directly) before extracting
that student's data. Not yet verified against a real run at the time of
writing — if a student's switcher click or extraction fails, that student
is skipped (logged, not fatal) rather than losing data for the other one.

**Security note:** if a ProgressBook password is ever pasted into a chat,
screen share, or any non-secret location, treat it as compromised and
change it — don't reuse a password that's been exposed that way as the one
stored in GitHub Secrets.

## On-demand refresh button
The "↻ Refresh" button in the app calls the GitHub API directly from the
browser to trigger `scrape-progressbook.yml` on demand (`GH_TOKEN` near the
top of `app.js`), then force-reloads the app itself once fresh data lands
(or after a timeout).

That token is a **fine-grained GitHub PAT scoped to only "Actions: read and
write" on this one repo** — no code/contents access, no access to any other
repo. It's embedded in this public JS file (view-source shows it to anyone
with the app's URL) — the accepted risk is a stranger triggering extra
scrape runs on this repo (wastes free Actions minutes, nothing more). To
create/rotate it: GitHub Settings → Developer settings → Fine-grained
tokens → generate one scoped to this repo only, Actions: Read and write,
and drop the value into `GH_TOKEN` in `app.js`.

## Google Classroom sync
Some teachers post assignments in Google Classroom instead of (or in
addition to) ProgressBook. `scripts/scrape-classroom.mjs` reads each kid's
Classroom assignments via Google's official Classroom API and writes
`data/classroom.json` — a **separate** file/section from ProgressBook,
shown in the app under its own "GOOGLE CLASSROOM" heading rather than
merged into the ProgressBook course cards, since a Classroom course's name
won't reliably match its ProgressBook gradebook name.

This uses the real API, not scraping: Google actively blocks scripted
logins (CAPTCHA, "this browser may not be secure"), so a Playwright login
like ProgressBook's isn't viable here. Instead it's OAuth — a one-time
consent flow per kid gets a refresh token that the scheduled workflow uses
from then on.

**One-time setup:**
1. **Create a Google Cloud OAuth client** (free, no billing needed):
   - Go to [console.cloud.google.com](https://console.cloud.google.com/),
     create a new project (any name, e.g. "progress-checker").
   - **APIs & Services → Library** → enable **Google Classroom API**.
   - **APIs & Services → OAuth consent screen** → User Type: **External**.
     Fill in an app name/support email, skip scopes on that screen. Leave
     **Publishing status: Testing** — this avoids Google's app-review
     process entirely (fine for personal use with 2 known users) but means
     only accounts added as test users below can sign in.
   - Same consent screen page → **Test users** → add both kids' school
     Google account emails.
   - **APIs & Services → Credentials** → **Create Credentials → OAuth
     client ID** → Application type: **Desktop app** → name it anything.
     Note the **Client ID** and **Client Secret** it generates.
2. **Get a refresh token per kid** (run locally on your own computer, never
   in CI — this needs an interactive browser sign-in):
   ```
   node scripts/get-classroom-token.mjs "<client_id>" "<client_secret>"
   ```
   It prints a Google sign-in URL — open it and **sign in as that kid**
   (not your own account), approve the read-only Classroom scopes, and the
   script prints a refresh token in the terminal. Run it again for the
   other kid (same client ID/secret, different sign-in).
3. In the repo's GitHub settings → **Secrets and variables → Actions**, add:
   - `CLASSROOM_CLIENT_ID`, `CLASSROOM_CLIENT_SECRET` — from step 1
   - `CLASSROOM_REFRESH_TOKEN_AVERY`, `CLASSROOM_REFRESH_TOKEN_KALEB` —
     from step 2. A kid with no refresh token secret set is just skipped
     (logged, not fatal) — the rest of the app keeps working.
4. Run the workflow once manually (Actions tab → **Scrape ProgressBook** →
   **Run workflow**) to confirm it picks up Classroom data — check the
   "Run Classroom sync" step's log.

**Status:** built but untested against real Classroom data at the time of
writing (no refresh tokens exist yet). `missing` is inferred as "due date
has passed and not yet turned in" OR the API's own `late` flag on a
submission — worth double-checking against a real overdue assignment once
this runs for real. A refresh token can be invalidated by Google (password
change, revoked access, 6 months fully unused) — if a kid's sync starts
failing with an auth error, just re-run step 2 for them.
