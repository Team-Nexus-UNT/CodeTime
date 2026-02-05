// Walkthrough sidebar view
const vscode = require('vscode');
const walkthroughStorage = require('./walkthroughStorage');

// builds html ui for the walkthrough view
function getWalkthroughHtml(webview) {
  const cspSource = webview.cspSource;

  return `<!doctype html>
<html>
<head>
  <!-- webview security + css -->
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
        content="
          default-src 'none';
          img-src ${cspSource};
          script-src 'unsafe-inline' ${cspSource};
          style-src 'unsafe-inline' ${cspSource};
        ">
  <style>
    /* colors+basic styling */
    :root {
      --codetime-green: #2e7d32;
      --codetime-green-soft: rgba(46, 125, 50, 0.16);
      --codetime-green-border: rgba(46, 125, 50, 0.65);
    }

    body {
      font-family: var(--vscode-font-family);
      padding: 10px;
      color: var(--vscode-foreground);
      font-size: 13px;
    }

    /* header area */
    .header {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 10px;
      padding: 8px;
      border-radius: 8px;
      border: 1px solid var(--codetime-green-border);
      background: var(--codetime-green-soft);
    }

    .header-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--codetime-green);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .header-title span.icon {
      font-size: 16px;
    }

    .header-desc {
      font-size: 12px;
      opacity: 0.9;
    }

    .hint {
      font-size: 11px;
      opacity: 0.85;
      margin-top: 2px;
    }

    /* new walkthrough form */
    form {
      margin-bottom: 12px;
      padding: 8px;
      border-radius: 8px;
      border: 1px solid var(--vscode-editorWidget-border, #444);
      background: rgba(0, 0, 0, 0.05);
    }

    label {
      font-size: 12px;
      font-weight: 500;
    }

    input[type="text"],
    textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      margin-top: 4px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 4px;
      font-size: 12px;
    }

    textarea {
      resize: vertical;
      min-height: 50px;
    }

    .field {
      margin-bottom: 8px;
    }

    button {
      margin-top: 4px;
      padding: 5px 12px;
      font-size: 12px;
      border-radius: 999px;
      border: 1px solid var(--codetime-green-border);
      background: var(--codetime-green);
      color: #ffffff;
      cursor: pointer;
    }

    button.secondary {
      background: transparent;
      color: var(--vscode-foreground);
      border-color: var(--vscode-editorWidget-border, #444);
    }

    /* message+list styles */
    #error {
      color: var(--vscode-editorError-foreground, #f14c4c);
      font-size: 11px;
      margin-top: 4px;
      min-height: 1em;
    }

    h2 {
      font-size: 13px;
      margin: 4px 0 6px;
      font-weight: 600;
    }

    ul {
      list-style: none;
      padding-left: 0;
      margin: 0;
    }

    li {
      padding: 6px 6px;
      border-radius: 6px;
      margin-bottom: 4px;
      border: 1px solid var(--vscode-editorWidget-border, #333);
      background: rgba(0, 0, 0, 0.03);
    }

    .wt-title {
      font-weight: 500;
      margin-bottom: 2px;
    }

    .wt-meta {
      font-size: 11px;
      opacity: 0.75;
    }

    .wt-desc {
      font-size: 11px;
      margin-top: 3px;
      opacity: 0.9;
    }

    .empty {
      opacity: 0.7;
      font-size: 12px;
    }

    .wt-card {
      cursor: pointer;
      position: relative;
      padding-right: 40px;
    }

    .wt-card:hover {
      background: rgba(255, 255, 255, 0.04);
    }

    .icon-btn {
      position: absolute;
      top: 10px;
      right: 10px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(0,0,0,0.10);
      color: var(--vscode-foreground);
      border-radius: 8px;
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
    }

    .icon-btn:hover { background: rgba(255,255,255,0.06); }

    .icon-btn.danger {
      border-color: rgba(255, 82, 82, 0.35);
      background: rgba(255, 82, 82, 0.10);
    }
    .icon-btn.danger:hover { background: rgba(255, 82, 82, 0.16); }

    .step-row {
      position: relative;
      padding-right: 40px;
    }

    .step-delete {
      position: absolute;
      top: 10px;
      right: 10px;
    }

    /* detail view */
    #detailView {
      margin-top: 8px;
    }

    .detail-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }

    .detail-title {
      font-size: 14px;
      font-weight: 600;
    }

    .detail-meta {
      font-size: 11px;
      opacity: 0.8;
      margin-bottom: 4px;
    }

    .detail-desc {
      font-size: 12px;
      margin-bottom: 8px;
    }

    .detail-actions {
      display: flex;
      gap: 6px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }

    .steps-empty {
      font-size: 12px;
      opacity: 0.7;
    }
  </style>
</head>
<body>

  <!-- top section -->
  <div class="header">
    <div class="header-title">
      <span class="icon">🌱</span>
      <span>Walkthroughs</span>
    </div>
    <div class="header-desc">
      A walkthrough is a guided tour of your code. Give it a friendly name and
      a short description, then you can add steps, media, and annotations later.
    </div>
    <div class="hint">
      Tip: Start with something small, like "Intro to loops" or "Simplifying logic".
    </div>
  </div>

  <!-- create-new form -->
  <form id="new-walkthrough-form">
    <div class="field">
      <label for="titleInput">Title</label><br/>
      <input id="titleInput" type="text" placeholder="Example: Intro to Arrays" />
    </div>

    <div class="field">
      <label for="descriptionInput">Description (optional)</label><br/>
      <textarea id="descriptionInput"
        placeholder="What will this walkthrough help someone understand?"></textarea>
    </div>

    <button type="submit">Create Walkthrough</button>
    <div id="error"></div>
  </form>

  <!-- list view -->
  <div id="listView">
    <h2>Your walkthroughs</h2>
    <ul id="walkthroughList">
      <li class="empty">Loading your walkthroughs…</li>
    </ul>
  </div>

  <!-- detail view (hidden by default) -->
  <div id="detailView" style="display:none">
    <div class="detail-header">
    <div class="detail-title" id="detailTitle"></div>
      <button id="backToList" class="secondary">← Back</button>
    </div>
    <div class="detail-meta" id="detailMeta"></div>
    <div class="detail-desc" id="detailDesc"></div>

    <div class="detail-actions">
      <button id="detailAddStep">Add Step</button>
      <button id="detailPlay">Play Walkthrough</button>
    </div>

    <h2>Steps</h2>
    <ul id="detailSteps">
      <li class="steps-empty">No steps yet. Use "Add Step" to capture the current editor position.</li>
    </ul>
  </div>

  <script>
    // talk to extension
    const vscode = acquireVsCodeApi();

    // ui references
    const form = document.getElementById('new-walkthrough-form');
    const titleInput = document.getElementById('titleInput');
    const descriptionInput = document.getElementById('descriptionInput');
    const errorEl = document.getElementById('error');
    const listEl = document.getElementById('walkthroughList');
    const listView = document.getElementById('listView');
    const detailView = document.getElementById('detailView');

    const backBtn = document.getElementById('backToList');
    const detailTitle = document.getElementById('detailTitle');
    const detailMeta = document.getElementById('detailMeta');
    const detailDesc = document.getElementById('detailDesc');
    const detailSteps = document.getElementById('detailSteps');
    const detailAddStep = document.getElementById('detailAddStep');
    const detailPlay = document.getElementById('detailPlay');

    // which walkthrough is currently open
    let currentWalkthroughId = null;
    let walkthroughCache = [];

    // show/hide sections
    function showListView() {
      detailView.style.display = 'none';
      listView.style.display = 'block';
    }

    function showDetailView() {
      listView.style.display = 'none';
      detailView.style.display = 'block';
    }

    // render walkthrough list
    function renderList(items) {
      walkthroughCache = Array.isArray(items) ? items : [];

      if (!Array.isArray(items) || items.length === 0) {
        listEl.innerHTML =
          '<li class="empty">No walkthroughs yet. Create your first one above.</li>';
        return;
      }

      listEl.innerHTML = items.map(w => {
        const created = w.createdAt
          ? new Date(w.createdAt).toLocaleString()
          : '';
        const numSteps = Array.isArray(w.steps) ? w.steps.length : 0;
        const desc = (w.description || '').trim();

        return \`
          <li class="wt-card" data-id="\${w.id}">
            <button class="icon-btn danger" data-delete-wt="\${w.id}" title="Delete walkthrough">🗑</button>
            <div class="wt-title">\${w.name || '(untitled walkthrough)'}</div>
            <div class="wt-meta">
              \${created ? 'Created: ' + created : ''} 
              \${numSteps ? ' • ' + numSteps + ' step(s)' : ''}
            </div>
            \${desc ? '<div class="wt-desc">' + desc + '</div>' : ''}
          </li>
        \`;
      }).join('');
    }

    // render the detail view for a single walkthrough
    function renderDetail(w) {
      if (!w) {
        showListView();
        return;
      }

      currentWalkthroughId = w.id;

      const created = w.createdAt
        ? new Date(w.createdAt).toLocaleString()
        : '';
      const desc = (w.description || '').trim();

      detailTitle.textContent = w.name || '(untitled walkthrough)';
      detailMeta.textContent = created ? 'Created: ' + created : '';
      detailDesc.textContent = desc || '';

      if (!Array.isArray(w.steps) || w.steps.length === 0) {
        detailSteps.innerHTML =
          '<li class="steps-empty">No steps yet. Use "Add Step".</li>';
      } else {
        detailSteps.innerHTML = w.steps.map(step => {
          const label = step.label || 'Step';
          const file = step.file || '';
          const line = typeof step.line === 'number' ? step.line : '';
          const note = (step.note || '').trim();

          return \`
            <li class="step-row" data-step-id="\${step.id}">
              <button class="icon-btn danger step-delete" data-delete-step="\${step.id}" title="Delete step">🗑</button>
              <div class="wt-title">\${label}</div>
              <div class="wt-meta">\${file} \${line !== '' ? '• line ' + line : ''}</div>
              \${note ? '<div class="wt-desc">' + note + '</div>' : ''}
            </li>
          \`;
        }).join('');
      }

      showDetailView();
    }

    // click on a walkthrough in the list
    listEl.addEventListener('click', (e) => {
      const delBtn = e.target.closest('[data-delete-wt]');
      if (delBtn) {
        e.stopPropagation();
        const id = delBtn.getAttribute('data-delete-wt');
        vscode.postMessage({ type: 'deleteWalkthrough', walkthroughId: id });
        return;
      }
      const card = e.target.closest('.wt-card');
      if (!card) return;
      const id = card.getAttribute('data-id');
      if (!id) return;

      vscode.postMessage({
        type: 'selectWalkthrough',
        id
      });
    });

    // delete step clicks
    detailSteps.addEventListener('click', (e) => {
      const del = e.target.closest('[data-delete-step]');
      if (!del) return;
      const stepId = del.getAttribute('data-delete-step');
      if (!currentWalkthroughId || !stepId) return;
      vscode.postMessage({ type: 'deleteStep', walkthroughId: currentWalkthroughId, stepId });
    });

    // back button
    backBtn.addEventListener('click', () => {
      currentWalkthroughId = null;
      showListView();
    });

    // detail actions
    detailAddStep.addEventListener('click', () => {
      if (!currentWalkthroughId) return;
      vscode.postMessage({
        type: 'addStepClicked',
        walkthroughId: currentWalkthroughId
      });
    });

    detailPlay.addEventListener('click', () => {
      if (!currentWalkthroughId) return;
      vscode.postMessage({
        type: 'playClicked',
        walkthroughId: currentWalkthroughId
      });
    });

    // receive messages from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) return;

      switch (msg.type) {
        case 'init':
        case 'updatedWalkthroughs':
          errorEl.textContent = '';
          renderList((msg.payload && msg.payload.walkthroughs) || []);
          showListView();
          break;
        case 'openWalkthrough':
          errorEl.textContent = '';
          renderDetail(msg.payload && msg.payload.walkthrough);
          break;
        case 'error':
          errorEl.textContent = msg.payload || 'Something went wrong.';
          break;
      }
    });

    // handle create form
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      errorEl.textContent = '';

      const title = (titleInput.value || '').trim();
      const description = (descriptionInput.value || '').trim();

      vscode.postMessage({
        type: 'createWalkthrough',
        title,
        description
      });
    });

    // tell extension we are ready
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

// hook view into vscode
function registerWalkthroughView(context) {
  const provider = {
    resolveWebviewView(view) {
      view.webview.options = { enableScripts: true };
      view.webview.html = getWalkthroughHtml(view.webview);

      // helper: send list back to webview
      function postAll(type) {
        try {
          const all = walkthroughStorage.getAllWalkthroughs();
          view.webview.postMessage({
            type,
            payload: { walkthroughs: all }
          });
        } catch (err) {
          console.error('Walkthrough view error:', err);
          view.webview.postMessage({
            type: 'error',
            payload: err?.message || String(err)
          });
        }
      }

      // handle messages from ui
      view.webview.onDidReceiveMessage(async (msg) => {
        try {
          if (msg?.type === 'ready') {
            postAll('init');
          } else if (msg?.type === 'createWalkthrough') {
            const title = (msg.title || '').trim();
            const description = (msg.description || '').trim();

            if (!title) {
              view.webview.postMessage({
                type: 'error',
                payload: 'Please enter a title for your walkthrough.'
              });
              return;
            }

            walkthroughStorage.createWalkthrough(title, description);
            postAll('updatedWalkthroughs');
          } else if (msg?.type === 'selectWalkthrough') {
            const wt = walkthroughStorage.getWalkthroughById(msg.id);
            view.webview.postMessage({
              type: 'openWalkthrough',
              payload: { walkthrough: wt }
            });
          } else if (msg?.type === 'addStepClicked') {
            // pass walkthrough id to command and refresh selected walkthrough
            vscode.commands.executeCommand(
              'codetime.addWalkthroughStep',
              msg.walkthroughId
            ).then((updatedWalkthrough) => {
              if (updatedWalkthrough) {
                view.webview.postMessage({
                  type: 'openWalkthrough',
                  payload: { walkthrough: updatedWalkthrough }
                });
              } else {
                postAll('updatedWalkthroughs');
              }
            });
          } else if (msg?.type === 'playClicked') {
            vscode.commands.executeCommand(
              'codetime.playWalkthrough',
              msg.walkthroughId
            );
          } else if (msg?.type === 'deleteWalkthrough') {
            const ok = await vscode.window.showWarningMessage(
              'Delete this walkthrough? This cannot be undone.',
              { modal: true },
              'Delete'
            );
            if (ok !== 'Delete') return;
            walkthroughStorage.deleteWalkthrough(msg.walkthroughId);
            postAll('updatedWalkthroughs');
            // If user was viewing this walkthrough, kick them back to list
            view.webview.postMessage({ type: 'openWalkthrough', payload: { walkthrough: null } });
          } else if (msg?.type === 'deleteStep') {
            const updated = walkthroughStorage.deleteStepFromWalkthrough(msg.walkthroughId, msg.stepId);
            if (updated) {
              view.webview.postMessage({ type: 'openWalkthrough', payload: { walkthrough: updated } });
            }
            postAll('updatedWalkthroughs');
          }
        } catch (err) {
          console.error('Walkthrough view error:', err);
          view.webview.postMessage({
            type: 'error',
            payload: err?.message || String(err)
          });
        }
      });
    }
  };

  // register view id
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'codetime.walkthroughView',
      provider
    )
  );
}

module.exports = {
  registerWalkthroughView,
};
