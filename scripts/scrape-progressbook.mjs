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
// page's collapsed summary table — verified against the real page. The
// "see all details (N)" link's count tells us whether a course's
// Assignment/Class detail page has anything worth visiting, so we only
// navigate into ones with N > 0.
//
// Missing-assignment detection: verified against a real Grade Details page
// (a course with a graded-zero assignment). Each assignment row's Info
// column carries a small status badge with a title/tooltip attribute for
// flagged items (e.g. "Missing") — a plain ungraded/not-yet-due row (blank
// mark) carries no such badge, so this is a real status signal from
// ProgressBook itself, not a guess inferred from the raw score.

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

// STUDENT_NAME is hardcoded rather than scraped off the page: only one
// student (Avery) is linked to this ProgressBook account so far, so
// there's no student-switcher UI yet to scrape a name from, and no risk
// of mislabeling data that clearly belongs to Avery. Once a second student
// is linked, ProgressBook will show a switcher — at that point this needs
// to loop over each linked student (reading their real display name off
// that switcher) instead of a single hardcoded name.
const STUDENT_NAME = "Avery";

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

    // Find the cell containing the course name and take the next one as the
    // grade, rather than a hardcoded column index — the row has a leading
    // expand/collapse cell before Course | Grade | As Of that shifted a
    // fixed index off by one on the first attempt.
    const row = link.locator("xpath=ancestor::tr[1]");
    const cells = await row.locator("td, th").allTextContents().catch(() => []);
    const nameIdx = cells.findIndex((c) => c.includes(fullName));
    const rawGrade = nameIdx >= 0 ? cells[nameIdx + 1]?.trim() : null;
    const grade = rawGrade && rawGrade.toLowerCase() !== "n/a" ? rawGrade : null;

    const detailLink = row.getByRole("link", { name: /see all details/i });
    const detailText = await detailLink.textContent().catch(() => "");
    const detailCount = parseInt(detailText.match(/\((\d+)\)/)?.[1] ?? "0", 10);
    const detailHref = detailCount > 0 ? await detailLink.getAttribute("href").catch(() => null) : null;

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
    if (!href) continue;

    course.teacherEmail = href.replace(/^mailto:/i, "").trim();
    const teacherText = await mailLink.locator("xpath=preceding-sibling::*[1]").textContent().catch(() => null);
    course.teacher = teacherText?.trim() || null;
  }
}

// Pass 2: for a course with assignment detail to look at, visit its
// Assignment/Class page and flag any row whose Info-column status badge
// indicates it's missing (a real ProgressBook status signal — a tooltip/
// title attribute on the badge — not inferred from the raw score, since an
// ungraded-but-not-due row also shows a blank score with no such badge).
async function extractMissingAssignments(page, detailUrl) {
  await page.goto(detailUrl, { waitUntil: "networkidle" });

  const rows = page.locator("tr").filter({ has: page.locator("td") });
  const rowCount = await rows.count();

  const missing = [];
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const isMissing = await row.getByTitle(/missing/i).count() > 0;
    if (!isMissing) continue;
    const cells = await row.locator("td").allTextContents().catch(() => []);
    const [date, name] = cells;
    if (name?.trim()) missing.push({ name: name.trim(), dueDate: date?.trim() ?? null });
  }

  console.log(`  ${missing.length} missing of ${rowCount} row(s) at ${detailUrl}`);
  return missing;
}

async function extractGrades(page) {
  const origin = new URL(page.url()).origin;
  const courses = await listCourses(page, origin);

  for (const course of courses) {
    course.missingAssignments = course.detailUrl
      ? await extractMissingAssignments(page, course.detailUrl).catch((err) => {
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

  return {
    updatedAt: new Date().toISOString(),
    students: [{ name: STUDENT_NAME, courses }],
  };
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
