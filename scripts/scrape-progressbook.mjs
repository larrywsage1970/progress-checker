// Logs into ProgressBook (NEOnet-hosted ParentAccess) and writes a clean
// per-student summary of grades + missing assignments to data/grades.json
// (shape: { updatedAt, students: [{ name, courses: [...] }] }) for the
// app's per-student tabs to read. Credentials come from env vars only —
// never hardcode or log them.
//
// Required env vars:
//   PROGRESSBOOK_URL       the district's ParentAccess home page, e.g.
//                          https://pa.neonet.org/district/st — this lands on a public
//                          district page (calendar etc.) with a "Sign In" button; clicking
//                          it is what kicks off a fresh SSO handshake to the real login form.
//                          NOT a one-time ?signin=... link copied from a browser session —
//                          that token is bound to the session that minted it and fails with
//                          a generic SSO error when hit cold from a fresh browser context.
//   PROGRESSBOOK_USERNAME
//   PROGRESSBOOK_PASSWORD
//
// Login redirects from the ca.neonet.org auth gateway to the actual
// ProgressBook app (pa.neonet.org for NEOnet districts) — the app origin is
// read from the post-login URL rather than hardcoded, so this keeps working
// if that changes.
//
// Grade extraction reads course name + grade directly from the Grades
// page's collapsed summary table — verified against the real page. Each
// course row also has a "see all details" link to its Assignment/Class
// detail page; we visit that page (when the link exists — some rows like
// LUNCH/STUDY HALL have no assignments and no such link) to read every
// assignment that makes up the grade, not just missing ones.
//
// Missing-assignment detection: verified against a real Grade Details page
// (a course with a graded-zero assignment). Each assignment row's Info
// column carries a small status badge with a title/tooltip attribute for
// flagged items (e.g. "Missing") — a plain ungraded/not-yet-due row (blank
// mark) carries no such badge, so this is a real status signal from
// ProgressBook itself, not a guess inferred from the raw score. The other
// cells beyond date/name (category, points, score — exact columns vary)
// are just joined together as a display string rather than parsed into
// separate fields, since only date/name positions have been verified.
//
// Multiple students: after login, loops over each student in STUDENTS,
// clicking their entry in the Dashboard's footer switcher (a client-side
// swap — no URL change) before running the same Grades/Planner extraction
// for whichever student is now selected. See selectStudent() and STUDENTS.

import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";

const LOGIN_URL = process.env.PROGRESSBOOK_URL;
const USERNAME = process.env.PROGRESSBOOK_USERNAME;
const PASSWORD = process.env.PROGRESSBOOK_PASSWORD;

if (!LOGIN_URL || !USERNAME || !PASSWORD) {
  console.error("Missing PROGRESSBOOK_URL / PROGRESSBOOK_USERNAME / PROGRESSBOOK_PASSWORD env vars.");
  process.exit(1);
}

async function login(page) {
  const response = await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  console.log(`Loaded ${page.url()} (status ${response?.status()})`);

  // PROGRESSBOOK_URL lands on the district's public home page (calendar etc.),
  // not a login form. Clicking its "Sign In" button is what kicks off a
  // fresh SSO handshake with the correct app context — hitting the auth
  // gateway directly without this step is what caused earlier failures.
  const districtSignIn = page.getByRole("button", { name: "Sign In" }).or(page.getByRole("link", { name: "Sign In" }));
  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    districtSignIn.first().click(),
  ]);
  console.log(`After district Sign In click, at ${page.url()}`);

  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password").fill(PASSWORD);
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.getByRole("button", { name: "Sign In" }).click(),
  ]);
}

// Both kids linked to this ProgressBook account, with their exact switcher
// label text (confirmed via screenshot of the footer bar on
// /Student/Dashboard — "AVERY SAGE" / "KALEB SAGE", each clickable).
// Hardcoded rather than scraped off the page: there are only ever these
// two, and scraping the switcher itself to discover names adds a layer of
// guesswork for no benefit over just listing them directly.
const STUDENTS = [
  { switcherLabel: "AVERY SAGE", name: "Avery" },
  { switcherLabel: "KALEB SAGE", name: "Kaleb" },
];

