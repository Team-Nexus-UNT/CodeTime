// timelineView.js — timeline view provider that is wired to commit comands
const vscode = require('vscode');

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

            view.webview.postMessage({
              type: 'commits',
              commits
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

  <div class="panel">
    <div id="status" class="status"></div>
    <div id="list" class="list"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    const statusEl = document.getElementById('status');
    const listEl = document.getElementById('list');
    const refreshBtn = document.getElementById('refresh');

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

    function renderCommits(commits) {
      listEl.innerHTML = '';

      if (!commits || commits.length === 0) {
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

    requestCommits();
  </script>
</body>
</html>
  `;
}

module.exports = { registerTimelineView };