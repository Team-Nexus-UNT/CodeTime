// instructor dashboard (timeline + instructor Tools + walkthroughs)
const vscode = require('vscode');
const path = require('path');

const walkthroughStorage = require('./walkthroughStorage');

const {
  ensureAudioDir,
  listAudioForWebview,
  uploadAudioCommand
} = require('./audioStorage');

const {
  ensureVideoDir,
  listVideoForWebview,
  uploadVideoCommand
} = require('./videoStorage');

class InstructorDashboardViewProvider {
  constructor(context, gitService) {
    this.context = context;
    this.gitService = gitService;
  }

  async resolveWebviewView(view) {
    const context = this.context;
    const gitService = this.gitService;

    const audioDir = await ensureAudioDir(context);
    const videoDir = await ensureVideoDir(context);

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [context.globalStorageUri]
    };

    const buildInstructorItemsHtml = async () => {
      const audio = await listAudioForWebview(view.webview, audioDir);
      const video = await listVideoForWebview(view.webview, videoDir);

      return [
        ...audio.map(i => `
          <li>
            <audio controls src="${i.webviewSrc}"></audio>
            <div class="meta">${i.fileName}</div>
            <button class="danger" data-uri="${i.raw}" data-action="delete">Delete</button>
          </li>`),
        ...video.map(i => `
          <li>
            <video controls width="240" src="${i.webviewSrc}"></video>
            <div class="meta">${i.fileName}</div>
            <button class="danger" data-uri="${i.raw}" data-action="delete">Delete</button>
          </li>`)
      ].join('');
    };

    const rebuild = async () => {
      const instructorItems = await buildInstructorItemsHtml();
      view.webview.html = getDashboardHtml(view.webview, instructorItems);
      // kick off data loads for timeline + walkthrough
      view.webview.postMessage({ type: 'timeline/requestCommits' });
      view.webview.postMessage({ type: 'walkthrough/init', payload: { walkthroughs: walkthroughStorage.getAllWalkthroughs() } });
    };

    await rebuild();

    view.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (!msg?.type) return;

        // instructor tools tab

        if (msg.type === 'instructor/pickAudio') {
          await uploadAudioCommand(context);
          await rebuild();
          return;
        }

        if (msg.type === 'instructor/pickVideo') {
          await uploadVideoCommand(context);
          await rebuild();
          return;
        }

        if (msg.type === 'instructor/delete' && msg.uri) {
          await vscode.workspace.fs.delete(vscode.Uri.parse(msg.uri));
          await rebuild();
          return;
        }

        if (msg.type === 'instructor/addAnnotation') {
          await vscode.commands.executeCommand('codetime.addAnnotation');
          return;
        }

        if (msg.type === 'instructor/exportLesson') {
          await vscode.commands.executeCommand('codetime.exportPackage');
          return;
        }

        // timeline tab

        if (msg.type === 'timeline/requestCommits') {
          const editor = vscode.window.activeTextEditor;
          const wsFolder = editor ? vscode.workspace.getWorkspaceFolder(editor.document.uri) : null;
          const repoPath = wsFolder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

          if (!repoPath) {
            view.webview.postMessage({ type: 'timeline/error', message: 'No workspace folder open.' });
            return;
          }

          const isRepo = await gitService.isGitRepo(repoPath);
          if (!isRepo) {
            view.webview.postMessage({ type: 'timeline/error', message: 'This workspace is not a Git repository.' });
            return;
          }

          const commits = await gitService.getCommitList(repoPath, 25);
          commits.reverse();

          view.webview.postMessage({ type: 'timeline/commits', commits });
          return;
        }

        if (msg.type === 'timeline/scrubTo' && msg.hash) {
          globalThis._codetimeCurrentCommitHash = msg.hash;

          if (vscode.window.activeTextEditor?.document?.uri?.scheme === 'file') {
            globalThis._codetimeSourceFileUri = vscode.window.activeTextEditor.document.uri;
          }

          let sourceUri = globalThis._codetimeSourceFileUri;

          if (!sourceUri) {
            const realEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.scheme === 'file');
            if (realEditor) sourceUri = realEditor.document.uri;
            globalThis._codetimeSourceFileUri = sourceUri;
          }

