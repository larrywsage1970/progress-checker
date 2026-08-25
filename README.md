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
- One tab per kid (currently Avery / Caleb) — a tab for a student not yet
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

**Status:** login and per-course grade extraction (course name, current
grade) work end-to-end, verified against the real ProgressBook site.
Teacher and missing-assignment detail aren't extracted yet — that requires
clicking into each course's expanded row/detail page, which proved
unreliable in an earlier attempt (risked following the course's own link
and navigating off the Grades page), plus there's no real missing-assignment
data yet this early in the school year to verify that logic against anyway.

**Multiple students:** the app has a tab per kid (`STUDENT_TABS` in
`app.js`), and `data/grades.json` is shaped as `{ updatedAt, students: [{
name, courses }] }` to support more than one. The scraper itself only
populates Avery so far — `STUDENT_NAME` is hardcoded in
`scripts/scrape-progressbook.mjs` since Caleb isn't linked to the
ProgressBook account yet, so there's no student-switcher UI to scrape a
second name/dataset from. Once Caleb is linked, that hardcoding needs to be
replaced with logic that loops over each student ProgressBook shows in its
switcher — that'll need a screenshot of what that switcher actually looks
like to build against real markup instead of guessing.

**Security note:** if a ProgressBook password is ever pasted into a chat,
screen share, or any non-secret location, treat it as compromised and
change it — don't reuse a password that's been exposed that way as the one
stored in GitHub Secrets.
