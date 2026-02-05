// instructorModeView.js — Instructor Mode webview (upload audio/video + annotations)
const vscode = require('vscode');

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

/* -------------------------------------------------------------------------- */
/*                           INSTRUCTOR MODE HTML                             */
/* -------------------------------------------------------------------------- */
function instructorHtml(webview, itemsHtml) {
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
  :root {
    --ct-green: #2e7d32;
    --ct-green-soft: rgba(46,125,50,0.16);
    --ct-green-border: rgba(46,125,50,0.55);
  }
  body { font-family:var(--vscode-font-family); padding:10px; color:var(--vscode-foreground); }
  h2   { margin:0; font-size:13px; }
  ul   { list-style:none; padding-left:0; }
  .header {
    background: var(--ct-green-soft);
    border: 1px solid var(--ct-green-border);
    border-radius: 10px;
    padding: 10px 12px;
    margin-bottom: 12px;
  }
  .header-title { display:flex; align-items:center; gap:8px; font-weight:700; }
  .dot { width:10px; height:10px; border-radius: 999px; background: var(--ct-green); box-shadow: 0 0 0 4px var(--ct-green-soft); }
  .header-sub { opacity:0.75; font-size: 12px; margin-top: 6px; }
  .card {
    border: 1px solid var(--vscode-editorWidget-border);
    background: rgba(0,0,0,0.03);
    border-radius: 10px;
    padding: 12px;
    margin-bottom: 12px;
  }
  .row { display:flex; gap:8px; flex-wrap: wrap; }
  button { cursor:pointer; border-radius: 8px; padding: 6px 10px; border:1px solid var(--vscode-editorWidget-border); background: var(--vscode-button-secondaryBackground, rgba(0,0,0,0.10)); color: var(--vscode-foreground); }
  button:hover { filter: brightness(1.06); }
  button.primary { border-color: var(--ct-green-border); background: var(--ct-green-soft); }
  button.danger { border-color: rgba(255,82,82,0.35); background: rgba(255,82,82,0.10); }
  li { padding: 10px; border: 1px solid var(--vscode-editorWidget-border); border-radius: 10px; margin-bottom: 10px; background: rgba(0,0,0,0.02); }
  li .meta { opacity:0.75; font-size: 12px; margin-top: 6px; }
</style>
</head>

<body>
<div class="header">
  <div class="header-title"><span class="dot"></span><h2>Instructor Mode</h2></div>
  <div class="header-sub">Upload media, add annotations, and export a lesson package for Student Mode.</div>
</div>

<div class="card">
  <div class="row">
    <button class="primary" id="uploadAudioBtn">Upload Audio</button>
    <button class="primary" id="uploadVideoBtn">Upload Video</button>
    <button id="addAnnotationButton">Add Annotation</button>
    <button id="exportBtn">Export Lesson</button>
  </div>
</div>

<ul id="list">${itemsHtml}</ul>

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

  document.getElementById("exportBtn").addEventListener("click", () => {
    vscode.postMessage({ type:"exportLesson" });
  });

  window.addEventListener("message", (e) => {
    if (e.data?.type === "refresh") {
      document.getElementById("list").innerHTML = e.data.html;
    }
  });
</script>

</body></html>`;
}

/* -------------------------------------------------------------------------- */
/*                           INSTRUCTOR MODE VIEW                             */
/* -------------------------------------------------------------------------- */
async function registerInstructorMode(context) {
  const audioDir = await ensureAudioDir(context);
  const videoDir = await ensureVideoDir(context);

  const provider = {
    resolveWebviewView: async (view) => {
      view.webview.options = {
        enableScripts: true,
        localResourceRoots: [context.globalStorageUri]
      };

      const buildItemsHtml = async () => {
        const audio = await listAudioForWebview(view.webview, audioDir);
        const video = await listVideoForWebview(view.webview, videoDir);

        return [
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
        ].join('');
      };

      const rebuild = async () => {
        const html = await buildItemsHtml();
        view.webview.html = instructorHtml(view.webview, html);
      };

      await rebuild();

      view.webview.onDidReceiveMessage(async msg => {
        try {
          if (msg.type === 'pickAudio') {
            await uploadAudioCommand(context);
            await rebuild();
          } else if (msg.type === 'pickVideo') {
            await uploadVideoCommand(context);
            await rebuild();
          } else if (msg.type === 'delete') {
            await vscode.workspace.fs.delete(vscode.Uri.parse(msg.uri));
            await rebuild();
          } else if (msg.type === 'addAnnotation') {
            await vscode.commands.executeCommand('codetime.addAnnotation');
          } else if (msg.type === 'exportLesson') {
            await vscode.commands.executeCommand('codetime.exportPackage');
          }
        } catch (e) {
          vscode.window.showErrorMessage('Upload/Delete failed: ' + e.message);
        }
      });

      context.subscriptions.push(
        vscode.commands.registerCommand('codetime.instructorMode.refresh', rebuild)
      );
    }
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codetime.instructorMode', provider)
  );
}

module.exports = { registerInstructorMode };
