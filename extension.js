// extension.js — CodeTime FR4: Instructor Mode Audio Upload/Playback/Delete
const vscode = require('vscode');

/* ----------------------------- Utilities ----------------------------- */
async function ensureAudioDir(context) {
  const dir = vscode.Uri.joinPath(context.globalStorageUri, 'audio');
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}
async function listAudioForWebview(webview, dir) {
  const entries = await vscode.workspace.fs.readDirectory(dir);
  const files = entries.filter(e => e[1] === vscode.FileType.File).map(e => e[0]);
  return files.map(name => {
    const raw = vscode.Uri.joinPath(dir, name);
    return { fileName: name, raw: raw.toString(), webviewSrc: webview.asWebviewUri(raw).toString() };
  });
}

/* ----------------------------- HTML Builders ----------------------------- */
function instructorHtml(webview, items) {
  const rows = (items||[]).map(i => `
    <li style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px">
        <audio controls src="${i.webviewSrc}"></audio>
        <span title="${i.fileName}" style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.fileName}</span>
        <button data-uri="${i.raw}" onclick="vscode.postMessage({type:'delete', uri:this.getAttribute('data-uri')})">Delete</button>
      </div>
    </li>
  `).join('');

  return `<!doctype html><html><head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; img-src ${webview.cspSource}; media-src ${webview.cspSource};
                   script-src 'unsafe-inline' ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource};">
    <style>
      body{font-family:var(--vscode-font-family);padding:10px;color:var(--vscode-foreground)}
      h2{margin:0 0 10px;font-size:13px}
      .uploader{border:1px dashed var(--vscode-editorWidget-border);padding:12px;border-radius:8px;margin-bottom:12px}
      ul{list-style:none;margin:0;padding-left:0}
    </style>
  </head><body>
    <h2>Instructor Mode</h2>
    <div class="uploader">
      <input id="fileInput" type="file" accept=".mp3,.m4a,.wav,.ogg" multiple />
      <p style="opacity:.7;margin:6px 0 0">Files are stored in CodeTime global storage and listed below.</p>
    </div>
    <ul id="list">${rows}</ul>
    <script>
      const vscode = acquireVsCodeApi();
      document.getElementById('fileInput').addEventListener('change', (ev) => {
        const files = ev.target.files || [];
        [...files].forEach(file => {
          const reader = new FileReader();
          reader.onload = () => {
            const u8 = new Uint8Array(reader.result);
            let bin = ""; for (let i=0;i<u8.length;i++) bin += String.fromCharCode(u8[i]);
            vscode.postMessage({ type:'store', name:file.name, base64:btoa(bin) });
          };
          reader.readAsArrayBuffer(file);
        });
        ev.target.value = "";
      });
      window.addEventListener('message', (e) => {
        if (e.data?.type === 'refresh') {
          document.getElementById('list').innerHTML = e.data.html;
        }
      });
    </script>
  </body></html>`;
}

/* ----------------------------- Providers ----------------------------- */
function registerTimelineView(context) {
  const provider = {
    resolveWebviewView(view) {
      view.webview.options = { enableScripts: false };
      view.webview.html = `<!doctype html><html><body style="font-family:var(--vscode-font-family);padding:10px">
        <div style="opacity:.8;font-size:12px">CodeTime Timeline</div>
        <div style="opacity:.7;margin-top:6px">Stub provider loaded.</div>
      </body></html>`;
    }
  };
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('codetime.timelineView', provider));
}

async function registerInstructorMode(context) {
  const audioDir = await ensureAudioDir(context);

  // Command from title bar
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.uploadAudio', async () => {
      const files = await vscode.window.showOpenDialog({
        title: 'Upload audio clips',
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: true,
        filters: { Audio: ['mp3','m4a','wav','ogg'] }
      });
      if (!files || !files.length) return;
      for (const src of files) {
        const bytes = await vscode.workspace.fs.readFile(src);
        const name = src.path.split('/').pop();
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(audioDir, name), bytes);
      }
      vscode.commands.executeCommand('codetime.instructorMode.refresh');
    })
  );

  // Focus command
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.openInstructorMode', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.codetime');
      await vscode.commands.executeCommand('codetime.instructorMode.focus');
    })
  );

  const provider = {
    resolveWebviewView: async (view) => {
      view.webview.options = {
        enableScripts: true,
        localResourceRoots: [context.globalStorageUri, context.extensionUri]
      };

      const render = async () => {
        const items = await listAudioForWebview(view.webview, audioDir);
        view.webview.html = instructorHtml(view.webview, items);
      };
      await render();

      view.webview.onDidReceiveMessage(async (msg) => {
        try {
          if (msg?.type === 'store') {
            const safe = (msg.name || 'clip.mp3').replace(/[^\w\-. ]/g,'_');
            const bytes = Buffer.from(msg.base64, 'base64');
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(audioDir, safe), bytes);
            vscode.commands.executeCommand('codetime.instructorMode.refresh');
          } else if (msg?.type === 'delete' && msg.uri) {
            await vscode.workspace.fs.delete(vscode.Uri.parse(msg.uri));
            vscode.commands.executeCommand('codetime.instructorMode.refresh');
          }
        } catch (e) {
          vscode.window.showErrorMessage('Audio action failed: ' + (e?.message || e));
          console.error(e);
        }
      });

      // Internal refresh
      context.subscriptions.push(
        vscode.commands.registerCommand('codetime.instructorMode.refresh', async () => {
          const items = await listAudioForWebview(view.webview, audioDir);
          const html = items.map(i => `
            <li style="margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:8px">
                <audio controls src="${i.webviewSrc}"></audio>
                <span title="${i.fileName}" style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.fileName}</span>
                <button data-uri="${i.raw}" onclick="vscode.postMessage({type:'delete', uri:this.getAttribute('data-uri')})">Delete</button>
              </div>
            </li>
          `).join('');
          view.webview.postMessage({ type: 'refresh', html });
        })
      );
    }
  };

  context.subscriptions.push(vscode.window.registerWebviewViewProvider('codetime.instructorMode', provider));
}

/* ----------------------------- Activate ----------------------------- */
async function activate(context) {
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  registerTimelineView(context);
  await registerInstructorMode(context);
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.test', () =>
      vscode.window.showInformationMessage('CodeTime activated ✔'))
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