// Selects a student in the Dashboard's footer switcher. This does NOT
// change the URL when clicked — confirmed directly by the user testing it
// in a browser — it's a client-side swap that sets which student
// subsequent page navigations (Grades, Planner, etc.) show. Always
// navigates to Dashboard fresh first rather than assuming where the page
// already is, since course/assignment extraction leaves it somewhere else
// entirely (an Assignment/Class or Planner page) between students.
async function selectStudent(page, origin, switcherLabel) {
  await page.goto(`${origin}/Student/Dashboard`, { waitUntil: "networkidle" });
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.getByText(switcherLabel, { exact: true }).first().click(),
  ]);
}

// Periods that are never graded (lunch, study hall, credit recovery) — no
// point showing an always-empty card for these.
const EXCLUDED_COURSES = /^(lunch\.?|study hall|credit recovery)$/i;

// Pass 1: read every course's name, grade, and "see all details" link/count
// off the Grades page's collapsed summary table — no clicking, no
// navigation, so nothing here risks following a link off the page.
async function listCourses(page, origin) {
  await page.goto(`${origin}/Student/Grades`, { waitUntil: "networkidle" });

  const courseLinks = page.getByRole("link", { name: /- Section:/ });
  const courseCount = await courseLinks.count();

  const courses = [];
  for (let i = 0; i < courseCount; i++) {
    const link = courseLinks.nth(i);
    const fullName = (await link.textContent()).trim();
    const name = fullName.split(" - Section:")[0].trim();

    // These periods never carry a grade (lunch, a study hall, credit
    // recovery) — skip them rather than show an always-empty card.
    if (EXCLUDED_COURSES.test(name)) continue;

    // Find the cell containing the course name and take the next one as the
    // grade, rather than a hardcoded column index — the row has a leading
    // expand/collapse cell before Course | Grade | As Of that shifted a
    // fixed index off by one on the first attempt.
    const row = link.locator("xpath=ancestor::tr[1]");
    const cells = await row.locator("td, th").allTextContents().catch(() => []);
    const nameIdx = cells.findIndex((c) => c.includes(fullName));
    const rawGrade = nameIdx >= 0 ? cells[nameIdx + 1]?.trim() : null;
    const grade = rawGrade && rawGrade.toLowerCase() !== "n/a" ? rawGrade : null;

    // Visit the detail page whenever the link exists at all, not just when
    // its count is > 0 — we want the full assignment list (for the "make up
    // the grade" view), not only courses with something flagged missing.
    const detailLink = row.getByRole("link", { name: /see all details/i });
    const hasDetail = await detailLink.count() > 0;
    const detailHref = hasDetail ? await detailLink.getAttribute("href").catch(() => null) : null;

    courses.push({
      name,
      teacher: null,
      teacherEmail: null,
      grade,
      detailUrl: detailHref ? new URL(detailHref, origin).toString() : null,
    });
  }

  return courses;
}

// The Planner page has no homework data (teachers here don't use it — see
// file header), but it does show each class's teacher name and a mailto:
// link, which the Grades/Assignment pages don't. Matches purely by course
// name text already known from listCourses(), rather than guessing at the
// Planner's section markup, and takes the nearest mailto: link that follows
// each course-name heading in document order.
async function attachTeacherEmails(page, origin, courses) {
  await page.goto(`${origin}/Student/Planner`, { waitUntil: "networkidle" });

  for (const course of courses) {
    const heading = page.getByText(course.name, { exact: true }).first();
    if (await heading.count() === 0) continue;

    const mailLink = heading.locator("xpath=following::a[starts-with(@href,'mailto:')][1]");
    const href = await mailLink.getAttribute("href").catch(() => null);
    const email = href?.replace(/^mailto:/i, "").trim();
    // Some mailto: links on this page aren't a teacher's address at all
    // (e.g. a generic "email this page" control) — a blank or addressless
    // href is the tell; skip those rather than writing a dead link.
    if (email?.includes("@")) course.teacherEmail = email;
  }
  // Teacher display name isn't extracted — a first attempt at guessing its
  // position relative to the mailto link (nearest preceding sibling)
  // matched nothing for any course, so rather than guess again blind, the
  // app falls back to showing the email address itself as the link text.
}

