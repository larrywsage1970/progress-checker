// ONE-TIME LOCAL TOOL — run this yourself, once per kid, on your own
// computer (never in CI). It walks through Google's OAuth consent flow and
// prints a refresh token to save as a GitHub secret. Nothing here talks to
// GitHub or writes any file — the token only ever appears in your terminal.
//
// Usage:
//   node scripts/get-classroom-token.mjs <client_id> <client_secret>
//
// client_id/client_secret come from a Google Cloud OAuth "Desktop app"
// client (see README's Google Classroom section for exact setup steps).
//
// What happens:
//   1. This prints a Google sign-in URL.
//   2. Open it in a browser, sign in as the KID this run is for (not your
//      own Google account), and approve the read-only Classroom scopes.
//   3. Google redirects to http://localhost:53682/ — a tiny local server
//      here catches that, exchanges the code for tokens, and prints the
//      refresh token.
//   4. Save that value as a GitHub secret (e.g. CLASSROOM_REFRESH_TOKEN_AVERY),
//      then run this again for the other kid.
//
// A refresh token doesn't expire from use, but Google can invalidate it
// (password change, revoked access, 6 months fully unused) — if the sync
// ever starts failing with an auth error, just re-run this for that kid.

import { createServer } from "node:http";

const [, , clientId, clientSecret] = process.argv;
if (!clientId || !clientSecret) {
  console.error("Usage: node scripts/get-classroom-token.mjs <client_id> <client_secret>");
  process.exit(1);
}

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
  "https://www.googleapis.com/auth/classroom.student-submissions.students.readonly",
].join(" ");

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  scope: SCOPES,
  access_type: "offline",
  // Forces Google to hand back a refresh token even if this browser already
  // consented before (e.g. re-running this for the second kid).
  prompt: "consent",
})}`;

console.log("\nOpen this URL and sign in as the STUDENT this token is for:\n");
console.log(authUrl);
console.log(`\nWaiting for the redirect back to ${REDIRECT_URI} ...`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.end("Sign-in was cancelled or denied — check the terminal, then close this tab.");
    console.error(`\nGoogle returned an error: ${error}`);
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.end("Missing ?code — close this tab and try again.");
    return;
  }

  res.end("Got it — you can close this tab and go back to the terminal.");
  server.close();

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();

  if (!tokens.refresh_token) {
    console.error("\nNo refresh_token in the response — this Google account may already have an active grant for this app.");
    console.error("Revoke it at https://myaccount.google.com/permissions and run this again.");
    console.error(tokens);
    process.exit(1);
  }

  console.log("\nRefresh token (save this as a GitHub secret, then run this script again for the other kid):\n");
  console.log(tokens.refresh_token);
  console.log("");
});

server.listen(PORT);
