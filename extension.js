// extension.js — CodeTime: Audio/Video Upload (extension-side picker) + Annotations with Delete
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
    return { fileName: name, raw: raw.toString(), webviewSrc: webview.asWebviewUri(raw).toString() };
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
    return { fileName: name, raw: raw.toString(), webviewSrc: webview.asWebviewUri(raw).toString() };
  });
}

/* ============================================================================
   INSTRUCTOR MODE HTML (buttons trigger extension pickers via postMessage)
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
  .row { display:flex; gap:8px; margin-bottom:10px; }
  button { cursor:pointer; }
</style>
</head>

<body>
<h2>Instructor Mode</h2>

<div class="uploader">
  <div class="row">
    <button id="uploadAudioBtn">Upload Audio</button>
    <button id="uploadVideoBtn">Upload Video</button>
  </div>
  <p style="opacity:.7;margin:6px 0 0">Files will appear below.</p>
</div>

<button id="addAnnotationButton">Add Annotation</button>

<ul id="list">${items}</ul>

<script>
  const vscode = acquireVsCodeApi();

  document.getElementById("uploadAudioBtn").addEventListener("click", () => {
    vscode.postMessage({ type: "pickAudio" });
  });

  document.getElementById("uploadVideoBtn").addEventListener("click", () => {
    vscode.postMessage({ type: "pickVideo" });
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
      view.webview.options = { enableScripts: false };
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
        localResourceRoots: [context.globalStorageUri]
      };

      const rebuild = async () => {
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
      };

      await rebuild();

      view.webview.onDidReceiveMessage(async msg => {
        try {
          if (msg.type === "pickAudio") {
            await uploadAudioCommand(context);
            await rebuild();
          } else if (msg.type === "pickVideo") {
            await uploadVideoCommand(context);
            await rebuild();
          } else if (msg.type === "delete") {
            await vscode.workspace.fs.delete(vscode.Uri.parse(msg.uri));
            await rebuild();
          } else if (msg.type === "addAnnotation") {
            await vscode.commands.executeCommand("codetime.addAnnotation");
          }
        } catch (e) {
          vscode.window.showErrorMessage("Upload/Delete failed: " + e.message);
        }
      });

      context.subscriptions.push(
        vscode.commands.registerCommand("codetime.instructorMode.refresh", rebuild)
      );
    }
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codetime.instructorMode', provider)
  );
}

/* ============================================================================
   EXTENSION-SIDE PICKERS (no base64 in webview)
============================================================================ */
async function uploadAudioCommand(context) {
  const audioDir = await ensureAudioDir(context);
  const picks = await vscode.window.showOpenDialog({
    title: "Select audio files to upload",
    canSelectMany: true,
    filters: { "Audio": ["mp3", "m4a", "wav", "ogg"] }
  });
  if (!picks || picks.length === 0) return;

  for (const src of picks) {
    const data = await vscode.workspace.fs.readFile(src);
    const base = src.path.split("/").pop() || "audio";
    const safe = base.replace(/[^\w\-. ]/g, "_");
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(audioDir, safe), data);
  }
  try { await vscode.commands.executeCommand("codetime.instructorMode.refresh"); } catch {}
  vscode.window.showInformationMessage(`Uploaded ${picks.length} audio file${picks.length > 1 ? "s" : ""}.`);
}

async function uploadVideoCommand(context) {
  const videoDir = await ensureVideoDir(context);
  const picks = await vscode.window.showOpenDialog({
    title: "Select video files to upload",
    canSelectMany: true,
    filters: { "Video": ["mp4", "mov", "mkv", "webm"] }
  });
  if (!picks || picks.length === 0) return;

  for (const src of picks) {
    const data = await vscode.workspace.fs.readFile(src);
    const base = src.path.split("/").pop() || "video";
    const safe = base.replace(/[^\w\-. ]/g, "_");
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(videoDir, safe), data);
  }
  try { await vscode.commands.executeCommand("codetime.instructorMode.refresh"); } catch {}
  vscode.window.showInformationMessage(`Uploaded ${picks.length} video file${picks.length > 1 ? "s" : ""}.`);
}

/* ============================================================================
   ANNOTATION SYSTEM (enhanced: hover preview + Delete)
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
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(payload, "utf8"));
}

function _encodeArgs(obj) {
  // Safe JSON → URI for command links in Markdown hovers
  return encodeURIComponent(JSON.stringify(obj));
}

async function refreshAnnotations(editor) {
  if (!editor) return;

  ensureAnnotationDecorationType();

  const document = editor.document;
  const all = await loadAnnotations(document);
  const fileKey = getFileKey(document);
  const relevant = all.filter(a => a.file === fileKey);

  const decorations = relevant.map(ann => {
    const preview = (ann.text || "").trim();
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = false;

    const args = { id: ann.id, file: fileKey };
    const encoded = _encodeArgs(args);

    md.appendMarkdown(preview ? preview : "_(no text)_");
    md.appendMarkdown("\n\n---\n");
    md.appendMarkdown(`[Delete annotation](command:codetime.deleteAnnotation?${encoded})`);

    const line = Math.min(ann.startLine ?? ann.line ?? 0, document.lineCount - 1);
    return {
      range: new vscode.Range(line, 0, line, 0),
      hoverMessage: md,
      renderOptions: { after: { contentText: "💬", margin: "0 0 0 1.5em" } }
    };
  });

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

async function deleteAnnotationCommand(args) {
  try {
    if (!args?.id || !args?.file) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const document = editor.document;

    const all = await loadAnnotations(document);
    const next = all.filter(a => !(a.id === args.id && a.file === args.file));
    await saveAnnotations(document, next);
    await refreshAnnotations(editor);
    vscode.window.showInformationMessage("Annotation deleted.");
  } catch (e) {
    vscode.window.showErrorMessage("Failed to delete annotation: " + e.message);
  }
}

function registerAnnotationSupport(context) {
  ensureAnnotationDecorationType();

  context.subscriptions.push(
    vscode.commands.registerCommand("codetime.addAnnotation", addAnnotationCommand)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("codetime.deleteAnnotation", deleteAnnotationCommand)
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
  registerWalkthroughView(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.test', () => {
      vscode.window.showInformationMessage('CodeTime activated ✔');
    })
  );

  // Command palette entries (also used by in-panel buttons via messages)
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.uploadAudio', () => uploadAudioCommand(context))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.uploadVideo', () => uploadVideoCommand(context))
  );
  // legacy alias
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.recordVideo', () =>
      vscode.commands.executeCommand('codetime.uploadVideo'))
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
