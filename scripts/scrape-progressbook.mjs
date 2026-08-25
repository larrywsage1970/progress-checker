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
// page's collapsed summary table — verified against the real page.
// Teacher and missing-assignment detail live behind a per-course "see all
// details" page and aren't extracted yet: an earlier attempt to click into
// expanded rows/detail pages proved unreliable (risked following the
// course's own link and navigating off the Grades page entirely), and
// there's no real missing-assignment data yet this early in the school
// year to verify that logic against anyway. Worth revisiting once
// assignments start showing up.

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

// Reads name + grade directly from each course's collapsed summary row
// (Course | Grade | As Of columns) — no clicking. Expanding a row risks
// following the course's own name link instead of a dedicated toggle,
// which navigates away from the Grades page entirely; reading only the
// already-rendered collapsed table sidesteps that risk completely.
// Teacher and missing-assignment detail (which lives behind a per-course
// "see all details" page) aren't extracted yet — see the file header note.
async function extractGrades(page) {
  const origin = new URL(page.url()).origin;
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

    courses.push({ name, teacher: null, grade, missingAssignments: [] });
  }

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