// Pass 2: for a course with an Assignment/Class detail page, read every
// assignment row — not just missing ones — so the app can show what makes
// up the grade. Each row's Info-column status badge flags missing items (a
// real ProgressBook status signal — a tooltip/title attribute on the badge —
// not inferred from the raw score, since an ungraded-but-not-due row also
// shows a blank score with no such badge).
async function extractAssignments(page, detailUrl) {
  await page.goto(detailUrl, { waitUntil: "networkidle" });

  const rows = page.locator("tr").filter({ has: page.locator("td") });
  const rowCount = await rows.count();

  // The page has a "View By: Date | Type" toggle — both groupings appear to
  // exist in the DOM at once (one hidden), which doubled every result in a
  // real run. Dedupe by name+date rather than try to scope to only the
  // visible grouping, since which one is visible could depend on state.
  const seen = new Set();
  const assignments = [];
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const isMissing = await row.getByTitle(/missing/i).count() > 0;
    // Cells can carry a hidden accessible-text duplicate of the status badge
    // (stray literal "<br/>" text plus internal newlines/indentation, e.g.
    // "0/5\n...(0%) · M\n...Missing<br/>") — collapse whitespace and strip
    // any literal tag text so the score reads as one clean line.
    const cells = (await row.locator("td").allTextContents().catch(() => []))
      .map((c) => c.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    const [date, name, ...rest] = cells;
    if (!name) continue;
    const key = `${date}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const score = rest.filter(Boolean).join(" · ") || null;
    assignments.push({ name, dueDate: date || null, score, missing: isMissing });
  }

  console.log(`  ${assignments.length} assignment row(s) (${assignments.filter((a) => a.missing).length} missing) at ${detailUrl}`);
  return assignments;
}

// Runs the full listCourses -> missing-assignments -> teacher-emails
// pipeline for whichever student is currently selected.
async function extractCoursesForCurrentStudent(page, origin) {
  const courses = await listCourses(page, origin);

  for (const course of courses) {
    course.assignments = course.detailUrl
      ? await extractAssignments(page, course.detailUrl).catch((err) => {
          console.error(`  Failed reading details for ${course.name}:`, err.message);
          return [];
        })
      : [];
    delete course.detailUrl;
  }

  await attachTeacherEmails(page, origin, courses).catch((err) => {
    console.error("  Failed reading teacher emails from Planner:", err.message);
  });
  console.log(`  Teacher emails found for ${courses.filter((c) => c.teacherEmail).length} of ${courses.length} course(s).`);

  return courses;
}

async function extractGrades(page) {
  const origin = new URL(page.url()).origin;
  const students = [];

  for (const { switcherLabel, name } of STUDENTS) {
    try {
      console.log(`Switching to student: ${name}`);
      await selectStudent(page, origin, switcherLabel);
      const courses = await extractCoursesForCurrentStudent(page, origin);
      students.push({ name, courses });
    } catch (err) {
      // One student's switcher/extraction breaking shouldn't lose data for
      // the other — e.g. if this is the run that first discovers the
      // switcher's real markup doesn't match what selectStudent() expects.
      console.error(`Failed extracting data for ${name}, skipping:`, err.message);
    }
  }

  return { updatedAt: new Date().toISOString(), students };
}

async function dumpDebugSnapshot(page) {
  await mkdir("debug", { recursive: true });
  await page.screenshot({ path: "debug/grades-page.png", fullPage: true });
  await writeFile("debug/grades-page.html", await page.content());
  console.log(`Dumped debug snapshot for ${page.url()}`);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await login(page);

    const grades = await extractGrades(page);
    await dumpDebugSnapshot(page);

    await mkdir("data", { recursive: true });
    await writeFile("data/grades.json", JSON.stringify(grades, null, 2));
    const courseCount = grades.students.reduce((sum, s) => sum + s.courses.length, 0);
    console.log(`Wrote data/grades.json (${grades.students.length} student(s), ${courseCount} course(s) total).`);
  } catch (err) {
    // Always capture what the page actually showed, even (especially) on
    // failure — otherwise a CI failure gives no way to see what broke.
    console.error(`Failed at ${page.url()}`);
    await dumpDebugSnapshot(page).catch((snapshotErr) => {
      console.error("Also failed to capture debug snapshot:", snapshotErr);
    });
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
