// timelineView.js — timeline view provider that is wired to commit comands
const vscode = require('vscode');
const path = require('path');

function registerTimelineView(context, gitService) {
  const provider = {
    async resolveWebviewView(view) {
      view.webview.options = { enableScripts: true };

      view.webview.html = getHtml();

      // handle messages from webview
      view.webview.onDidReceiveMessage(async (msg) => {
        try {
          if (!msg || !msg.type) return;

          if (msg.type === 'requestCommits') {
            const editor = vscode.window.activeTextEditor;
            const wsFolder = editor ? vscode.workspace.getWorkspaceFolder(editor.document.uri) : null;
            const repoPath = wsFolder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

            if (!repoPath) {
              view.webview.postMessage({
                type: 'error',
                message: 'No workspace folder open.'
              });
              return;
            }

            const isRepo = await gitService.isGitRepo(repoPath);
            if (!isRepo) {
              view.webview.postMessage({
                type: 'error',
                message: 'This workspace is not a Git repository.'
              });
              return;
            }

            const commits = await gitService.getCommitList(repoPath, 25);
            commits.reverse();

            view.webview.postMessage({
              type: 'commits',
              commits
            });
            return;
          }
          
          // Scrubber playback handling
          if (msg.type === 'scrubTo' && msg.hash) {
            if (vscode.window.activeTextEditor?.document?.uri?.scheme === 'file') {
              globalThis._codetimeSourceFileUri = vscode.window.activeTextEditor.document.uri;
            }

            let sourceUri = globalThis._codetimeSourceFileUri;

            if (!sourceUri) {
              const realEditor = vscode.window.visibleTextEditors.find(
                e => e.document.uri.scheme === 'file'
              );
              if (realEditor) sourceUri = realEditor.document.uri;
              globalThis._codetimeSourceFileUri = sourceUri;
            }

            if (!sourceUri) {
              view.webview.postMessage({
                type: 'error',
                message: 'Open a real file once, then use the scrubber.'
              });
              return;
            }

            // Creating a stable key per file 
            const wsFolder = vscode.workspace.getWorkspaceFolder(sourceUri);
            const repoPath =
              wsFolder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          
            if (!repoPath) {
              view.webview.postMessage({
                type: 'error',
                message: 'No workspace folder open.'
              });
              return;
            }
          
            const filePath = sourceUri.fsPath;
            const key = `${repoPath}::${filePath}`;
          
            // Open playback tab once per key
            if (!globalThis._codetimePlaybackOpened) globalThis._codetimePlaybackOpened = new Set();
            if (!globalThis._codetimePlaybackOpened.has(key)) {
              await vscode.commands.executeCommand('codetime.playback.open', { key });
              globalThis._codetimePlaybackOpened.add(key);
            }
          
            // repo-relative path for git show
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

            return;
          }
          

          if (
            (msg.type === 'commitSelected' || msg.type === 'diffSelected') &&
            msg.hash &&
            !vscode.window.activeTextEditor
          ) {
            view.webview.postMessage({
              type: 'error',
              message: 'Open a file in the editor first, then click View or Diff.'
            });
            return;
          }

          if (msg.type === 'commitSelected' && msg.hash) {
            await vscode.commands.executeCommand('codetime.showFileAtCommit', msg.hash);
            return;
          }

          if (msg.type === 'diffSelected' && msg.hash) {
            await vscode.commands.executeCommand('codetime.showDiffForCommit', msg.hash);
            return;
          }
        } catch (err) {
          view.webview.postMessage({
            type: 'error',
            message: err?.message || String(err)
          });
        }
      });
    }
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codetime.timelineView', provider)
  );
}

