const vscode = require("vscode");

class HomeViewProvider {
  constructor(context) {
    this.context = context;
  }

  resolveWebviewView(view) {
    view.webview.options = { enableScripts: true };

    const render = (mode) => {
      const safeMode = mode || "none";

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
    .hero{
      border-color: var(--ct-green-border);
      background: var(--ct-green-soft);
    }
    .titleRow{
      display:flex;
      align-items:center;
      gap:10px;
      margin-bottom: 8px;
    }
    .dot{
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--ct-green);
      box-shadow: 0 0 0 4px var(--ct-green-soft);
    }
    h2{
      margin:0;
      font-size: 15px;
      font-weight: 700;
    }
    .sub{
      margin:0;
      opacity: 0.85;
      font-size: 12px;
      line-height: 1.3;
    }
    .modeLine{
      margin-top: 10px;
      font-size: 12px;
      opacity: 0.9;
    }
    .pill{
      display:inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: rgba(0,0,0,0.06);
      font-size: 11px;
      margin-left: 6px;
    }
    .row{
      display:flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    button{
      cursor:pointer;
      width: 100%;
      border-radius: 12px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      background: rgba(0,0,0,0.06);
      color: var(--vscode-foreground);
      font-size: 13px;
      text-align: left;
    }
    button:hover{ filter: brightness(1.06); }
    .primary{
      border-color: var(--ct-green-border);
      background: rgba(46,125,50,0.18);
    }
    .btnTitle{
      font-weight: 700;
      margin-bottom: 2px;
    }
    .btnDesc{
      font-size: 12px;
      opacity: 0.85;
      line-height: 1.25;
    }
    .hint{
      margin-top: 10px;
      font-size: 11px;
      opacity: 0.8;
    }
    .smallBtn{
      width: auto;
      padding: 6px 10px;
      border-radius: 10px;
      font-size: 12px;
      text-align: center;
    }

    .shortcutsBox{
      margin-top: 10px;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px;
      background: rgba(0,0,0,0.04);
      display: none;
    }

    .shortcutsBox.show{
      display: block;
    }

    .shortcutsTitle{
      font-weight: 700;
      margin-bottom: 6px;
    }

    .shortcutsLine{
      font-size: 12px;
      opacity: 0.9;
      line-height: 1.5;
    }
  </style>
</head>
<body>

  <div class="card hero">
    <div class="titleRow">
      <span class="dot"></span>
      <h2>CodeTime</h2>
    </div>
    <p class="sub">
      Pick a mode! Instructor builds lessons (walkthroughs, timeline, media, export).
      Student loads and plays them.
    </p>

    <div class="modeLine">
      Current mode:
      <span class="pill" id="modePill">${safeMode}</span>
    </div>
  </div>

  <div class="card">
    <div class="row">
      <button id="instructor" class="primary">
        <div class="btnTitle">Instructor Mode</div>
        <div class="btnDesc">Create walkthroughs, review commits, attach media, export lesson package.</div>
      </button>

      <button id="student">
        <div class="btnTitle">Student Mode</div>
        <div class="btnDesc">Load a lesson package and play through steps.</div>
      </button>
    </div>

  <div class="row" style="margin-top: 10px;">
    <button id="refreshMode" class="smallBtn">Refresh Mode</button>
    <button id="showShortcuts" class="smallBtn">⌨ Shortcuts</button>
  </div>

  <div id="shortcutsBox" class="shortcutsBox">
    <div class="shortcutsTitle">Keyboard Shortcuts</div>

    <div class="shortcutsLine"><b>Home</b></div>
    <div class="shortcutsLine">S → Student Mode</div>
    <div class="shortcutsLine">I → Instructor Mode</div>

    <div class="shortcutsLine" style="margin-top:8px;"><b>Student Mode</b></div>
    <div class="shortcutsLine">H → Home</div>
    <div class="shortcutsLine">A → Annotations</div>
    <div class="shortcutsLine">W → Walkthroughs</div>
    <div class="shortcutsLine">T → Timeline</div>
    <div class="shortcutsLine">J / K → Scrub timeline</div>

    <div class="shortcutsLine" style="margin-top:8px;"><b>Instructor Mode</b></div>
    <div class="shortcutsLine">H → Home</div>
    <div class="shortcutsLine">S → Student Mode</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function isTypingInInput(target) {
      if (!target) return false;

      const tag = (target.tagName || "").toLowerCase();
      return (
        target.isContentEditable ||
        tag === "input" ||
        tag === "textarea" ||
        tag === "select"
      );
    }

    document.getElementById("student").addEventListener("click", () => {
      vscode.postMessage({ type: "student" });
    });

    document.getElementById("instructor").addEventListener("click", () => {
      vscode.postMessage({ type: "instructor" });
    });

    document.getElementById("refreshMode").addEventListener("click", () => {
      vscode.postMessage({ type: "refreshMode" });
    });

    document.getElementById("showShortcuts").addEventListener("click", () => {
      const box = document.getElementById("shortcutsBox");
      if (box) box.classList.toggle("show");
    });

    window.addEventListener("message", (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "mode") {
        const pill = document.getElementById("modePill");
        if (pill) pill.textContent = msg.value || "none";
      }
    });

    window.addEventListener("keydown", (event) => {
      if (isTypingInInput(event.target)) return;

      const key = String(event.key || "").toLowerCase();

      if (key === "s") {
        event.preventDefault();
        vscode.postMessage({ type: "student" });
        return;
      }

      if (key === "i") {
        event.preventDefault();
        vscode.postMessage({ type: "instructor" });
        return;
      }
    });

  </script>
</body>
</html>`;
    };

    const postMode = async () => {
      const mode = this.context.globalState.get("codetime.mode") || "none";
      try {
        view.webview.postMessage({ type: "mode", value: mode });
      } catch {}
    };

    // initial render
    const initialMode = this.context.globalState.get("codetime.mode") || "none";
    render(initialMode);

    view.onDidChangeVisibility(async () => {
      if (!view.visible) return;

      const mode = this.context.globalState.get("codetime.mode") || "none";
      render(mode);
      await postMode();
    });
    
    view.webview.onDidReceiveMessage(async (msg) => {
      if (!msg?.type) return;

      if (msg.type === "student") {
        await vscode.commands.executeCommand("codetime.chooseStudent");
        await postMode();
        return;
      }

      if (msg.type === "instructor") {
        await vscode.commands.executeCommand("codetime.chooseInstructor");
        await postMode();
        return;
      }

      if (msg.type === "refreshMode") {
        await postMode();
      }
    });

    // allow extension.js to trigger refresh updates
    this._refresh = postMode;
  }
}

module.exports = HomeViewProvider;