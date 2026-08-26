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
        ${!state.loading && !state.error && student && html`<${CourseList} courses=${student.courses} />`}
        ${!state.loading && !state.error && !student && html`<div style=${styles.empty}>${tab} isn't linked to the ProgressBook account yet.<br />Once linked, ${tab}'s grades will show up here automatically.</div>`}
      </div>
    </div>
  `;
}

function CourseList({ courses }) {
  if (!courses?.length) {
    return html`<div style=${styles.empty}>No grade data yet.<br />The scraper hasn't synced ProgressBook, or hasn't been set up.</div>`;
  }

  return html`
    <div>
      ${courses.map((course, i) => html`
        <div key=${i} style=${{...styles.courseCard, borderLeftColor: course.missingAssignments?.length ? "#c05a5a" : "#3a5a68"}}>
          <div style=${styles.courseHead}>
            <div>
              <div style=${styles.courseName}>${course.name}</div>
              ${course.teacherEmail
                ? html`<a href=${`mailto:${course.teacherEmail}`} style=${styles.courseTeacherLink}>${course.teacher || course.teacherEmail}</a>`
                : course.teacher && html`<div style=${styles.courseTeacher}>${course.teacher}</div>`}
            </div>
            ${course.grade && html`<div style=${styles.courseGrade}>${course.grade}</div>`}
          </div>
          ${course.missingAssignments?.length > 0 && html`
            <div style=${styles.missingList}>
              ${course.missingAssignments.map((a, j) => html`
                <div key=${j} style=${styles.missingItem}>
                  <span>${a.name}</span>
                  ${a.dueDate && html`<span style=${styles.missingDue}>${a.dueDate}</span>`}
                </div>
              `)}
            </div>
          `}
        </div>
      `)}
      <div style=${{height: 40}} />
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
  courseHead: { display:"flex", justifyContent:"space-between", alignItems:"flex-start" },
  courseName: { fontSize:15, fontWeight:700, color:"#e8dcc8" },
  courseTeacher: { fontSize:11, color:"#7fa8b8", letterSpacing:"0.06em", marginTop:2 },
  courseTeacherLink: { fontSize:11, color:"#7fa8b8", letterSpacing:"0.06em", marginTop:2, display:"inline-block", textDecoration:"underline" },
  courseGrade: { fontSize:"1.4rem", fontWeight:800, color:"#5ba3c0", lineHeight:1 },
  missingList: { marginTop:10, paddingTop:10, borderTop:"1px solid #2a2a20" },
  missingItem: { display:"flex", justifyContent:"space-between", fontSize:12, color:"#e0a8a8", padding:"3px 0", gap:10 },
  missingDue: { color:"#a37070", fontSize:11, whiteSpace:"nowrap" },
};

render(html`<${ProgressChecker} />`, document.getElementById("root"));