function getHtml() {
  return /* html */ `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    :root {
      --bg: transparent;
      --card: rgba(255,255,255,0.04);
      --card2: rgba(255,255,255,0.06);
      --border: rgba(255,255,255,0.10);
      --text: rgba(255,255,255,0.92);
      --muted: rgba(255,255,255,0.65);

      /* red theme accents */
      --accent: #ff4d4d;
      --accent2: rgba(255,77,77,0.18);
      --accentBorder: rgba(255,77,77,0.35);
      --shadow: rgba(0,0,0,0.25);
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 12px;
      color: var(--text);
      background: var(--bg);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }

    .title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 0 4px var(--accent2);
    }

    .btn {
      border: 1px solid var(--border);
      background: var(--card);
      color: var(--text);
      padding: 6px 10px;
      border-radius: 10px;
      cursor: pointer;
      transition: transform 0.06s ease, background 0.12s ease;
    }

    .btn:hover { background: var(--card2); }
    .btn:active { transform: scale(0.98); }

    .btn-red {
      border-color: var(--accentBorder);
      background: rgba(255,77,77,0.10);
    }
    .btn-red:hover {
      background: rgba(255,77,77,0.16);
    }

    .panel {
      border: 1px solid var(--border);
      background: var(--card);
      border-radius: 14px;
      padding: 12px;
      box-shadow: 0 6px 16px var(--shadow);
    }

    .status {
      margin-bottom: 10px;
    }

    .statusCard {
      border: 1px solid var(--accentBorder);
      background: var(--accent2);
      border-radius: 12px;
      padding: 10px;
      color: var(--text);
    }

    .statusMuted {
      color: var(--muted);
      margin: 6px 0 0;
      font-size: 12px;
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .commit {
      border: 1px solid var(--border);
      background: rgba(0,0,0,0.12);
      border-radius: 14px;
      padding: 10px;
    }

    .topRow {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }

    .hash {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      color: rgba(255,255,255,0.85);
    }

    .msg {
      margin-top: 6px;
      line-height: 1.25;
    }

    .meta {
      margin-top: 6px;
      font-size: 12px;
      color: var(--muted);
    }

    .actions {
      margin-top: 10px;
      display: flex;
      gap: 8px;
    }

    .scrubberRow{
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 0 0 10px;
    }

    .scrubLabel{
      margin: 0 0 10px;
      font-size: 12px;
      color: var(--muted);
    }

    .range{
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.10);
      border: 1px solid var(--border);
      outline: none;
    }

    .range::-webkit-slider-thumb{
      -webkit-appearance: none;
      appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 999px;
      background: var(--accent);
      border: 2px solid rgba(0,0,0,0.35);
      box-shadow: 0 0 0 4px var(--accent2);
      cursor: pointer;
    }

    .range::-moz-range-thumb{
      width: 16px;
      height: 16px;
      border-radius: 999px;
      background: var(--accent);
      border: 2px solid rgba(0,0,0,0.35);
      box-shadow: 0 0 0 4px var(--accent2);
      cursor: pointer;
    }

  </style>
</head>
<body>
  <div class="header">
    <div class="title">
      <span class="dot"></span>
      <span>Timeline</span>
    </div>
    <button id="refresh" class="btn btn-red">Refresh</button>
  </div>

  <!-- scrubber controls for navigating through the commits -->
  <div class="scrubberRow">
    <button id="prev" class="btn">Prev</button>
    <input id="scrub" class="range" type="range" min="0" max="0" value="0" />
    <button id="next" class="btn">Next</button>
  </div>
  <div id="current" class="scrubLabel"></div>

  <div class="panel">
    <div id="status" class="status"></div>
    <div id="list" class="list"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    const statusEl = document.getElementById('status');
    const listEl = document.getElementById('list');
    const refreshBtn = document.getElementById('refresh');

    const prevBtn = document.getElementById('prev');
    const nextBtn = document.getElementById('next');
    const scrubEl = document.getElementById('scrub');
    const currentEl = document.getElementById('current');

    let commitsCache = [];
    let activeIndex = 0;
    let userInteracted = false;


    function escapeHtml(s) {
      return String(s)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function setStatus(text, extraMuted) {
      if (!text) {
        statusEl.innerHTML = '';
        return;
      }

      let mutedHtml = '';
      if (extraMuted) {
        mutedHtml =
          '<div class="statusMuted">' +
          escapeHtml(extraMuted) +
          '</div>';
      }

      statusEl.innerHTML =
        '<div class="statusCard">' +
          '<div>' + escapeHtml(text) + '</div>' +
          mutedHtml +
        '</div>';
    }

    function setCurrentLabel() {
      if(!commitsCache.length) {
        currentEl.textContent = '';
        return;
      }
      const c = commitsCache[activeIndex];
      const shortHash = (c.hash || '').slice(0,7);
      currentEl.textContent = 'Selected: ' + shortHash + ' — ' + (c.message || '');
    }

    function setActiveIndex(i) {
      if(!commitsCache.length) return;
      activeIndex = Math.max(0, Math.min(i, commitsCache.length -1));
      scrubEl.value = String(activeIndex);
      setCurrentLabel();

      const c = commitsCache[activeIndex];
      if (c?.hash && userInteracted) {
        vscode.postMessage({ type: 'scrubTo', hash: c.hash });
      }
    }

    function renderCommits(commits) {
      listEl.innerHTML = '';

      commitsCache = commits || [];
      activeIndex = 0;
      scrubEl.max = commitsCache.length ? String(commitsCache.length - 1): "0";
      scrubEl.value = "0";
      setCurrentLabel();

      if (!commits || commits.length === 0) {
        currentEl.textContent = '';
        setStatus(
          'No commits found.',
          'Try Refresh, or check that this folder has Git history.'
        );
        return;
      }

      setStatus('');

      for (const c of commits) {
        const card = document.createElement('div');
        card.className = 'commit';

        const shortHash = (c.hash || '').slice(0, 7);

        card.innerHTML =
          '<div class="topRow">' +
            '<div class="hash">' + escapeHtml(shortHash) + '</div>' +
          '</div>' +

          '<div class="msg">' + escapeHtml(c.message || '') + '</div>' +
          '<div class="meta">' +
            escapeHtml(c.author || '') + ' — ' + escapeHtml(c.date || '') +
          '</div>' +

          '<div class="actions">' +
            '<button class="btn btn-red" data-action="view" data-hash="' +
              escapeHtml(c.hash) + '">View</button>' +
            '<button class="btn btn-red" data-action="diff" data-hash="' +
              escapeHtml(c.hash) + '">Diff</button>' +
          '</div>';

        card.addEventListener('click', (e) => {
          const btn = e.target.closest('button');
          if (!btn) return;

          const hash = btn.getAttribute('data-hash');
          const action = btn.getAttribute('data-action');

          if (action === 'view') {
            vscode.postMessage({ type: 'commitSelected', hash });
          } else if (action === 'diff') {
            vscode.postMessage({ type: 'diffSelected', hash });
          }
        });

        listEl.appendChild(card);
      }
      setActiveIndex(0);

    }

    function requestCommits() {
      setStatus(
        'Loading commits…',
        'If you see “not a Git repository”, open a Git repo folder as your workspace.'
      );
      vscode.postMessage({ type: 'requestCommits' });
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      if (msg.type === 'commits') {
        renderCommits(msg.commits);
      } else if (msg.type === 'error') {
        setStatus(
          msg.message || 'Unknown error',
          'Open a Git repository folder and try Refresh.'
        );
      }
    });

    refreshBtn.addEventListener('click', requestCommits);

    prevBtn.addEventListener('click', () => {
      userInteracted = true;
      setActiveIndex(activeIndex - 1);
    });

    nextBtn.addEventListener('click', () => {
      userInteracted = true;
      setActiveIndex(activeIndex + 1);
    });

    scrubEl.addEventListener('input', () => {
    userInteracted = true;
    setActiveIndex(Number(scrubEl.value));
    });


    requestCommits();
  </script>
</body>
</html>
  `;
}

module.exports = { registerTimelineView };