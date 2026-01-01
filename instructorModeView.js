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