          if (!sourceUri) {
            view.webview.postMessage({ type: 'timeline/error', message: 'Open a real file once, then use the scrubber.' });
            return;
          }

          const wsFolder = vscode.workspace.getWorkspaceFolder(sourceUri);
          const repoPath = wsFolder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

          if (!repoPath) {
            view.webview.postMessage({ type: 'timeline/error', message: 'No workspace folder open.' });
            return;
          }

          const filePath = sourceUri.fsPath;
          const key = `${repoPath}::${filePath}`;

          if (!globalThis._codetimePlaybackOpened) globalThis._codetimePlaybackOpened = new Set();
          if (!globalThis._codetimePlaybackOpened.has(key)) {
            await vscode.commands.executeCommand('codetime.playback.open', { key });
            globalThis._codetimePlaybackOpened.add(key);
          }

          const fileRelPath = path.relative(repoPath, filePath).replaceAll('\\', '/');

          let contentAtCommit = '';
          try {
            contentAtCommit = await gitService.getFileAtCommit(repoPath, msg.hash, fileRelPath);
          } catch (e) {
            contentAtCommit =
              `// CodeTime Playback\n` +
              `// File not available at this commit.\n` +
              `// ${e?.message || e}\n`;
          }

          await vscode.commands.executeCommand('codetime.playback.setContent', {
            key,
            content: contentAtCommit
          });

          if (vscode.window.activeTextEditor) {
            await vscode.commands.executeCommand('codetime.refreshAnnotations');
          }
          return;
        }

        if (msg.type === 'timeline/commitSelected' && msg.hash) {
          if (!vscode.window.activeTextEditor) {
            view.webview.postMessage({ type: 'timeline/error', message: 'Open a file in the editor first, then click View or Diff.' });
            return;
          }
          await vscode.commands.executeCommand('codetime.showFileAtCommit', msg.hash);
          return;
        }

        if (msg.type === 'timeline/diffSelected' && msg.hash) {
          if (!vscode.window.activeTextEditor) {
            view.webview.postMessage({ type: 'timeline/error', message: 'Open a file in the editor first, then click View or Diff.' });
            return;
          }
          await vscode.commands.executeCommand('codetime.showDiffForCommit', msg.hash);
          return;
        }

        // walkthrough tab

        if (msg.type === 'walkthrough/requestAll') {
          view.webview.postMessage({
            type: 'walkthrough/updated',
            payload: { walkthroughs: walkthroughStorage.getAllWalkthroughs() }
          });
          return;
        }

        if (msg.type === 'walkthrough/create') {
          const title = (msg.title || '').trim();
          const description = (msg.description || '').trim();

          if (!title) {
            view.webview.postMessage({ type: 'walkthrough/error', payload: 'Please enter a title for your walkthrough.' });
            return;
          }

          walkthroughStorage.createWalkthrough(title, description);
          view.webview.postMessage({
            type: 'walkthrough/updated',
            payload: { walkthroughs: walkthroughStorage.getAllWalkthroughs() }
          });
          return;
        }

        if (msg.type === 'walkthrough/select') {
          const wt = walkthroughStorage.getWalkthroughById(msg.id);
          view.webview.postMessage({ type: 'walkthrough/open', payload: { walkthrough: wt } });
          return;
        }

        if (msg.type === 'walkthrough/addStep') {
          vscode.commands.executeCommand('codetime.addWalkthroughStep', msg.walkthroughId)
            .then((updatedWalkthrough) => {
              if (updatedWalkthrough) {
                view.webview.postMessage({ type: 'walkthrough/open', payload: { walkthrough: updatedWalkthrough } });
              }
              view.webview.postMessage({
                type: 'walkthrough/updated',
                payload: { walkthroughs: walkthroughStorage.getAllWalkthroughs() }
              });
            });
          return;
        }

        if (msg.type === 'walkthrough/play') {
          await vscode.commands.executeCommand('codetime.playWalkthrough', msg.walkthroughId);
          return;
        }

        if (msg.type === 'walkthrough/deleteWalkthrough') {
          const ok = await vscode.window.showWarningMessage(
            'Delete this walkthrough? This cannot be undone.',
            { modal: true },
            'Delete'
          );
          if (ok !== 'Delete') return;

          walkthroughStorage.deleteWalkthrough(msg.walkthroughId);

          view.webview.postMessage({
            type: 'walkthrough/updated',
            payload: { walkthroughs: walkthroughStorage.getAllWalkthroughs() }
          });
          view.webview.postMessage({ type: 'walkthrough/open', payload: { walkthrough: null } });
          return;
        }

        if (msg.type === 'walkthrough/deleteStep') {
          const updated = walkthroughStorage.deleteStepFromWalkthrough(msg.walkthroughId, msg.stepId);
          if (updated) {
            view.webview.postMessage({ type: 'walkthrough/open', payload: { walkthrough: updated } });
          }
          view.webview.postMessage({
            type: 'walkthrough/updated',
            payload: { walkthroughs: walkthroughStorage.getAllWalkthroughs() }
          });
          return;
        }

      } catch (err) {
        view.webview.postMessage({ type: 'dashboard/error', message: err?.message || String(err) });
      }
    });
  }
}

