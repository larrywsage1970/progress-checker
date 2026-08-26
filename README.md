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
- Missing assignments flagged per class
- Tap a teacher's name to email them — opens your phone's default mail app
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

**Status:** login, per-course grade extraction, and missing-assignment
detection all work end-to-end, verified against the real ProgressBook site.
Missing-assignment detection reads each course's "see all details (N)" link
on the Grades page (skipping courses with N=0, nothing to look at) and, on
the Assignment/Class detail page, flags any row whose Info-column status
badge has a title/tooltip matching "missing" — a real ProgressBook status
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
