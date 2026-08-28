// Reads each kid's Google Classroom assignments via the official Classroom
// API (not scraping — Google actively blocks scripted logins, so this uses
// OAuth refresh tokens obtained once via scripts/get-classroom-token.mjs
// instead). Writes data/classroom.json, shaped like data/grades.json's
// per-course assignment lists so the app can reuse the same rendering.
//
// Deliberately a SEPARATE data file/section from ProgressBook, not merged
// into it: a Classroom course name won't reliably match its ProgressBook
// gradebook name (e.g. a teacher's own class title vs. the district's
// official course name), so guessing a match would risk silently showing
// assignments under the wrong class. Simpler and more honest to keep the
// two sources visually separate in the app.
//
// Required env vars:
//   CLASSROOM_CLIENT_ID
//   CLASSROOM_CLIENT_SECRET
//   CLASSROOM_REFRESH_TOKEN_<NAME>  one per student in STUDENTS below,
//                                    e.g. CLASSROOM_REFRESH_TOKEN_AVERY.
//                                    A student with no refresh token set is
//                                    skipped (logged, not fatal) -- lets
//                                    this ship before every kid has one.

import { writeFile, mkdir } from "node:fs/promises";

const CLIENT_ID = process.env.CLASSROOM_CLIENT_ID;
const CLIENT_SECRET = process.env.CLASSROOM_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing CLASSROOM_CLIENT_ID / CLASSROOM_CLIENT_SECRET env vars.");
  process.exit(1);
}

// Same two kids as scrape-progressbook.mjs's STUDENTS -- kept as a separate
// list here (rather than imported) since this one maps to env var names,
// not a ProgressBook switcher label.
const STUDENTS = [
  { name: "Avery", envVar: "CLASSROOM_REFRESH_TOKEN_AVERY" },
  { name: "Kaleb", envVar: "CLASSROOM_REFRESH_TOKEN_KALEB" },
];

async function getAccessToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function classroomGet(accessToken, path) {
  const res = await fetch(`https://classroom.googleapis.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Classroom API ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

// Paginates a Classroom list endpoint (courses / courseWork / submissions
// all share this { items, nextPageToken } shape) and returns every item.
async function classroomListAll(accessToken, path, itemsKey) {
  let items = [];
  let pageToken;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const url = pageToken ? `${path}${sep}pageToken=${pageToken}` : path;
    const data = await classroomGet(accessToken, url);
    items = items.concat(data[itemsKey] || []);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

function formatDueDate(dueDate) {
  if (!dueDate) return null;
  const d = new Date(dueDate.year, dueDate.month - 1, dueDate.day);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isPastDue(dueDate) {
  if (!dueDate) return false;
  const d = new Date(dueDate.year, dueDate.month - 1, dueDate.day, 23, 59, 59);
  return d.getTime() < Date.now();
}

async function fetchStudentClassroom(refreshToken) {
  const accessToken = await getAccessToken(refreshToken);
  const courses = await classroomListAll(accessToken, "courses?courseStates=ACTIVE", "courses");

  const result = [];
  for (const course of courses) {
    const courseWork = await classroomListAll(accessToken, `courses/${course.id}/courseWork`, "courseWork").catch((err) => {
      console.error(`  Failed reading courseWork for ${course.name}:`, err.message);
      return [];
    });

    const assignments = [];
    for (const work of courseWork) {
      const submissions = await classroomListAll(
        accessToken,
        `courses/${course.id}/courseWork/${work.id}/studentSubmissions?userId=me`,
        "studentSubmissions"
      ).catch((err) => {
        console.error(`  Failed reading submission for "${work.title}":`, err.message);
        return [];
      });
      const submission = submissions[0];
      const turnedIn = submission?.state === "TURNED_IN" || submission?.state === "RETURNED";
      const missing = !turnedIn && isPastDue(work.dueDate);
      const score = submission?.assignedGrade != null && work.maxPoints != null
        ? `${submission.assignedGrade}/${work.maxPoints}`
        : null;

      assignments.push({
        name: work.title,
        dueDate: formatDueDate(work.dueDate),
        score,
        missing: missing || submission?.late === true,
      });
    }

    result.push({ name: course.name, assignments });
  }

  return result;
}

async function main() {
  const students = [];

  for (const { name, envVar } of STUDENTS) {
    const refreshToken = process.env[envVar];
    if (!refreshToken) {
      console.log(`No ${envVar} set -- skipping ${name}.`);
      continue;
    }
    try {
      console.log(`Fetching Classroom data for ${name}...`);
      const courses = await fetchStudentClassroom(refreshToken);
      console.log(`  ${courses.length} course(s), ${courses.reduce((n, c) => n + c.assignments.length, 0)} assignment(s) total.`);
      students.push({ name, courses });
    } catch (err) {
      console.error(`Failed fetching Classroom data for ${name}, skipping:`, err.message);
    }
  }

  await mkdir("data", { recursive: true });
  await writeFile("data/classroom.json", JSON.stringify({ updatedAt: new Date().toISOString(), students }, null, 2));
  console.log(`Wrote data/classroom.json (${students.length} student(s)).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
