// Progress Checker — zero-build PWA. Preact + htm loaded straight from a CDN
// (esm.sh), no bundler/npm required. Service worker (sw.js) caches these CDN
// modules on first load so the app keeps working offline after that.
//
// Reads data/grades.json, kept up to date by a scheduled GitHub Action
// (.github/workflows/scrape-progressbook.yml) that logs into ProgressBook
// with Playwright. This app never logs in itself — it only ever displays
// what the scraper last wrote.
import { h, render } from "https://esm.sh/preact@10.24.3";
import { useState, useEffect } from "https://esm.sh/preact@10.24.3/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

// One tab per kid. A tab whose name has no matching entry in
// data/grades.json (student not linked to the ProgressBook account yet)
// shows a "not linked yet" placeholder instead of erroring.
const STUDENT_TABS = ["Avery", "Kaleb"];

function ProgressChecker() {
  const [state, setState] = useState({ loading: true, error: false, data: null });
  const [showInstall] = useState(!isStandalone() && isIOS());
  const [tab, setTab] = useState(STUDENT_TABS[0]);

  useEffect(() => {
    fetch("./data/grades.json", { cache: "no-store" })
      .then((res) => { if (!res.ok) throw new Error("fetch failed"); return res.json(); })
      .then((data) => setState({ loading: false, error: false, data }))
      .catch(() => setState({ loading: false, error: true, data: null }));
  }, []);

  const student = state.data?.students?.find((s) => s.name.toLowerCase() === tab.toLowerCase());

  return html`
    <div style=${styles.root}>
      <div style=${styles.header}>
        <div style=${styles.badge}>PROGRESS CHECKER</div>
        <div style=${styles.h1}>GRADES</div>
        ${state.data?.updatedAt && html`<div style=${styles.updated}>Updated ${new Date(state.data.updatedAt).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</div>`}
      </div>

      <div style=${styles.tabs}>
        ${STUDENT_TABS.map((name) => html`
          <button key=${name} style=${{...styles.tab, ...(tab===name ? styles.tabActive : {})}} onClick=${() => setTab(name)}>${name.toUpperCase()}</button>
        `)}
      </div>

      <div style=${styles.content}>
        ${showInstall && html`
          <div style=${styles.infoBox}>
            <strong style=${{color:"#e8dcc8"}}>Add to Home Screen:</strong> tap the Share icon in Safari, then "Add to Home Screen".
          </div>
        `}
        ${state.loading && html`<div style=${styles.empty}>Loading grades…</div>`}
        ${state.error && html`<div style=${styles.empty}>Couldn't load grades data.<br />Check that the ProgressBook scraper has run.</div>`}
        ${!state.loading && !state.error && student && html`<${CourseList} courses=${student.courses} studentName=${tab} />`}
        ${!state.loading && !state.error && !student && html`<div style=${styles.empty}>${tab} isn't linked to the ProgressBook account yet.<br />Once linked, ${tab}'s grades will show up here automatically.</div>`}
      </div>
    </div>
  `;
}

// dueDate is "Mon D" with no year (e.g. "Aug 25") — assumes the current
// year, which is fine within a school year but would sort wrong across a
// Dec/Jan boundary. Not an issue yet since all synced data is same-year.
function parseDueDate(d) {
  if (!d) return null;
  const t = Date.parse(`${d} ${new Date().getFullYear()}`);
  return Number.isNaN(t) ? null : t;
}

function sortByDueDateAsc(assignments) {
  return [...(assignments || [])].sort((a, b) => {
    const ta = parseDueDate(a.dueDate);
    const tb = parseDueDate(b.dueDate);
    if (ta === null) return tb === null ? 0 : 1;
    if (tb === null) return -1;
    return ta - tb;
  });
}

function assignmentKey(a) {
  return `${a.name}|${a.dueDate ?? ""}`;
}

function CourseList({ courses, studentName }) {
  const [expanded, setExpanded] = useState({});
  const toggle = (i) => setExpanded((prev) => ({ ...prev, [i]: !prev[i] }));

  if (!courses?.length) {
    return html`<div style=${styles.empty}>No grade data yet.<br />The scraper hasn't synced ProgressBook, or hasn't been set up.</div>`;
  }

  return html`
    <div>
      ${courses.map((course, i) => html`
        <${CourseCard} key=${i} course=${course} studentName=${studentName} expanded=${!!expanded[i]} onToggle=${() => toggle(i)} />
      `)}
      <div style=${{height: 40}} />
    </div>
  `;
}

// Owns its own checkbox selection so picking assignments in one card never
// touches another's state. Selection drives the "Email teacher" draft:
// checked assignments get listed in the body, or a generic question if none
// are checked. The To: field stays whatever mailto opens with — editable in
// the mail app, e.g. to send the same draft to a kid instead.
function CourseCard({ course, studentName, expanded, onToggle }) {
  const [selected, setSelected] = useState({});
  const toggleSelect = (key) => setSelected((prev) => ({ ...prev, [key]: !prev[key] }));

  const sorted = sortByDueDateAsc(course.assignments);
  const chosen = sorted.filter((a) => selected[assignmentKey(a)]);

  const sendEmail = () => {
    const subject = `Question about ${studentName} - ${course.name}`;
    const intro = chosen.length
      ? `Hi,\n\nI have a question about the following for ${studentName} in ${course.name}:\n\n${chosen.map((a) => `- ${a.name}${a.dueDate ? ` (due ${a.dueDate})` : ""}`).join("\n")}\n\n`
      : `Hi,\n\nI have a question about ${studentName} in ${course.name}:\n\n`;
    window.location.href = `mailto:${course.teacherEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(intro)}`;
  };

  return html`
    <div style=${{...styles.courseCard, borderLeftColor: course.assignments?.some((a) => a.missing) ? "#c05a5a" : "#3a5a68"}}>
      <div style=${styles.courseHead} onClick=${onToggle} role="button" tabIndex="0">
        <div>
          <div style=${styles.courseName}>${course.name}</div>
          ${(course.teacher || course.teacherEmail) && html`<div style=${styles.courseTeacher}>${course.teacher || course.teacherEmail}</div>`}
        </div>
        <div style=${styles.courseHeadRight}>
          ${course.grade && html`<div style=${styles.courseGrade}>${course.grade}</div>`}
          <div style=${{...styles.chevron, transform: expanded ? "rotate(180deg)" : "rotate(0deg)"}}>▾</div>
        </div>
      </div>
      ${expanded && html`
        <div style=${styles.missingList}>
          ${sorted.length > 0
            ? sorted.map((a) => html`
                <label key=${assignmentKey(a)} style=${{...styles.assignmentItem, color: a.missing ? "#e0a8a8" : "#e8dcc8"}} onClick=${(e) => e.stopPropagation()}>
                  <span style=${styles.assignmentMain}>
                    <input type="checkbox" checked=${!!selected[assignmentKey(a)]} onChange=${() => toggleSelect(assignmentKey(a))} style=${styles.checkbox} />
                    <span>${a.missing ? "⚠ " : ""}${a.name}${a.score ? html` — ${a.score}` : ""}</span>
                  </span>
                  ${a.dueDate && html`<span style=${styles.assignmentDue}>${a.dueDate}</span>`}
                </label>
              `)
            : html`<div style=${styles.noDetails}>No assignment detail for this class.</div>`}
          ${course.teacherEmail && html`
            <button style=${styles.emailButton} onClick=${(e) => { e.stopPropagation(); sendEmail(); }}>
              ${chosen.length ? `Email teacher about ${chosen.length} assignment${chosen.length > 1 ? "s" : ""}` : "Email teacher"}
            </button>
          `}
        </div>
      `}
    </div>
  `;
}

const styles = {
  root: { background:"#0f1109", minHeight:"100vh", color:"#e8dcc8", fontFamily:"system-ui, -apple-system, sans-serif", maxWidth: 480, margin:"0 auto" },

  header: { background:"linear-gradient(135deg,#1a2a30 0%,#1a1c18 100%)", borderBottom:"2px solid #3a5a68", padding:"20px 20px 16px" },
  badge: { fontSize:10, letterSpacing:"0.2em", color:"#7fa8b8", textTransform:"uppercase", marginBottom:4 },
  h1: { fontSize:"2.4rem", fontWeight:800, letterSpacing:"0.06em", color:"#e8dcc8", lineHeight:1 },
  updated: { fontSize:10, color:"#7fa8b8", letterSpacing:"0.1em", marginTop:6 },

  tabs: { display:"flex", background:"#0a0c07", borderBottom:"1px solid #2a2a20" },
  tab: { flex:1, padding:"12px 4px", background:"transparent", border:"none", borderBottom:"2px solid transparent", color:"#8a8a8a", fontSize:12, letterSpacing:"0.1em", cursor:"pointer", fontWeight:600 },
  tabActive: { color:"#5ba3c0", borderBottomColor:"#5ba3c0", background:"#0f1109" },

  content: { padding:"16px 16px 0" },

  infoBox: { background:"#131510", border:"1px solid #2a2a20", borderRadius:2, padding:"12px 14px", marginBottom:14, fontSize:12, color:"#a3ab98", lineHeight:1.6 },
  empty: { textAlign:"center", padding:"60px 20px", color:"#8a8a8a", fontSize:13, lineHeight:2 },

  courseCard: { background:"#161810", border:"1px solid #2a2a20", borderLeft:"4px solid #3a5a68", borderRadius:2, marginBottom:10, padding:"12px 14px" },
  courseHead: { display:"flex", justifyContent:"space-between", alignItems:"flex-start", cursor:"pointer" },
  courseHeadRight: { display:"flex", alignItems:"center", gap:8 },
  courseName: { fontSize:15, fontWeight:700, color:"#e8dcc8" },
  courseTeacher: { fontSize:11, color:"#7fa8b8", letterSpacing:"0.06em", marginTop:2 },
  courseGrade: { fontSize:"1.4rem", fontWeight:800, color:"#5ba3c0", lineHeight:1 },
  chevron: { color:"#7fa8b8", fontSize:14, transition:"transform 0.15s ease" },
  missingList: { marginTop:10, paddingTop:10, borderTop:"1px solid #2a2a20" },
  assignmentItem: { display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:12, padding:"5px 0", gap:10, cursor:"pointer" },
  assignmentMain: { display:"flex", alignItems:"center", gap:8 },
  checkbox: { accentColor:"#5ba3c0", width:16, height:16, flexShrink:0 },
  assignmentDue: { color:"#7fa8b8", fontSize:11, whiteSpace:"nowrap" },
  noDetails: { fontSize:12, color:"#7fa8b8" },
  emailButton: { marginTop:10, width:"100%", padding:"10px 12px", background:"#1a2a30", border:"1px solid #3a5a68", borderRadius:2, color:"#5ba3c0", fontSize:12, fontWeight:700, letterSpacing:"0.04em", cursor:"pointer" },
};

render(html`<${ProgressChecker} />`, document.getElementById("root"));
