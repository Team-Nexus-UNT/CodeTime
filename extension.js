// extension.js — CodeTime with working webcam & screen recording
const vscode = require('vscode');
const cp = require('child_process'); // for git commit lookup

/* -------------------------------------------------------------------------- */
/*                          DIRECTORY UTILITIES                               */
/* -------------------------------------------------------------------------- */
async function ensureAudioDir(context) {
  const dir = vscode.Uri.joinPath(context.globalStorageUri, 'audio');
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}

async function ensureVideoDir(context) {
  const dir = vscode.Uri.joinPath(context.globalStorageUri, 'video');
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}

async function listAudioForWebview(webview, dir) {
  const entries = await vscode.workspace.fs.readDirectory(dir);
  return entries
    .filter(e => e[1] === vscode.FileType.File)
    .map(([name]) => {
      const raw = vscode.Uri.joinPath(dir, name);
      return {
        fileName: name,
        raw: raw.toString(),
        webviewSrc: webview.asWebviewUri(raw).toString()
      };
    });
}
// ---------- Annotation metadata helpers (video/audio) ----------

// Where we keep all annotations (videos, later maybe audio)
function getAnnotationsFileUri(context) {
  return vscode.Uri.joinPath(context.globalStorageUri, 'annotations.json');
}

async function readAnnotations(context) {
  const fileUri = getAnnotationsFileUri(context);
  try {
    const bytes = await vscode.workspace.fs.readFile(fileUri);
    const text = Buffer.from(bytes).toString('utf8');
    if (!text.trim()) return [];
    return JSON.parse(text);
  } catch (e) {
    // file does not exist or bad JSON → start fresh
    return [];
  }
}

async function writeAnnotations(context, items) {
  const json = JSON.stringify(items, null, 2);
  const bytes = Buffer.from(json, 'utf8');
  await vscode.workspace.fs.writeFile(getAnnotationsFileUri(context), bytes);
}

// get current workspace root (first folder)
function getWorkspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  return folders[0].uri.fsPath;
}

// best-effort: Git commit hash of HEAD
function getCurrentCommitHash() {
  try {
    const cwd = getWorkspaceRoot();
    if (!cwd) return undefined;
    const out = cp.execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' });
    return out.trim();
  } catch {
    return undefined;
  }
}

