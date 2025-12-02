// extension.js — CodeTime FR4 + FR5: Audio + Video Upload, Playback, Delete
const vscode = require('vscode');
const { registerWalkthroughView } = require('./walkthroughView');

/* ============================================================================
   AUDIO UTILITIES
============================================================================ */
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
    return {
      fileName: name,
      raw: raw.toString(),
      webviewSrc: webview.asWebviewUri(raw).toString()
    };
  });
}

/* ============================================================================
   VIDEO UTILITIES
============================================================================ */
async function ensureVideoDir(context) {
  const dir = vscode.Uri.joinPath(context.globalStorageUri, 'video');
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}

async function listVideoForWebview(webview, dir) {
  const entries = await vscode.workspace.fs.readDirectory(dir);
  const files = entries.filter(e => e[1] === vscode.FileType.File).map(e => e[0]);

  return files.map(name => {
    const raw = vscode.Uri.joinPath(dir, name);
    return {
      fileName: name,
      raw: raw.toString(),
      webviewSrc: webview.asWebviewUri(raw).toString()
    };
  });
}

/* ============================================================================
   INSTRUCTOR MODE HTML
============================================================================ */
function instructorHtml(webview, items) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
               img-src ${webview.cspSource};
               media-src ${webview.cspSource};
               style-src 'unsafe-inline' ${webview.cspSource};
               script-src 'unsafe-inline' ${webview.cspSource};">
<style>
  body { font-family:var(--vscode-font-family); padding:10px; color:var(--vscode-foreground); }
  h2   { margin:0 0 10px; font-size:13px; }
  ul   { list-style:none; padding-left:0; }
  .uploader { border:1px dashed var(--vscode-editorWidget-border);
              padding:12px; border-radius:8px; margin-bottom:12px; }
</style>
</head>

<body>
<h2>Instructor Mode</h2>

<div class="uploader">
  <input id="fileInput" type="file"
    accept=".mp3,.m4a,.wav,.ogg,.mp4,.mov,.mkv,.webm"
    multiple />
  <p style="opacity:.7;margin:6px 0 0">Files will appear below.</p>
</div>

<button id="addAnnotationButton">Add Annotation</button>

<ul id="list">${items}</ul>

<script>
  const vscode = acquireVsCodeApi();

  document.getElementById("fileInput").addEventListener("change", (ev) => {
    const files = [...(ev.target.files || [])];

    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const u8 = new Uint8Array(reader.result);
        let bin = ""; for (let i=0;i<u8.length;i++) bin += String.fromCharCode(u8[i]);
        const base64 = btoa(bin);

        const name = file.name.toLowerCase();

        if (name.endsWith(".mp3") || name.endsWith(".m4a") ||
            name.endsWith(".wav") || name.endsWith(".ogg")) {

          vscode.postMessage({ type:"storeAudio", name:file.name, base64 });

        } else if (name.endsWith(".mp4") || name.endsWith(".mov") ||
                   name.endsWith(".mkv") || name.endsWith(".webm")) {

          vscode.postMessage({ type:"storeVideo", name:file.name, base64 });
        }
      };
      reader.readAsArrayBuffer(file);
    });
    ev.target.value = "";
  });

  document.getElementById("addAnnotationButton").addEventListener("click", () => {
    vscode.postMessage({ type:"addAnnotation" });
  });

  window.addEventListener("message", (e) => {
    if (e.data?.type === "refresh") {
      document.getElementById("list").innerHTML = e.data.html;
    }
  });
</script>