function getDashboardHtml(webview, instructorItemsHtml) {
  const csp = webview.cspSource;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
      content="
        default-src 'none';
        img-src ${csp};
        media-src ${csp};
        script-src 'unsafe-inline' ${csp};
        style-src 'unsafe-inline' ${csp};
      ">
<style>
  :root {
    --ct-green: #2e7d32;
    --ct-green-soft: rgba(46,125,50,0.16);
    --ct-green-border: rgba(46,125,50,0.55);
  }

  body { font-family: var(--vscode-font-family); padding: 10px; color: var(--vscode-foreground); }

  .tabs { display:flex; gap:8px; margin-bottom: 10px; flex-wrap: wrap; }
  .tab {
    cursor:pointer;
    border-radius: 10px;
    padding: 6px 10px;
    border: 1px solid var(--vscode-editorWidget-border);
    background: rgba(0,0,0,0.06);
  }
  .tab.active {
    border-color: var(--ct-green-border);
    background: var(--ct-green-soft);
  }

  .section { display:none; }
  .section.active { display:block; }

  /* shared ui helpers */
  .header {
    background: var(--ct-green-soft);
    border: 1px solid var(--ct-green-border);
    border-radius: 10px;
    padding: 10px 12px;
    margin-bottom: 12px;
  }
  .header-title { display:flex; align-items:center; gap:8px; font-weight:700; }
  .dot { width:10px; height:10px; border-radius:999px; background: var(--ct-green); box-shadow: 0 0 0 4px var(--ct-green-soft); }
  .header-sub { opacity:0.75; font-size: 12px; margin-top: 6px; }

  .card {
    border: 1px solid var(--vscode-editorWidget-border);
    background: rgba(0,0,0,0.03);
    border-radius: 10px;
    padding: 12px;
    margin-bottom: 12px;
  }
  .row { display:flex; gap:8px; flex-wrap: wrap; }

  button {
    cursor:pointer;
    border-radius: 8px;
    padding: 6px 10px;
    border:1px solid var(--vscode-editorWidget-border);
    background: var(--vscode-button-secondaryBackground, rgba(0,0,0,0.10));
    color: var(--vscode-foreground);
  }
  button:hover { filter: brightness(1.06); }
  button.primary { border-color: var(--ct-green-border); background: var(--ct-green-soft); }
  button.danger { border-color: rgba(255,82,82,0.35); background: rgba(255,82,82,0.10); }

  ul { list-style:none; padding-left:0; margin:0; }
  li { padding: 10px; border: 1px solid var(--vscode-editorWidget-border); border-radius: 10px; margin-bottom: 10px; background: rgba(0,0,0,0.02); }
  .meta { opacity:0.75; font-size: 12px; margin-top: 6px; }

  /* Timeline bits */
  .scrubberRow { display:flex; gap:8px; align-items:center; margin: 0 0 10px; }
  .range {
    -webkit-appearance:none; appearance:none;
    width:100%; height:10px; border-radius:999px;
    background: rgba(255,255,255,0.10);
    border:1px solid var(--vscode-editorWidget-border);
    outline:none;
  }
  .range::-webkit-slider-thumb{
    -webkit-appearance:none; appearance:none;
    width:16px; height:16px; border-radius:999px;
    background: var(--ct-green);
    border:2px solid rgba(0,0,0,0.35);
    box-shadow: 0 0 0 4px var(--ct-green-soft);
    cursor:pointer;
  }
  .commit { border:1px solid var(--vscode-editorWidget-border); background: rgba(0,0,0,0.10); border-radius: 12px; padding: 10px; margin-bottom: 10px; }
  .hash { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; opacity: 0.9; }
  .msg { margin-top: 6px; }
  .muted { opacity: 0.75; font-size: 12px; margin-top: 6px; }

  /* Walkthrough small helpers */
  input[type="text"], textarea {
    width: 100%; box-sizing: border-box;
    padding: 6px 8px; margin-top: 4px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 6px;
    font-size: 12px;
  }
  textarea { resize: vertical; min-height: 50px; }
  .wt-card { cursor:pointer; position:relative; padding-right: 44px; }
  .icon-btn {
    position:absolute; top:10px; right:10px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.10);
    border-radius: 8px;
    padding: 4px 8px;
  }
  .icon-btn.danger {
    border-color: rgba(255, 82, 82, 0.35);
    background: rgba(255, 82, 82, 0.10);
  }