// file + line where the user is currently focused
function getCurrentCodeLocation() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;

  const doc = editor.document;
  const pos = editor.selection.active;

  return {
    filePath: doc.uri.fsPath,
    relativePath: vscode.workspace.asRelativePath(doc.uri),
    line: pos.line + 1  // 1-based line number
  };
}
/* -------------------------------------------------------------------------- */
/*                      INSTRUCTOR AUDIO MODE — HTML                          */
/* -------------------------------------------------------------------------- */
function instructorHtml(webview, items) {
  const list = items.map(i => `
    <li style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px">
        <audio controls src="${i.webviewSrc}"></audio>
        <span style="flex:1">${i.fileName}</span>
        <button data-uri="${i.raw}" onclick="
          vscode.postMessage({type:'delete', uri:this.getAttribute('data-uri')})
        ">Delete</button>
      </div>
    </li>`).join('');

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy"
     content="default-src 'none';
      img-src ${webview.cspSource};
      media-src ${webview.cspSource};
      script-src 'unsafe-inline' ${webview.cspSource};
      style-src 'unsafe-inline' ${webview.cspSource};">
  </head>
  <body style="font-family:var(--vscode-font-family);padding:12px">
    <h2>Instructor Mode</h2>

    <input id="fileInput" type="file" accept=".mp3,.m4a,.wav,.ogg" multiple />

    <ul id="list">${list}</ul>

    <script>
      const vscode = acquireVsCodeApi();

      document.getElementById('fileInput').addEventListener('change', (e) => {
        [...e.target.files].forEach(file => {
          const reader = new FileReader();
          reader.onload = () => {
            let bin = '';
            const u8 = new Uint8Array(reader.result);
            for (let i=0;i<u8.length;i++) bin += String.fromCharCode(u8[i]);
            vscode.postMessage({
              type:'store',
              name:file.name,
              base64:btoa(bin)
            });
          };
          reader.readAsArrayBuffer(file);
        });
      });

      window.addEventListener('message', (e) => {
        if (e.data?.type === 'refresh') {
          document.getElementById('list').innerHTML = e.data.html;
        }
      });
    </script>
  </body>
  </html>`;
}

/* -------------------------------------------------------------------------- */
/*                    WORKING VIDEO RECORDER — HTML                           */
/* -------------------------------------------------------------------------- */
function getVideoRecorderHtml(webview) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
     content="default-src 'none';
              media-src blob:;
              img-src ${webview.cspSource};
              script-src 'unsafe-inline' ${webview.cspSource};
              style-src 'unsafe-inline' ${webview.cspSource};">

  <style>
    body { font-family: var(--vscode-font-family); padding: 15px; color: var(--vscode-foreground); }
    video { width: 100%; border-radius: 6px; margin-bottom: 10px; background: #000; }
    button { padding: 6px 12px; margin-right: 6px; }
    #error { color: #ff6666; margin-top: 8px; font-size: 13px; }
  </style>
</head>
<body>

<h2>Record Video Clip (Webcam Only)</h2>

<video id="preview" autoplay muted></video>

<div>
  <button id="startBtn">Start Recording</button>
  <button id="stopBtn" disabled>Stop Recording</button>
</div>

<p id="timer" style="margin-top:8px;opacity:.7">0s</p>
<p id="error"></p>

<script>
  const vscode = acquireVsCodeApi();

  let stream;
  let recorder;
  let chunks = [];
  let timerInterval;
  let elapsed = 0;

  const preview = document.getElementById('preview');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const timerEl = document.getElementById('timer');
  const errorEl = document.getElementById('error');

  async function startCamera() {
    try {
      chunks = [];
      errorEl.textContent = "";

      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      preview.srcObject = stream;

      recorder = new MediaRecorder(stream, { mimeType: "video/webm" });

      recorder.ondataavailable = (e) => chunks.push(e.data);

      recorder.onstop = () => {
        clearInterval(timerInterval);

        const blob = new Blob(chunks, { type: "video/webm" });
        const reader = new FileReader();

        reader.onloadend = () => {
          vscode.postMessage({
            type: "saveVideo",
            base64: btoa(reader.result)
          });
        };

        reader.readAsBinaryString(blob);
      };

      recorder.start();

      startBtn.disabled = true;
      stopBtn.disabled = false;

      elapsed = 0;
      timerInterval = setInterval(() => {
        elapsed++;
        timerEl.textContent = elapsed + "s";
      }, 1000);

    } catch (err) {
      errorEl.textContent = "Camera Error: " + (err.message || err);
    }
  }

  startBtn.onclick = startCamera;

  stopBtn.onclick = () => {
    recorder.stop();
    stream.getTracks().forEach(t => t.stop());
    stopBtn.disabled = true;
  };
</script>

</body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/*                             TIMELINE VIEW (Stub)                           */
/* -------------------------------------------------------------------------- */
function registerTimelineView(context) {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codetime.timelineView', {
      resolveWebviewView(view) {
        view.webview.options = { enableScripts: false };
        view.webview.html = `<h3 style="padding:10px">Timeline Coming Soon…</h3>`;
      }
    })
  );
}

/* -------------------------------------------------------------------------- */
/*                       INSTRUCTOR AUDIO MODE HANDLER                        */
/* -------------------------------------------------------------------------- */
async function registerInstructorMode(context) {
  const audioDir = await ensureAudioDir(context);

  // upload audio from command palette
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.uploadAudio', async () => {
      const files = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: true,
        filters: { Audio: ['mp3','m4a','wav','ogg'] }
      });
      if (!files) return;

      for (const src of files) {
        const bytes = await vscode.workspace.fs.readFile(src);
        const safeName = src.path.split('/').pop();
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(audioDir, safeName), bytes);
      }

      vscode.commands.executeCommand('codetime.instructorMode.refresh');
    })
  );

  // open instructor mode panel
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.openInstructorMode', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.codetime');
      await vscode.commands.executeCommand('codetime.instructorMode.focus');
    })
  );

  // view provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codetime.instructorMode', {
      resolveWebviewView: async (view) => {
        view.webview.options = {
          enableScripts: true,
          localResourceRoots: [context.globalStorageUri]
        };

        const render = async () => {
          const items = await listAudioForWebview(view.webview, audioDir);
          view.webview.html = instructorHtml(view.webview, items);
        };
        await render();

        view.webview.onDidReceiveMessage(async (msg) => {
          if (msg.type === 'store') {
            const safe = msg.name.replace(/[^\w\-. ]/g, '_');
            await vscode.workspace.fs.writeFile(
              vscode.Uri.joinPath(audioDir, safe),
              Buffer.from(msg.base64, 'base64')
            );
            vscode.commands.executeCommand('codetime.instructorMode.refresh');

          } else if (msg.type === 'delete') {
            await vscode.workspace.fs.delete(vscode.Uri.parse(msg.uri));
            vscode.commands.executeCommand('codetime.instructorMode.refresh');
          }
        });

        context.subscriptions.push(
          vscode.commands.registerCommand('codetime.instructorMode.refresh', async () => {
            const items = await listAudioForWebview(view.webview, audioDir);
            const html = items.map(i => `
              <li>
                <audio controls src="${i.webviewSrc}"></audio>
                <span>${i.fileName}</span>
              </li>
            `).join('');
            view.webview.postMessage({ type: 'refresh', html });
          })
        );
      }
    })
  );
}

/* -------------------------------------------------------------------------- */
/*                          RECORD VIDEO CLIP COMMAND                          */
/* -------------------------------------------------------------------------- */
async function registerRecordVideo(context) {
  const videoDir = await ensureVideoDir(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.recordVideo', () => {
      const panel = vscode.window.createWebviewPanel(
        'codetimeRecordVideo',
        'Record Video Clip',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [context.globalStorageUri, context.extensionUri]
        }
      );

      panel.webview.html = getVideoRecorderHtml(panel.webview);

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.type === 'saveVideo') {
          try {
            // 1. Save the raw video file
            const bytes = Buffer.from(msg.base64, 'base64');
            const name = `video_${Date.now()}.webm`;
            const target = vscode.Uri.joinPath(videoDir, name);

            await vscode.workspace.fs.writeFile(target, bytes);

            // 2. Gather context: file/line/commit/time
            const location = getCurrentCodeLocation();   // may be undefined
            const commit = getCurrentCommitHash();       // may be undefined
            const timestamp = Date.now();

            // 3. Read existing annotations
            const annotations = await readAnnotations(context);

            // 4. Push a new video annotation
            annotations.push({
              kind: 'video',
              videoFile: name,
              createdAt: timestamp,
              commit: commit || null,
              filePath: location ? location.filePath : null,
              relativePath: location ? location.relativePath : null,
              line: location ? location.line : null
            });

            // 5. Save updated annotations back to disk
            await writeAnnotations(context, annotations);

            vscode.window.showInformationMessage(
              `Video saved and linked` +
              (location
                ? ` to ${location.relativePath}:${location.line}`
                : ` (no active file/line found)`)
            );
          } catch (e) {
            vscode.window.showErrorMessage('Video save failed: ' + e.message);
            console.error(e);
          }
        }
      });
    })
  );
}

/* -------------------------------------------------------------------------- */
/*                                   ACTIVATE                                */
/* -------------------------------------------------------------------------- */
async function activate(context) {
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);

  registerTimelineView(context);
  await registerInstructorMode(context);
  await registerRecordVideo(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.test', () => {
      vscode.window.showInformationMessage('CodeTime activated ✔');
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