</body></html>`;
}

/* ============================================================================
   TIMELINE VIEW (STUB)
============================================================================ */
function registerTimelineView(context) {
  const provider = {
    resolveWebviewView(view) {
      view.webview.options = { enableScripts:false };
      view.webview.html = "<html><body>Timeline Coming Soon…</body></html>";
    }
  };
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("codetime.timelineView", provider)
  );
}

/* ============================================================================
   INSTRUCTOR MODE PROVIDER
============================================================================ */
async function registerInstructorMode(context) {
  const audioDir = await ensureAudioDir(context);
  const videoDir = await ensureVideoDir(context);

  const provider = {
    resolveWebviewView: async (view) => {
      view.webview.options = {
        enableScripts: true,
        localResourceRoots: [context.globalStorageUri, context.extensionUri]
      };

      async function rebuild() {
        const audio = await listAudioForWebview(view.webview, audioDir);
        const video = await listVideoForWebview(view.webview, videoDir);

        const html = [
          ...audio.map(i => `
            <li>
              <audio controls src="${i.webviewSrc}"></audio>
              <span>${i.fileName}</span>
              <button data-uri="${i.raw}"
                onclick="vscode.postMessage({type:'delete',uri:this.getAttribute('data-uri')})">
                Delete
              </button>
            </li>`),

          ...video.map(i => `
            <li>
              <video controls width="200" src="${i.webviewSrc}"></video>
              <span>${i.fileName}</span>
              <button data-uri="${i.raw}"
                onclick="vscode.postMessage({type:'delete',uri:this.getAttribute('data-uri')})">
                Delete
              </button>
            </li>`)
        ].join("");

        view.webview.html = instructorHtml(view.webview, html);
      }

      await rebuild();

      /* ---------------- Handle Messages ---------------- */
      view.webview.onDidReceiveMessage(async msg => {
        try {
          if (msg.type === "storeAudio") {
            const safe = msg.name.replace(/[^\w\-. ]/g, "_");
            await vscode.workspace.fs.writeFile(
              vscode.Uri.joinPath(audioDir, safe),
              Buffer.from(msg.base64, "base64")
            );
            rebuild();

          } else if (msg.type === "storeVideo") {
            const safe = msg.name.replace(/[^\w\-. ]/g, "_");
            await vscode.workspace.fs.writeFile(
              vscode.Uri.joinPath(videoDir, safe),
              Buffer.from(msg.base64, "base64")
            );
            rebuild();

          } else if (msg.type === "delete") {
            await vscode.workspace.fs.delete(vscode.Uri.parse(msg.uri));
            rebuild();

          } else if (msg.type === "addAnnotation") {
            await vscode.commands.executeCommand("codetime.addAnnotation");
          }
        } catch (e) {
          vscode.window.showErrorMessage("Upload/Delete failed: " + e.message);
        }
      });

      /* Refresh command for internal use */
      context.subscriptions.push(
        vscode.commands.registerCommand("codetime.instructorMode.refresh", rebuild)
      );
    }
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("codetime.instructorMode", provider)
  );
}

/* ============================================================================
   ANNOTATION SYSTEM (Unmodified)
============================================================================ */

let annotationDecorationType;

function ensureAnnotationDecorationType() {
  if (!annotationDecorationType) {
    annotationDecorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true
    });
  }
}

function getFileKey(document) {
  const relative = vscode.workspace.asRelativePath(document.uri, false);
  return relative || document.uri.fsPath;
}

async function getAnnotationFileUri(document) {
  let rootUri;

  const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (wsFolder) rootUri = wsFolder.uri;
  else if (vscode.workspace.workspaceFolders?.length > 0)
    rootUri = vscode.workspace.workspaceFolders[0].uri;
  else
    rootUri = vscode.Uri.joinPath(document.uri, "..");

  const dir = vscode.Uri.joinPath(rootUri, ".codetime");
  await vscode.workspace.fs.createDirectory(dir);
  return vscode.Uri.joinPath(dir, "annotations.json");
}

async function loadAnnotations(document) {
  try {
    const fileUri = await getAnnotationFileUri(document);
    const data = await vscode.workspace.fs.readFile(fileUri);
    const raw = Buffer.from(data).toString("utf8").trim();
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.annotations)) return parsed.annotations;
    return [];
  } catch {
    return [];
  }
}

async function saveAnnotations(document, annotations) {
  const fileUri = await getAnnotationFileUri(document);
  const payload = JSON.stringify({ annotations }, null, 2);
  await vscode.workspace.fs.writeFile(
    fileUri,
    Buffer.from(payload, "utf8")
  );
}

async function refreshAnnotations(editor) {
  if (!editor) return;

  ensureAnnotationDecorationType();

  const document = editor.document;
  const all = await loadAnnotations(document);
  const fileKey = getFileKey(document);
  const relevant = all.filter(a => a.file === fileKey);

  const decorations = relevant.map(ann => ({
    range: new vscode.Range(
      Math.min(ann.startLine ?? ann.line ?? 0, document.lineCount - 1),
      0,
      Math.min(ann.startLine ?? ann.line ?? 0, document.lineCount - 1),
      0
    ),
    hoverMessage: new vscode.MarkdownString(ann.text || ""),
    renderOptions: {
      after: {
        contentText: "💬",
        margin: "0 0 0 1.5em"
      }
    }
  }));

  editor.setDecorations(annotationDecorationType, decorations);
}

async function addAnnotationCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return vscode.window.showErrorMessage("No active editor");

  const document = editor.document;
  const selection = editor.selection;

  const startLine = selection.start.line;
  const endLine = selection.isEmpty ? startLine : selection.end.line;

  const text = await vscode.window.showInputBox({ prompt: "Enter annotation" });
  if (!text) return;

  const all = await loadAnnotations(document);
  const fileKey = getFileKey(document);

  all.push({
    id: Date.now() + "-" + Math.random().toString(36).slice(2),
    file: fileKey,
    startLine,
    endLine,
    text
  });

  await saveAnnotations(document, all);
  refreshAnnotations(editor);
}

function registerAnnotationSupport(context) {
  ensureAnnotationDecorationType();

  context.subscriptions.push(
    vscode.commands.registerCommand("codetime.addAnnotation", addAnnotationCommand)
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) refreshAnnotations(editor);
    })
  );
}

/* ============================================================================
   ACTIVATE
============================================================================ */
async function activate(context) {
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);

  registerTimelineView(context);
  await registerInstructorMode(context);

  //register  walkthrough sidebar
  registerWalkthroughView(context);
  
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
  if (annotationDecorationType) annotationDecorationType.dispose();
}

module.exports = { activate, deactivate };