</style>
</head>

<body>
  <div class="header">
    <div class="header-title"><span class="dot"></span><div>Instructor Dashboard</div></div>
    <div class="header-sub">Timeline + Instructor tools + Walkthroughs, all in one place.</div>
  </div>

  <div class="tabs">
    <div class="tab active" data-tab="timeline">Timeline</div>
    <div class="tab" data-tab="instructor">Tools</div>
    <div class="tab" data-tab="walkthroughs">Walkthroughs</div>
  </div>

  <!-- TIMELINE -->
  <div class="section active" id="tab-timeline">
    <div class="card">
      <div class="row" style="justify-content: space-between;">
        <div style="font-weight:700;">Timeline</div>
        <button id="timelineRefresh" class="primary">Refresh</button>
      </div>
    </div>

    <div class="scrubberRow">
      <button id="timelinePrev">Prev</button>
      <input id="timelineScrub" class="range" type="range" min="0" max="0" value="0" />
      <button id="timelineNext">Next</button>
    </div>
    <div id="timelineCurrent" class="muted"></div>

    <div id="timelineStatus" class="muted"></div>
    <div id="timelineList"></div>
  </div>

  <!-- INSTRUCTOR TOOLS -->
  <div class="section" id="tab-instructor">
    <div class="card">
      <div class="row">
        <button class="primary" id="uploadAudioBtn">Upload Audio</button>
        <button class="primary" id="uploadVideoBtn">Upload Video</button>
        <button id="addAnnotationButton">Add Annotation</button>
        <button id="exportBtn">Export Lesson</button>
      </div>
    </div>

    <ul id="instructorList">${instructorItemsHtml}</ul>
  </div>

  <!-- WALKTHROUGHS -->
  <div class="section" id="tab-walkthroughs">
    <div class="card">
      <div style="font-weight:700; margin-bottom:6px;">Walkthroughs</div>

      <div style="margin-bottom: 8px;">
        <label>Title</label>
        <input id="wtTitle" type="text" placeholder="Example: Intro to Arrays" />
      </div>

      <div style="margin-bottom: 8px;">
        <label>Description (optional)</label>
        <textarea id="wtDesc" placeholder="What will this walkthrough help someone understand?"></textarea>
      </div>

      <button id="wtCreate" class="primary">Create Walkthrough</button>
      <div id="wtError" class="muted" style="margin-top:6px;"></div>
    </div>

    <div id="wtListView">
      <div style="font-weight:700; margin-bottom: 6px;">Your walkthroughs</div>
      <ul id="wtList"><li class="muted">Loading…</li></ul>
    </div>

    <div id="wtDetailView" style="display:none;">
      <div class="row" style="justify-content: space-between; align-items:center; margin-bottom: 6px;">
        <div style="font-weight:700;" id="wtDetailTitle"></div>
        <button id="wtBack">← Back</button>
      </div>
      <div class="muted" id="wtDetailMeta"></div>
      <div style="margin: 8px 0;" id="wtDetailDesc"></div>

      <div class="row" style="margin-bottom: 10px;">
        <button id="wtAddStep" class="primary">Add Step</button>
        <button id="wtPlay" class="primary">Play Walkthrough</button>
      </div>

      <div style="font-weight:700; margin-bottom: 6px;">Steps</div>
      <ul id="wtSteps"><li class="muted">No steps yet.</li></ul>
    </div>
  </div>

