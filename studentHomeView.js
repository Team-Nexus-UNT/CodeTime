const vscode = require("vscode");

class StudentHomeViewProvider {
  constructor(context) {
    this.context = context;
  }

  resolveWebviewView(view) {
    view.webview.options = { enableScripts: true };

    const render = (mode) => {
      const isStudent = mode === "student";

      view.webview.html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src 'unsafe-inline' ${view.webview.cspSource};
                 script-src 'unsafe-inline' ${view.webview.cspSource};">
  <style>
    :root{
      --ct-green:#2e7d32;
      --ct-green-soft: rgba(46,125,50,0.16);
      --ct-green-border: rgba(46,125,50,0.55);
      --border: var(--vscode-editorWidget-border, rgba(255,255,255,0.15));
    }
    body{
      font-family: var(--vscode-font-family);
      padding: 12px;
      color: var(--vscode-foreground);
    }
    .card{
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px;
      background: rgba(0,0,0,0.03);
      margin-bottom: 12px;
    }
    .header{
      border-color: var(--ct-green-border);
      background: var(--ct-green-soft);
    }
    .row{
      display:flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
    }
    h2{
      margin:0;
      font-size: 15px;
      font-weight: 700;
    }
    .sub{
      margin: 6px 0 0;
      font-size: 12px;
      opacity: 0.85;
      line-height: 1.3;
    }
    button{
      cursor:pointer;
      border-radius: 12px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      background: rgba(0,0,0,0.06);
      color: var(--vscode-foreground);
      font-size: 12px;
    }
    button:hover{ filter: brightness(1.06); }
    .primary{
      border-color: var(--ct-green-border);
      background: rgba(46,125,50,0.18);
    }
    .warn{
      border-color: rgba(255,82,82,0.35);
      background: rgba(255,82,82,0.10);
    }
    .muted{
      font-size: 12px;
      opacity: 0.8;
    }
    .bigBtn{
      width:100%;
      text-align:left;
      padding: 10px 12px;
      font-size: 13px;
    }
    .btnTitle{ font-weight: 700; margin-bottom: 2px; }
    .btnDesc{ font-size: 12px; opacity: 0.85; line-height: 1.25; }
  </style>
</head>
<body>

  <div class="card header">
    <div class="row">
      <h2>Student Mode</h2>
      <button id="homeBtn">Back to Home</button>
    </div>
    <p class="sub">Load a lesson package, then play through walkthrough steps with media + annotations.</p>
  </div>

  ${
    isStudent
      ? `
        <div class="card">
          <div class="muted" style="margin-bottom:10px;">Status: no lesson loaded</div>

          <button id="loadLesson" class="primary bigBtn">
            <div class="btnTitle">Load Lesson Package</div>
            <div class="btnDesc">Pick a .zip export from Instructor Mode (coming next).</div>
          </button>

          <div style="height:8px;"></div>

          <button id="startPlayback" class="bigBtn" disabled style="opacity:0.55; cursor:not-allowed;">
            <div class="btnTitle">Start Playback</div>
            <div class="btnDesc">Disabled until a lesson is loaded.</div>
          </button>
        </div>
      `
      : `
        <div class="card warn">
          <div style="font-weight:700; margin-bottom:6px;">You’re not in Student Mode.</div>
          <div class="muted">Go back to Home and choose Student Mode.</div>
          <div style="height:10px;"></div>
          <button id="goHome" class="warn">Go Home</button>
        </div>
      `
  }

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById("homeBtn")?.addEventListener("click", () => {
      vscode.postMessage({ type: "home" });
    });

    document.getElementById("goHome")?.addEventListener("click", () => {
      vscode.postMessage({ type: "home" });
    });

    document.getElementById("loadLesson")?.addEventListener("click", () => {
      vscode.postMessage({ type: "loadLesson" });
    });
  </script>
</body>
</html>`;
    };

    const mode = this.context.globalState.get("codetime.mode") || "none";
    render(mode);

    view.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === "home") {
        await vscode.commands.executeCommand("codetime.backToHome");
      } else if (msg?.type === "loadLesson") {
        vscode.window.showInformationMessage("Student: Load Lesson Package (next step we implement).");
      }
    });

    // allow extension.js to push refreshes if mode changes while open
    this._refresh = () => {
      const latest = this.context.globalState.get("codetime.mode") || "none";
      render(latest);
    };
  }
}

module.exports = StudentHomeViewProvider;