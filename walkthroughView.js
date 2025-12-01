// Walkthrough sidebar view where you can create and list walkthroughs
const vscode = require('vscode');
const walkthroughStorage = require('./walkthroughStorage');

function getWalkthroughHtml(webview) {
  const cspSource = webview.cspSource;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
        content="
          default-src 'none';
          img-src ${cspSource};
          script-src 'unsafe-inline' ${cspSource};
          style-src 'unsafe-inline' ${cspSource};
        ">
  <style>
    :root {
      /* soft green accent */
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

    button:hover {
      filter: brightness(1.05);
    }

    button:active {
      filter: brightness(0.95);
    }

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
  </style>
</head>
<body>
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
      Tip: Start with something small, like "Intro to loops" or "First refactor".
    </div>
  </div>

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

  <h2>Your walkthroughs</h2>
  <ul id="walkthroughList">
    <li class="empty">Loading your walkthroughs…</li>
  </ul>

  <script>
    const vscode = acquireVsCodeApi();

    const form = document.getElementById('new-walkthrough-form');
    const titleInput = document.getElementById('titleInput');
    const descriptionInput = document.getElementById('descriptionInput');
    const errorEl = document.getElementById('error');
    const listEl = document.getElementById('walkthroughList');

    function renderList(items) {
      if (!Array.isArray(items) || items.length === 0) {
        listEl.innerHTML =
          '<li class="empty">No walkthroughs yet. Create your first one above. </li>';
        return;
      }

      listEl.innerHTML = items.map(w => {
        const created = w.createdAt
          ? new Date(w.createdAt).toLocaleString()
          : '';
        const numSteps = Array.isArray(w.steps) ? w.steps.length : 0;
        const desc = (w.description || '').trim();

        return \`
          <li>
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

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) return;
      switch (msg.type) {
        case 'init':
        case 'updatedWalkthroughs':
          errorEl.textContent = '';
          renderList((msg.payload && msg.payload.walkthroughs) || []);
          break;
        case 'error':
          errorEl.textContent = msg.payload || 'Something went wrong.';
          break;
      }
    });

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

    // ask extension for data when view loads
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function registerWalkthroughView(context) {
  const provider = {
    resolveWebviewView(view) {
      view.webview.options = { enableScripts: true };
      view.webview.html = getWalkthroughHtml(view.webview);

      function postAll(type) {
        const all = walkthroughStorage.getAllWalkthroughs();
        view.webview.postMessage({
          type,
          payload: { walkthroughs: all }
        });
      }

      view.webview.onDidReceiveMessage((msg) => {
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