<script>
  const vscode = acquireVsCodeApi();

  // tabs

  const tabs = document.querySelectorAll('.tab');
  const sections = {
    timeline: document.getElementById('tab-timeline'),
    instructor: document.getElementById('tab-instructor'),
    walkthroughs: document.getElementById('tab-walkthroughs')
  };

  function setTab(name) {
    tabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === name));
    Object.entries(sections).forEach(([k, el]) => el.classList.toggle('active', k === name));
  }

  tabs.forEach(t => t.addEventListener('click', () => setTab(t.getAttribute('data-tab'))));

  // instructor tools

  document.getElementById("uploadAudioBtn").addEventListener("click", () => vscode.postMessage({ type: "instructor/pickAudio" }));
  document.getElementById("uploadVideoBtn").addEventListener("click", () => vscode.postMessage({ type: "instructor/pickVideo" }));
  document.getElementById("addAnnotationButton").addEventListener("click", () => vscode.postMessage({ type:"instructor/addAnnotation" }));
  document.getElementById("exportBtn").addEventListener("click", () => vscode.postMessage({ type:"instructor/exportLesson" }));

  document.getElementById("instructorList").addEventListener("click", (e) => {
    const btn = e.target.closest('button[data-action="delete"]');
    if (!btn) return;
    vscode.postMessage({ type: "instructor/delete", uri: btn.getAttribute('data-uri') });
  });


  // timeline tab

  const timelineStatus = document.getElementById('timelineStatus');
  const timelineList = document.getElementById('timelineList');
  const refreshBtn = document.getElementById('timelineRefresh');
  const prevBtn = document.getElementById('timelinePrev');
  const nextBtn = document.getElementById('timelineNext');
  const scrubEl = document.getElementById('timelineScrub');
  const currentEl = document.getElementById('timelineCurrent');

  let commitsCache = [];
  let activeIndex = 0;
  let userInteracted = false;

  function esc(s){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;"); }

  function setTimelineStatus(text) {
    timelineStatus.textContent = text || '';
  }

  function setCurrentLabel() {
    if (!commitsCache.length) { currentEl.textContent = ''; return; }
    const c = commitsCache[activeIndex];
    currentEl.textContent = 'Selected: ' + (c.hash || '').slice(0,7) + ' — ' + (c.message || '');
  }

  function setActiveIndex(i) {
    if (!commitsCache.length) return;
    activeIndex = Math.max(0, Math.min(i, commitsCache.length - 1));
    scrubEl.value = String(activeIndex);
    setCurrentLabel();

    const c = commitsCache[activeIndex];
    if (c?.hash && userInteracted) {
      vscode.postMessage({ type: 'timeline/scrubTo', hash: c.hash });
    }
  }

  function renderCommits(commits) {
    commitsCache = commits || [];
    activeIndex = 0;
    scrubEl.max = commitsCache.length ? String(commitsCache.length - 1) : "0";
    scrubEl.value = "0";
    setCurrentLabel();

    timelineList.innerHTML = '';
    if (!commitsCache.length) {
      setTimelineStatus('No commits found.');
      return;
    }

    setTimelineStatus('');

    for (const c of commitsCache) {
      const shortHash = (c.hash || '').slice(0,7);
      const div = document.createElement('div');
      div.className = 'commit';
      div.innerHTML = \`
        <div class="hash">\${esc(shortHash)}</div>
        <div class="msg">\${esc(c.message || '')}</div>
        <div class="muted">\${esc(c.author || '')} — \${esc(c.date || '')}</div>
        <div class="row" style="margin-top:10px;">
          <button class="primary" data-action="view" data-hash="\${esc(c.hash)}">View</button>
          <button class="primary" data-action="diff" data-hash="\${esc(c.hash)}">Diff</button>
        </div>
      \`;
      div.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const hash = btn.getAttribute('data-hash');
        const action = btn.getAttribute('data-action');
        if (action === 'view') vscode.postMessage({ type: 'timeline/commitSelected', hash });
        if (action === 'diff') vscode.postMessage({ type: 'timeline/diffSelected', hash });
      });
      timelineList.appendChild(div);
    }

    setActiveIndex(0);
  }

  function requestCommits() {
    setTimelineStatus('Loading commits…');
    vscode.postMessage({ type: 'timeline/requestCommits' });
  }

  refreshBtn.addEventListener('click', requestCommits);
  prevBtn.addEventListener('click', () => { userInteracted = true; setActiveIndex(activeIndex - 1); });
  nextBtn.addEventListener('click', () => { userInteracted = true; setActiveIndex(activeIndex + 1); });
  scrubEl.addEventListener('input', () => { userInteracted = true; setActiveIndex(Number(scrubEl.value)); });

  // walkthroughs tab

  const wtTitle = document.getElementById('wtTitle');
  const wtDesc = document.getElementById('wtDesc');
  const wtCreate = document.getElementById('wtCreate');
  const wtError = document.getElementById('wtError');

  const wtListView = document.getElementById('wtListView');
  const wtDetailView = document.getElementById('wtDetailView');
  const wtList = document.getElementById('wtList');

  const wtDetailTitle = document.getElementById('wtDetailTitle');
  const wtDetailMeta = document.getElementById('wtDetailMeta');
  const wtDetailDesc = document.getElementById('wtDetailDesc');
  const wtSteps = document.getElementById('wtSteps');

  const wtBack = document.getElementById('wtBack');
  const wtAddStep = document.getElementById('wtAddStep');
  const wtPlay = document.getElementById('wtPlay');

  let currentWalkthroughId = null;
  let walkthroughCache = [];

  function showWtList() { wtDetailView.style.display = 'none'; wtListView.style.display = 'block'; }
  function showWtDetail() { wtListView.style.display = 'none'; wtDetailView.style.display = 'block'; }

  function renderWtList(items) {
    walkthroughCache = Array.isArray(items) ? items : [];
    if (!walkthroughCache.length) {
      wtList.innerHTML = '<li class="muted">No walkthroughs yet. Create your first one above.</li>';
      return;
    }

    wtList.innerHTML = walkthroughCache.map(w => {
      const created = w.createdAt ? new Date(w.createdAt).toLocaleString() : '';
      const numSteps = Array.isArray(w.steps) ? w.steps.length : 0;
      const desc = (w.description || '').trim();
      return \`
        <li class="wt-card" data-id="\${w.id}">
          <button class="icon-btn danger" data-delete-wt="\${w.id}" title="Delete walkthrough">🗑</button>
          <div style="font-weight:600;">\${esc(w.name || '(untitled walkthrough)')}</div>
          <div class="muted">\${created ? 'Created: ' + esc(created) : ''}\${numSteps ? ' • ' + numSteps + ' step(s)' : ''}</div>
          \${desc ? '<div style="margin-top:6px;">' + esc(desc) + '</div>' : ''}
        </li>\`;
    }).join('');
  }

  function renderWtDetail(w) {
    if (!w) { currentWalkthroughId = null; showWtList(); return; }

    currentWalkthroughId = w.id;

    const created = w.createdAt ? new Date(w.createdAt).toLocaleString() : '';
    const desc = (w.description || '').trim();

    wtDetailTitle.textContent = w.name || '(untitled walkthrough)';
    wtDetailMeta.textContent = created ? 'Created: ' + created : '';
    wtDetailDesc.textContent = desc || '';

    if (!Array.isArray(w.steps) || !w.steps.length) {
      wtSteps.innerHTML = '<li class="muted">No steps yet. Use "Add Step".</li>';
    } else {
      wtSteps.innerHTML = w.steps.map(step => {
        const label = step.label || 'Step';
        const file = step.file || '';
        const line = typeof step.line === 'number' ? step.line : '';
        const note = (step.note || '').trim();
        return \`
          <li data-step-id="\${step.id}" style="position:relative; padding-right:44px;">
            <button class="icon-btn danger" data-delete-step="\${step.id}" title="Delete step">🗑</button>
            <div style="font-weight:600;">\${esc(label)}</div>
            <div class="muted">\${esc(file)} \${line !== '' ? '• line ' + esc(line) : ''}</div>
            \${note ? '<div style="margin-top:6px;">' + esc(note) + '</div>' : ''}
          </li>\`;
      }).join('');
    }

    showWtDetail();
  }

  wtCreate.addEventListener('click', () => {
    wtError.textContent = '';
    vscode.postMessage({
      type: 'walkthrough/create',
      title: (wtTitle.value || '').trim(),
      description: (wtDesc.value || '').trim()
    });
  });

  wtList.addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-delete-wt]');
    if (delBtn) {
      e.stopPropagation();
      vscode.postMessage({ type: 'walkthrough/deleteWalkthrough', walkthroughId: delBtn.getAttribute('data-delete-wt') });
      return;
    }
    const card = e.target.closest('.wt-card');
    if (!card) return;
    vscode.postMessage({ type: 'walkthrough/select', id: card.getAttribute('data-id') });
  });

  wtSteps.addEventListener('click', (e) => {
    const del = e.target.closest('[data-delete-step]');
    if (!del) return;
    if (!currentWalkthroughId) return;
    vscode.postMessage({ type: 'walkthrough/deleteStep', walkthroughId: currentWalkthroughId, stepId: del.getAttribute('data-delete-step') });
  });

  wtBack.addEventListener('click', () => { currentWalkthroughId = null; showWtList(); });
  wtAddStep.addEventListener('click', () => { if (!currentWalkthroughId) return; vscode.postMessage({ type: 'walkthrough/addStep', walkthroughId: currentWalkthroughId }); });
  wtPlay.addEventListener('click', () => { if (!currentWalkthroughId) return; vscode.postMessage({ type: 'walkthrough/play', walkthroughId: currentWalkthroughId }); });

  // Incoming messages

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg?.type) return;

    // timeline
    if (msg.type === 'timeline/commits') renderCommits(msg.commits);
    if (msg.type === 'timeline/error') setTimelineStatus(msg.message || 'Unknown error');

    // walkthrough
    if (msg.type === 'walkthrough/init' || msg.type === 'walkthrough/updated') {
      wtError.textContent = '';
      renderWtList((msg.payload && msg.payload.walkthroughs) || []);
      showWtList();
    }
    if (msg.type === 'walkthrough/open') {
      wtError.textContent = '';
      renderWtDetail(msg.payload && msg.payload.walkthrough);
    }
    if (msg.type === 'walkthrough/error') {
      wtError.textContent = msg.payload || 'Something went wrong.';
    }
  });

  // initial loads
  requestCommits();
  vscode.postMessage({ type: 'walkthrough/requestAll' });
</script>

</body>
</html>`;
}

module.exports = InstructorDashboardViewProvider;