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
      .actions{margin-top:10px} 
    </style>
  </head><body>
    <h2>Instructor Mode</h2>
    <div class="uploader">
      <input id="fileInput" type="file" accept=".mp3,.m4a,.wav,.ogg" multiple />
      <p style="opacity:.7;margin:6px 0 0">Files are stored in CodeTime global storage and listed below.</p>
    </div>
     <div class="actions"> 
      <button id="addAnnotationButton">Add Annotation</button> 
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

       document.getElementById('addAnnotationButton').addEventListener('click', () => { 
        vscode.postMessage({ type: 'addAnnotation' });                                   
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
          } else if (msg?.type === 'addAnnotation') {               
            await vscode.commands.executeCommand('codetime.addAnnotation');  
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

// extension.js — CodeTime FR3: Instructor Mode Annotate Code

let annotationDecorationType;

function ensureAnnotationDecorationType(){
  if(!annotationDecorationType){
    annotationDecorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true
      
    });
  }
}

function getFileKey(document){
  const relative = vscode.workspace.asRelativePath(document.uri, false);
  return relative || document.uri.fsPath;
}

//annotation file helper
async function getAnnotationFileUri(document){
  let rootUri;

  const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (wsFolder) {
    rootUri = wsFolder.uri;
  } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0){
    rootUri = vscode.workspace.workspaceFolders[0].uri;
  } else {
    rootUri = vscode.Uri.joinPath(document.uri, '..');
  }

  const dir = vscode.Uri.joinPath(rootUri, '.codetime');
  await vscode.workspace.fs.createDirectory(dir);
  return vscode.Uri.joinPath(dir, 'annotations.json');
}

//loading annotations
async function loadAnnotations(document){
  try{
    const fileUri = await getAnnotationFileUri(document);
    const data = await vscode.workspace.fs.readFile(fileUri);
    const raw = Buffer.from(data).toString('utf8').trim();
    if(!raw) return [];

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.annotations)) return parsed.annotations;
    return[];
  } catch {
    return[];
  }
}

//save annotations
async function saveAnnotations(document, annotations){
  const fileUri = await getAnnotationFileUri(document);
  const payload = JSON.stringify({ annotations }, null, 2);
  const bytes = Buffer.from(payload, 'utf8');
  await vscode.workspace.fs.writeFile(fileUri, bytes);
}

//draw annotation
async function refreshAnnotations(editor){
  if (!editor) return;

  ensureAnnotationDecorationType();

  const document = editor.document;
  const all = await loadAnnotations(document);
  const fileKey = getFileKey(document);

  const relevant = all.filter(a => a.file === fileKey);

  const decorations = relevant.map (ann => {
    const line = Math.min(
      typeof ann.startLine === 'number'
      ? ann.startLine
      : (ann.line ?? 0),
      document.lineCount - 1
    );

    const preview = (ann.text || '').replace(/\s+/g, ' ').slice(0, 80);
    const hover = new vscode.MarkdownString(ann.text || '');
    hover.isTrusted = true;

    return{
      range: new vscode.Range(line, 0, line, 0),
      hoverMessage: hover,
      renderOptions: {
        after: {
          contentText: '💬',
          margin: '0 0 0 1.5em'
        }
      }

    };
});

editor.setDecorations(annotationDecorationType, decorations);
}

//add annotation command
async function addAnnotationCommand(){
  const editor = vscode.window.activeTextEditor;
  if(!editor){
    vscode.window.showErrorMessage('CodeTime: No active editor.');
    return;
  }

  const document = editor.document;
  const selection = editor.selection;

  const startLine = selection.start.line;
  const endLine = selection.isEmpty ? selection.start.line : selection.end.line;

  const text = await vscode.window.showInputBox({
    prompt: 'Enter annotation markdown'
  });

  if (!text) return;

  const all = await loadAnnotations(document);
  const fileKey = getFileKey(document);

  all.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file: fileKey,
    startLine,
    endLine,
    text
  });

  await saveAnnotations(document, all);
  vscode.window.showInformationMessage('Annotation saved');
  refreshAnnotations(editor);
}

//register annotation system
function registerAnnotationSupport(context){
  ensureAnnotationDecorationType();

  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.addAnnotation', addAnnotationCommand)
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) {
        refreshAnnotations(editor);
      }
    })
  );
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

  registerAnnotationSupport(context);

  if (vscode.window.activeTextEditor) {
    refreshAnnotations(vscode.window.activeTextEditor);
  }
}

function deactivate() {
  if (annotationDecorationType) {
    annotationDecorationType.dispose();
  }  
}

module.exports = { activate, deactivate };
