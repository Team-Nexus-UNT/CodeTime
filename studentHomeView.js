// studentHomeView.js
const vscode = require("vscode");
const path = require("path");

const {
  importStudentLesson,
  listImportedStudentLessons,
  readJsonIfExists,
  ensureLessonRepo,
  deleteImportedStudentLesson,
} = require("./services/studentImportService");

const gitService = require("./services/gitService");
const { askLlm } = require("./services/llmService");

/**
 * Normalize a stored file path (often absolute from Instructor machine) into a
 * repo-relative POSIX path suitable for `git show <commit>:<path>`.
 */
function normalizeRelFilePath(fp, repoPath) {
  if (!fp) return null;
  let p = String(fp);

  // If a key or other compound value leaked in (repo::file), keep the file part
  if (p.includes("::")) p = p.split("::").pop();

  // Strip URI prefix if present
  if (p.startsWith("file://")) {
    try {
      p = vscode.Uri.parse(p).fsPath;
    } catch {}
  }

  // If it looks like "<something>:<path>" (NOT a Windows drive like "C:\"),
  // strip the "<something>:" prefix. This prevents `git show hash:repo:path`.
  if (p.includes(":")) {
    const isWindowsDrive = /^[A-Za-z]:[\\/]/.test(p);
    if (!isWindowsDrive) {
      const idx = p.indexOf(":");
      const after = p.slice(idx + 1);
      if (after.startsWith("/") || after.startsWith("\\") || after.startsWith(".")) {
        p = after;
      }
    }
  }

  // Convert to OS path first
  p = p.replace(/\\/g, "/");

  // If absolute, make it relative to repoPath if possible
  try {
    if (repoPath) {
      const repoName = path.basename(repoPath).replace(/\\/g, "/");
      const repoPathPosix = repoPath.replace(/\\/g, "/");

      if (p.startsWith(repoPathPosix + "/")) {
        p = p.slice((repoPathPosix + "/").length);
      } else {
        // If it contains the repo folder name, strip up to it
        const marker = `/${repoName}/`;
        const idx = p.toLowerCase().indexOf(marker.toLowerCase());
        if (idx >= 0) p = p.slice(idx + marker.length);
      }
    }
  } catch {}

  // Trim leading separators and "./"
  p = p.replace(/^\/+/, "");
  p = p.replace(/^\.\//, "");
  p = p.replace(/^\.\//, "");

  return p || null;
}

class StudentHomeViewProvider {
  static viewType = "codetime.studentHomeView";

  constructor(context) {
    this.context = context;
    this._view = null;

    this.state = {
      lessons: [],
      activeLessonId: null,

      // timeline
      repoPath: null,
      commits: [], // [{hash, author, date, message}]
      commitIndex: 0,

      // file selection
      files: [], // rel paths
      activeFile: null,

      // content tabs (for middle panel)
      activeTab: "timeline", // timeline | annotations | walkthroughs

      walkthroughs: [],
      annotations: [],

      // FR17: search fields
      walkthroughSearchTitle: "",
      walkthroughSearchKeyword: "",
    };
  }

  async resolveWebviewView(webviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      // allow loading media from global storage
      localResourceRoots: [this.context.extensionUri, this.context.globalStorageUri],
    };

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case "student.import": {
            const imported = await importStudentLesson(this.context);
            if (!imported) return;
            await this.refreshLessons(imported.id);
            vscode.window.showInformationMessage("Lesson imported for Student Mode.");
            break;
          }

          case "student.deleteLesson": {
            const lessonId = msg.lessonId || this.state.activeLessonId;
            if (!lessonId) return;
            const confirm = await vscode.window.showWarningMessage(
              `Remove imported lesson '${lessonId}'?`,
              { modal: true },
              "Remove"
            );
            if (confirm !== "Remove") return;

            const ok = await deleteImportedStudentLesson(this.context, lessonId);
            if (ok) {
              await this.refreshLessons();
              if (this.state.lessons.length) {
                this.state.activeLessonId = this.state.lessons[0].id;
                await this.loadLesson(this.state.activeLessonId);
              } else {
                this.state.activeLessonId = null;
                this.state.walkthroughs = [];
                this.state.annotations = [];
                this.state.repoPath = null;
                this.state.commits = [];
                this.state.files = [];
                this.state.activeFile = null;
                this.render();
              }
              vscode.window.showInformationMessage("Lesson removed.");
            }
            break;
          }

          case "student.setActiveLesson": {
            await this.loadLesson(msg.lessonId);
            break;
          }

          case "student.setTab": {
            this.state.activeTab = msg.tab;
            this.render();
            break;
          }

          // FR17: Search handler (title + keyword)
          case "student.walkthrough.search": {
            this.state.walkthroughSearchTitle = String(msg.title || "");
            this.state.walkthroughSearchKeyword = String(msg.keyword || "");
            this.render();
            break;
          }

          // FR17: Open/jump to a walkthrough step
          case "student.walkthrough.openStep": {
            const step = msg.step;
            if (!step) break;

            // 1) pick commit from step or fallback to current commit
            const stepCommit = step.commitHash || step.commit || step.sha || this.getCurrentCommit();

            // 2) move timeline slider to that commit (if it exists in commits list)
            if (stepCommit && Array.isArray(this.state.commits) && this.state.commits.length) {
              const idx = this.state.commits.findIndex((c) => c.hash === stepCommit);
              if (idx >= 0) this.state.commitIndex = idx;
            }

            // 3) choose the step file
            const fp = step.filePath || step.file || step.path;
            if (fp) {
              // Normalize to repo-relative path (instructor exports often store absolute paths)
              const rel = normalizeRelFilePath(fp, this.state.repoPath);
              this.state.activeFile = rel || fp;
            }

            // 4) re-render & open snapshot
            // If the step references a commit that isn't present in our filtered timeline,
            // open it directly anyway.
            const commitToOpen = stepCommit || this.getCurrentCommit();
            const fileToOpen = this.state.activeFile;

            this.render();

            if (this.state.repoPath && commitToOpen && fileToOpen) {
              const lesson = this.state.lessons.find((l) => l.id === this.state.activeLessonId);
              const key = `/student/${lesson?.id || "lesson"}/${commitToOpen}/${fileToOpen}`.replace(/\\/g, "/");
              await vscode.commands.executeCommand("codetime.student.openSnapshot", {
                userInitiated: true,
                repoPath: this.state.repoPath,
                commitHash: commitToOpen,
                fileRelPath: fileToOpen,
                key,
              });
            }

            // 5) jump to the line (if given)
            const ln =
              typeof step.line === "number"
                ? step.line
                : typeof step.lineNumber === "number"
                ? step.lineNumber
                : null;

            if (ln !== null) {
              const editor = vscode.window.activeTextEditor;
              if (editor) {
                // NOTE: if your export uses 1-based lines, change `ln` to `ln - 1`
                const pos = new vscode.Position(Math.max(0, ln), 0);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                editor.selection = new vscode.Selection(pos, pos);
              }
            }

            break;
          }

          case "student.setFile": {
            this.state.activeFile = msg.fileRelPath || null;
            if (this.state.commitIndex >= this.state.commits.length) this.state.commitIndex = 0;
            this.render();
            await this.openCurrentSnapshot(false);
            break;
          }

          case "student.setCommitIndex": {
            const idx = Number(msg.index);
            if (!Number.isFinite(idx)) return;
            this.state.commitIndex = Math.max(
              0,
              Math.min(idx, Math.max(0, this.state.commits.length - 1))
            );
            this.render();
            await this.openCurrentSnapshot(false);
            break;
          }

          case "student.openCurrent": {
            await this.openCurrentSnapshot();
            break;
          }

          case "student.openAnnotation": {
            await this.openAnnotationSnapshot(msg.annotationId);
            break;
          }

          case "student.backHome": {
            await vscode.commands.executeCommand("codetime.backToHome");
            break;
          }

          case "student.llm.ask": {
            try {
              const scope = {
                lessonId: this.state.activeLessonId,
                repoPath: this.state.repoPath,
                allowedFiles: this.state.files,
                commit: this.getCurrentCommit(),
                commitMeta: this.state.commits[this.state.commitIndex],
                activeFile: this.state.activeFile,
              };

              let fullText = "";
              let selectionObj = null;

              // Try active snapshot editor first
              const editor = vscode.window.activeTextEditor;
              if (editor && editor.document?.uri?.scheme === "codetime-playback") {
                fullText = editor.document.getText();

                if (editor.selection && !editor.selection.isEmpty) {
                  selectionObj = {
                    startLine: editor.selection.start.line + 1,
                    endLine: editor.selection.end.line + 1,
                    text: editor.document.getText(editor.selection),
                  };
                }
              }

              // Fallback: fetch snapshot directly from git
              if (!fullText) {
                const repoPath = this.state.repoPath;
                const commitHash = this.getCurrentCommit();
                const fileRelPath = this.state.activeFile;

                if (repoPath && commitHash && fileRelPath) {
                  const gitText = await gitService.getFileAtCommit(repoPath, commitHash, fileRelPath);
                  fullText = gitText || "";
                }
              }

              if (!fullText) {
                this._view.webview.postMessage({
                  type: "student.llm.error",
                  message: "Open the lesson snapshot first.",
                });
                break;
              }

              const editorContext = { fullText, selection: selectionObj };

              const hasSelection = !!editorContext.selection?.text?.trim();
              const hasQuestion = !!String(msg.question || "").trim();

              const questionText = String(msg.question || "").toLowerCase();

              const isCommitQuestion =
                questionText.includes("commit") ||
                questionText.includes("change") ||
                questionText.includes("why was this") ||
                questionText.includes("what changed");

              let mode;

              if (isCommitQuestion) {
                mode = "commit";
              } else if (hasSelection) {
                mode = hasQuestion ? "selection_qna" : "selection";
              } else if (hasQuestion) {
                mode = "ask";
              } else {
                mode = "explain_file";
              }

              let question;

              if (mode === "commit") {
                question = msg.question || "Explain what this commit does and why.";
              } else if (hasSelection) {
                question = hasQuestion ? msg.question : "Explain the selected lines.";
              } else if (hasQuestion) {
                question = msg.question;
              } else {
                question = "Explain the current file on screen.";
              }

              const text = await askLlm({
                mode,
                question,
                scope,
                editor: editorContext,
              });

              this._view.webview.postMessage({
                type: "student.llm.response",
                text,
              });
            } catch (err) {
              this._view.webview.postMessage({
                type: "student.llm.error",
                message: err.message,
              });
            }
            break;
          }

          case "student.llm.clear": {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
              const pos = editor.selection.active;
              editor.selection = new vscode.Selection(pos, pos);
            }
            break;
          }

          default:
            break;
        }
      } catch (err) {
        console.error(err);
        vscode.window.showErrorMessage(
          `Student Mode error: ${err && err.message ? err.message : String(err)}`
        );
      }
    });

    await this.refreshLessons();
    this.render();
  }

  async refreshLessons(selectLessonId = null) {
    this.state.lessons = await listImportedStudentLessons(this.context);

    if (selectLessonId) {
      this.state.activeLessonId = selectLessonId;
      await this.loadLesson(selectLessonId);
      return;
    }

    if (!this.state.activeLessonId && this.state.lessons.length > 0) {
      this.state.activeLessonId = this.state.lessons[0].id;
      await this.loadLesson(this.state.activeLessonId);
      return;
    }
  }

  async loadLesson(lessonId) {
    this.state.activeLessonId = lessonId;

    const lesson = this.state.lessons.find((l) => l.id === lessonId);
    if (!lesson) {
      this.state.walkthroughs = [];
      this.state.annotations = [];
      this.state.repoPath = null;
      this.state.commits = [];
      this.state.files = [];
      this.state.activeFile = null;
      this.render();
      return;
    }

    // Ensure the lesson repo exists (clone from repo.bundle -> .repo)
    const repoPath = await ensureLessonRepo(lesson.rootUri);
    this.state.repoPath = repoPath;

    // Load walkthroughs + annotations if present
    const walkthroughsJson = await readJsonIfExists(lesson.rootUri, "walkthroughs.json");
    const annotationsJson = await readJsonIfExists(lesson.rootUri, "annotations.json");
    const manifestJson = await readJsonIfExists(lesson.rootUri, "manifest.json");

    this.state.walkthroughs = normalizeWalkthroughs(walkthroughsJson);
    this.state.annotations = normalizeAnnotations(annotationsJson);

    // Normalize file paths to repo-relative
    this.state.walkthroughs = (this.state.walkthroughs || []).map((w) => {
      const steps = Array.isArray(w.steps)
        ? w.steps.map((st) => {
            const raw = st.filePath || st.file || st.path;
            const rel = normalizeRelFilePath(raw, repoPath);
            return { ...st, filePath: rel || raw };
          })
        : [];
      return { ...w, steps };
    });

    this.state.annotations = (this.state.annotations || []).map((a) => {
      const rel = normalizeRelFilePath(a.filePath, repoPath);
      return { ...a, filePath: rel || a.filePath };
    });

    // Commit timeline
    let commits = [];
    if (repoPath) {
      try {
        commits = await gitService.getCommitList(repoPath, 500);
      } catch (e) {
        console.error("CodeTime Student: failed to load commit list", e);
      }
    }

    const referenced = Array.isArray(manifestJson?.referencedCommits) ? manifestJson.referencedCommits : [];
    if (referenced.length && commits.length) {
      const set = new Set(referenced);
      const referencedInRepo = commits.filter((c) => set.has(c.hash));
      if (referencedInRepo.length >= 5 || referencedInRepo.length === commits.length) {
        commits = referencedInRepo;
      }
    }

    // Student timeline should play forward in time (oldest -> newest)
    // git log returns newest-first, so reverse it.
    if (commits && commits.length) commits = commits.slice().reverse();

    this.state.commits = commits;

    // Build file list from walkthrough steps + annotations
    const fileSet = new Set();
    for (const w of this.state.walkthroughs) {
      for (const s of w.steps || []) {
        const fp = s.filePath || s.file || s.path;
        if (fp) fileSet.add(fp);
      }
    }
    for (const a of this.state.annotations) {
      if (a.filePath) fileSet.add(a.filePath);
    }

    this.state.files = Array.from(fileSet).sort((a, b) => a.localeCompare(b));

    if (!this.state.activeFile && this.state.files.length) {
      this.state.activeFile = this.state.files[0];
    }

    this.state.commitIndex = 0;

    this.render();

    // auto open
    await this.openCurrentSnapshot();
  }

  getCurrentCommit() {
    const c = this.state.commits[this.state.commitIndex];
    return c?.hash || null;
  }

  async openCurrentSnapshot(userInitiated = false) {
    const lesson = this.state.lessons.find((l) => l.id === this.state.activeLessonId);
    if (!lesson) return;

    const repoPath = this.state.repoPath;
    const commitHash = this.getCurrentCommit();
    const fileRelPath = this.state.activeFile;

    if (!repoPath || !commitHash || !fileRelPath) return;

    const key = `/student/${lesson.id}/${commitHash}/${fileRelPath}`.replace(/\\/g, "/");
    await vscode.commands.executeCommand("codetime.student.openSnapshot", {
      userInitiated,
      repoPath,
      commitHash,
      fileRelPath,
      key,
    });
  }

  async openAnnotationSnapshot(annotationId) {
    const a = this.state.annotations.find((x) => x.id === annotationId);
    if (!a) return;

    if (a.filePath) this.state.activeFile = a.filePath;

    const commitHash = a.commit || a.commitHash || a.sha || this.getCurrentCommit();
    const repoPath = this.state.repoPath;
    const lesson = this.state.lessons.find((l) => l.id === this.state.activeLessonId);
    if (!lesson || !repoPath || !commitHash || !a.filePath) return;

    const key = `/student/${lesson.id}/${commitHash}/${a.filePath}`.replace(/\\/g, "/");
    await vscode.commands.executeCommand("codetime.student.openSnapshot", {
      repoPath,
      commitHash,
      fileRelPath: a.filePath,
      key,
    });

    if (typeof a.line === "number" && a.line >= 0) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const pos = new vscode.Position(a.line, 0);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(pos, pos);
      }
    }

    this.render();
  }

  render() {
    if (!this._view) return;
    this._view.webview.html = this.getHtml(this._view.webview);
  }

  getHtml(webview) {
    const nonce = getNonce();

    const lessons = this.state.lessons.map((l) => ({
      id: l.id,
      title:
        (l.manifest && (l.manifest.lessonTitle || l.manifest.title || l.manifest.name)) || l.id,
      rootUri: l.rootUri,
    }));

    const activeLessonId = this.state.activeLessonId;
    const activeTab = this.state.activeTab;

    const files = this.state.files;
    const activeFile = this.state.activeFile;

    const commits = this.state.commits;
    const commitIndex = this.state.commitIndex;
    const currentCommit = this.getCurrentCommit();

    const lesson = this.state.lessons.find((l) => l.id === activeLessonId);
    const mediaItems = collectMediaForCommit(this.state.walkthroughs, currentCommit).map((m) => {
      try {
        if (!lesson || !m.packagePath) return { ...m, webviewUri: null };
        const abs = vscode.Uri.joinPath(lesson.rootUri, ...m.packagePath.split("/"));
        const wuri = webview.asWebviewUri(abs).toString();
        return { ...m, webviewUri: wuri };
      } catch {
        return { ...m, webviewUri: null };
      }
    });

    const titleValue = this.state.walkthroughSearchTitle || "";
    const keywordValue = this.state.walkthroughSearchKeyword || "";

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} https: data:; media-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CodeTime Student</title>
  <style>
    :root {
      --ct-green: #2e7d32;
      --ct-green-soft: rgba(46,125,50,0.16);
      --ct-green-border: rgba(46,125,50,0.55);
    }

    body {
      font-family: var(--vscode-font-family);
      padding: 10px;
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }

    .wrap {
      display: grid;
      grid-template-columns: 280px 1fr 340px;
      height: 100vh;
    }

    .left, .mid, .right {
      padding: 10px;
      overflow: auto;
    }

    .left {
      border-right: 1px solid var(--vscode-editorWidget-border);
    }

    .mid {
      border-right: 1px solid var(--vscode-editorWidget-border);
    }

    .header {
      background: var(--ct-green-soft);
      border: 1px solid var(--ct-green-border);
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 12px;
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--ct-green);
      box-shadow: 0 0 0 4px var(--ct-green-soft);
    }

    .header-sub {
      opacity: 0.75;
      font-size: 12px;
      margin-top: 6px;
      line-height: 1.4;
    }

  .card,
  .panel {
    border: 1px solid var(--vscode-editorWidget-border);
    background: transparent;
    border-radius: 10px;
    padding: 12px;
    margin-bottom: 12px;
  }

    .row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .stack,
    .stack8 {
      display: grid;
      gap: 8px;
    }

    .section-title,
    .h,
    .cardTitle {
      font-weight: 700;
    }

    .section-title {
      margin-bottom: 8px;
    }

    .h {
      margin-bottom: 6px;
    }

    .label {
      font-size: 12px;
      opacity: 0.8;
      margin-bottom: 4px;
    }

    .muted,
    .subtle {
      opacity: 0.75;
      font-size: 12px;
      line-height: 1.4;
    }

    .muted {
      margin-top: 6px;
    }

    .field,
    .mt10 {
      margin-top: 10px;
    }

    .mt8 {
      margin-top: 8px;
    }

    button,
    .btn,
    .smallbtn {
      cursor: pointer;
      border-radius: 8px;
      padding: 6px 10px;
      border: 1px solid var(--vscode-editorWidget-border);
      background: var(--vscode-button-secondaryBackground, rgba(0,0,0,0.10));
      color: var(--vscode-foreground);
      font-family: inherit;
      font-size: 12px;
    }

    button:hover,
    .btn:hover,
    .smallbtn:hover {
      filter: brightness(1.06);
    }

    button.primary,
    .btn.secondary {
      border-color: var(--ct-green-border);
      background: var(--ct-green-soft);
    }

    button.danger {
      border-color: rgba(255,82,82,0.35);
      background: rgba(255,82,82,0.10);
    }
    
    button.remove {
      opacity: 0.8;
    }

    button.remove:hover {
      opacity: 1;
    }

    select,
    input[type="text"],
    textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      margin-top: 4px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 6px;
      font-size: 12px;
      font-family: inherit;
    }

    textarea {
      resize: vertical;
      min-height: 120px;
    }

    .tabs {
      display: grid;
      gap: 8px;
      margin-bottom: 10px;
    }

    .tab {
      cursor: pointer;
      border-radius: 10px;
      padding: 6px 10px;
      border: 1px solid var(--vscode-editorWidget-border);
      background: rgba(0,0,0,0.06);
      font-size: 12px;
      width: 100%;
      box-sizing: border-box;
      color: var(--vscode-foreground);
      text-align: left;
      font-family: inherit;
    }


    .tab.active {
      border-color: var(--ct-green-border);
      background: var(--ct-green-soft);
    }

    .scrubberRow {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 6px 0 0;
    }

    .range {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.10);
      border: 1px solid var(--vscode-editorWidget-border);
      outline: none;
    }

    .range::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 999px;
      background: var(--ct-green);
      border: 2px solid rgba(0,0,0,0.35);
      box-shadow: 0 0 0 4px var(--ct-green-soft);
      cursor: pointer;
    }

    .commitCard,
    .mediaItem,
    .annItem,
    .stepDetail,
    .emptyState {
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 10px;
      background: rgba(0,0,0,0.02);
      padding: 10px;
      margin-top: 10px;
    }

    .commitMeta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .commitLine {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      opacity: 0.9;
    }

    .mediaItem .t,
    .annItem .t {
      font-weight: 700;
      margin-bottom: 4px;
    }

    .steps {
      margin: 8px 0 0 18px;
      padding: 0;
    }

    .steps li {
      margin: 8px 0;
    }

    .smallbtn {
      margin-top: 8px;
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="left">
      <div class="header">
        <div class="header-title"><span class="dot"></span><div>Student Dashboard</div></div>
        <div class="header-sub">Load an instructor lesson, replay commits, and review walkthrough steps.</div>
      </div>

      <div class="card">
        <div class="section-title">Lesson</div>
        <div class="stack">
          <button class="primary" id="importBtn">Import Lesson</button>
          <button id="homeBtn">Back to Home</button>
        </div>

        <div class="field">
          <div class="label">Imported Lesson</div>
          <select id="lessonSelect">
            ${lessons.length
              ? lessons
                  .map(
                    (l) =>
                      `<option value="${escapeHtml(l.id)}" ${l.id === activeLessonId ? "selected" : ""}>${escapeHtml(l.title)}</option>`
                  )
                  .join("")
              : `<option value="">(no lessons imported)</option>`}
          </select>
        </div>

        <div class="field">
          <button class="remove" id="removeLessonBtn">Remove Lesson</button>
        </div>
      </div>

      <div class="card">
        <div class="section-title">Playback</div>

        <div>
          <div class="label">File</div>
          <select id="fileSelect">
            ${(files && files.length
              ? files
                  .map(
                    (f) =>
                      `<option value="${escapeHtml(f)}" ${f === activeFile ? "selected" : ""}>${escapeHtml(f)}</option>`
                  )
                  .join("")
              : `<option value="">(no files found)</option>`)}
          </select>
        </div>

        <div class="field">
          <div class="label">Timeline</div>
          <div class="muted">${commits.length ? `Commit ${commitIndex + 1} of ${commits.length}` : "No commits loaded"}</div>
          <div class="scrubberRow">
            <button id="commitPrev">Prev</button>
            <input id="commitSlider" class="range" type="range" min="0" max="${Math.max(0, commits.length - 1)}" value="${Math.min(commitIndex, Math.max(0, commits.length - 1))}" ${commits.length ? "" : "disabled"} />
            <button id="commitNext">Next</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="section-title">Learning Tools</div>
        <div class="tabs">
          <button type="button" class="tab ${activeTab === "timeline" ? "active" : ""}" data-tab="timeline">Commit Playback</button>
          <button type="button" class="tab ${activeTab === "annotations" ? "active" : ""}" data-tab="annotations">Annotations</button>
          <button type="button" class="tab ${activeTab === "walkthroughs" ? "active" : ""}" data-tab="walkthroughs">Walkthroughs</button>
        </div>
        <div class="muted">Student Mode is read-only.</div>
      </div>
    </div>

    <div class="mid">
      ${
        activeTab === "timeline"
          ? `
            <div class="panel">
              <div class="h">Commit Playback</div>
              <div class="subtle">Open the selected file at the current point in the lesson timeline.</div>

              <div class="commitCard">
                ${renderCommitMeta(commits, commitIndex)}
              </div>

              <div class="mt10">
                <button class="btn secondary" id="openBtn">Open code (read-only)</button>
                <div class="muted mt8">Opens the selected file at the selected commit.</div>
              </div>
            </div>

            <div class="panel">
              <div class="h">Media for This Commit</div>
              <div class="subtle">Audio and video attached to the currently selected commit.</div>
              ${
                mediaItems.length
                  ? mediaItems.map((m) => renderMediaItem(m)).join("")
                  : `<div class="emptyState">No media is attached to this commit yet.</div>`
              }
            </div>
          `
          : activeTab === "annotations"
          ? `
            <div class="panel">
              <div class="h">Annotations</div>
              <div class="subtle">Review lesson annotations linked to files and lines.</div>
              ${renderAnnotations(this.state.annotations)}
            </div>
          `
          : `
            <div class="panel">
              <div class="h">Walkthroughs</div>
              <div class="subtle">Browse walkthroughs for the current commit and jump directly to steps.</div>

              <div class="field">
                <div class="label">Search by title</div>
                <input id="walkthroughSearchTitle" type="text"
                  placeholder="Search by title..."
                  value="${escapeHtml(titleValue)}" />
              </div>

              <div class="field">
                <div class="label">Search by keyword</div>
                <input id="walkthroughSearchKeyword" type="text"
                  placeholder="Search steps, descriptions, or file names..."
                  value="${escapeHtml(keywordValue)}" />
              </div>

              <div id="stepDetail" class="stepDetail" style="display:none;"></div>

              <div id="walkthroughList">
                ${renderWalkthroughsForCommit(
                  this.state.walkthroughs,
                  commits?.[commitIndex]?.hash,
                  titleValue,
                  keywordValue
                )}
              </div>
            </div>
          `
      }
    </div>

    <div class="right">
      <div class="panel">
        <div class="h">LLM Assistant</div>
        <div class="subtle">Ask about the current file, selected lines, or the selected commit.</div>

        <div class="field">
          <div class="label">Question</div>
          <input id="llmPrompt" type="text" placeholder="Ask about the current code..." />
        </div>

        <div class="field">
          <div class="label">Response</div>
          <textarea id="llmOutput" readonly>Response will appear here…</textarea>
        </div>

        <div class="stack8 mt10">
          <button class="btn secondary" id="llmAskBtn">Ask</button>
          <button class="btn secondary" id="llmClearBtn">Refresh</button>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.getElementById("importBtn").addEventListener("click", () => vscode.postMessage({ type: "student.import" }));
    document.getElementById("homeBtn").addEventListener("click", () => vscode.postMessage({ type: "student.backHome" }));

    const removeBtn = document.getElementById("removeLessonBtn");
    if (removeBtn) removeBtn.addEventListener("click", () => {
      const lessonId = (document.getElementById("lessonSelect") || {}).value;
      vscode.postMessage({ type: "student.deleteLesson", lessonId });
    });

    const lessonSelect = document.getElementById("lessonSelect");
    if (lessonSelect) lessonSelect.addEventListener("change", (e) => {
      vscode.postMessage({ type: "student.setActiveLesson", lessonId: e.target.value });
    });

    const fileSelect = document.getElementById("fileSelect");
    if (fileSelect) fileSelect.addEventListener("change", (e) => {
      vscode.postMessage({ type: "student.setFile", fileRelPath: e.target.value });
    });

    const slider = document.getElementById("commitSlider");
    if (slider) slider.addEventListener("input", (e) => {
      vscode.postMessage({ type: "student.setCommitIndex", index: e.target.value });
    });

    const prevBtn = document.getElementById("commitPrev");
    const nextBtn = document.getElementById("commitNext");
    if (prevBtn && slider) prevBtn.addEventListener("click", () => {
      const v = Math.max(0, Number(slider.value) - 1);
      slider.value = String(v);
      slider.dispatchEvent(new Event("input"));
    });
    if (nextBtn && slider) nextBtn.addEventListener("click", () => {
      const v = Math.min(Number(slider.max), Number(slider.value) + 1);
      slider.value = String(v);
      slider.dispatchEvent(new Event("input"));
    });

    for (const btn of document.querySelectorAll(".tab")) {
      btn.addEventListener("click", () => vscode.postMessage({ type: "student.setTab", tab: btn.dataset.tab }));
    }

    const openBtn = document.getElementById("openBtn");
    if (openBtn) openBtn.addEventListener("click", () => vscode.postMessage({ type: "student.openCurrent" }));

    for (const btn of document.querySelectorAll("[data-open-annotation='1']")) {
      btn.addEventListener("click", () => {
        vscode.postMessage({ type: "student.openAnnotation", annotationId: btn.dataset.annotationId });
      });
    });

    const wtTitle = document.getElementById("walkthroughSearchTitle");
    const wtKeyword = document.getElementById("walkthroughSearchKeyword");
    const stepDetailEl = document.getElementById("stepDetail");

    function escapeHtml(s) {
      return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function getFocusableState() {
      const active = document.activeElement;
      const focusId = active && active.id ? active.id : null;
      let selStart = null;
      let selEnd = null;
      try {
        if (active && typeof active.selectionStart === "number") {
          selStart = active.selectionStart;
          selEnd = active.selectionEnd;
        }
      } catch {}
      return { focusId, selStart, selEnd };
    }

    function renderStepDetail(step) {
      if (!stepDetailEl) return;
      if (!step) {
        stepDetailEl.style.display = "none";
        stepDetailEl.innerHTML = "";
        return;
      }

      const text = (step.text || step.note || step.label || step.title || step.description || "").toString();
      const fp = (step.filePath || step.file || step.path || "").toString();
      const ln = (typeof step.line === "number" ? step.line : (typeof step.lineNumber === "number" ? step.lineNumber : null));
      const sha = (step.commitHash || step.commit || step.sha || "").toString();

      const meta = [
        fp,
        ln !== null ? ("L" + ln) : "",
        sha ? ("commit " + sha.slice(0, 8)) : "",
      ].filter(Boolean).join(" · ");

      stepDetailEl.style.display = "block";
      stepDetailEl.innerHTML =
        '<div style="font-weight:800;margin-bottom:4px;">Selected step</div>' +
        (text
          ? ('<div style="margin-bottom:6px;">' + escapeHtml(text) + '</div>')
          : '<div class="muted" style="margin-bottom:6px;">(no step text)</div>') +
        (meta ? ('<div class="muted">' + escapeHtml(meta) + '</div>') : "");
    }

    try {
      const st = vscode.getState() || {};
      if (st.selectedStep) renderStepDetail(st.selectedStep);
      if (st.focusId) {
        const el = document.getElementById(st.focusId);
        if (el) {
          el.focus();
          if (typeof st.selStart === "number") {
            el.setSelectionRange(st.selStart, typeof st.selEnd === "number" ? st.selEnd : st.selStart);
          }
        }
      }
    } catch {}

    let wtTimer = null;

    function sendWalkthroughSearchDebounced() {
      if (wtTimer) clearTimeout(wtTimer);

      try {
        const prev = vscode.getState() || {};
        const { focusId, selStart, selEnd } = getFocusableState();
        vscode.setState({
          ...prev,
          walkthroughSearchTitle: wtTitle ? wtTitle.value : "",
          walkthroughSearchKeyword: wtKeyword ? wtKeyword.value : "",
          selectedStep: prev.selectedStep || null,
          focusId,
          selStart,
          selEnd,
        });
      } catch {}

      wtTimer = setTimeout(() => {
        vscode.postMessage({
          type: "student.walkthrough.search",
          title: wtTitle ? wtTitle.value : "",
          keyword: wtKeyword ? wtKeyword.value : "",
        });
      }, 250);
    }

    if (wtTitle) wtTitle.addEventListener("input", sendWalkthroughSearchDebounced);
    if (wtKeyword) wtKeyword.addEventListener("input", sendWalkthroughSearchDebounced);

    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".wtOpenStep");
      if (!btn) return;

      try {
        const raw = btn.getAttribute("data-step");
        const step = JSON.parse(raw);

        renderStepDetail(step);
        try {
          const prev = vscode.getState() || {};
          const { focusId, selStart, selEnd } = getFocusableState();
          vscode.setState({
            ...prev,
            selectedStep: step,
            focusId,
            selStart,
            selEnd,
          });
        } catch {}

        vscode.postMessage({ type: "student.walkthrough.openStep", step });
      } catch (err) {
        console.error(err);
      }
    });

    const askBtn = document.getElementById("llmAskBtn");
    const promptEl = document.getElementById("llmPrompt");
    const outputEl = document.getElementById("llmOutput");

    if (askBtn) {
      askBtn.addEventListener("click", () => {
        const question = (promptEl?.value || "").trim();
        outputEl.value = question ? "Thinking..." : "Analyzing selection...";
        vscode.postMessage({ type: "student.llm.ask", question });
      });
    }

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === "student.llm.response") outputEl.value = msg.text || "";
      if (msg.type === "student.llm.error") outputEl.value = "Error: " + (msg.message || "Unknown error");
    });

    const clearBtn = document.getElementById("llmClearBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (promptEl) promptEl.value = "";
        if (outputEl) outputEl.value = "Response will appear here…";
        vscode.postMessage({ type: "student.llm.clear" });
      });
    }
  </script>
</body>
</html>`;

    function renderCommitMeta(commits, idx) {
      if (!commits || commits.length === 0) {
        return `<div class="muted">No commit data loaded. Export should include repo.bundle and referenced commits.</div>`;
      }
      const c = commits[Math.min(idx, commits.length - 1)];
      return `
        <div class="commitMeta">
          <div class="commitLine"><b>${escapeHtml((c.hash || "").slice(0, 8))}</b> — ${escapeHtml(c.message || "")}</div>
          <div class="muted">${escapeHtml(c.author || "")}</div>
        </div>
        <div class="muted" style="margin-top:4px;">${escapeHtml(c.date || "")}</div>
      `;
    }

    function renderMediaItem(m) {
      const title = escapeHtml(m.title || m.type || "Media");
      const meta = escapeHtml(m.commitHash || "");
      const uri = m.webviewUri ? String(m.webviewUri) : "";
      if (!uri) {
        return `<div class="mediaItem"><div class="t">${title}</div><div class="muted">Missing media file.</div></div>`;
      }
      const lower = (m.type || "").toLowerCase();
      const isAudio = lower.includes("audio");
      const isVideo = lower.includes("video");
      return `
        <div class="mediaItem">
          <div class="t">${title}</div>
          <div class="muted">${meta}</div>
          ${isVideo ? `<video controls style="width:100%; margin-top:8px; border-radius:10px;"><source src="${uri}"></video>` : ""}
          ${isAudio ? `<audio controls style="width:100%; margin-top:8px;"><source src="${uri}"></audio>` : ""}
          ${!isAudio && !isVideo ? `<a href="${uri}">Open media</a>` : ""}
        </div>
      `;
    }

    function walkthroughsForCommit(walkthroughs, commitHash) {
      if (!commitHash) return [];
      const out = [];
      for (const w of walkthroughs || []) {
        const wCommit = w.commitHash || w.commit || w.sha;
        if (wCommit && wCommit === commitHash) {
          out.push(w);
          continue;
        }

        const steps = Array.isArray(w.steps) ? w.steps : [];
        if (steps.some((s) => (s.commitHash || s.commit || s.sha) === commitHash)) {
          out.push(w);
          continue;
        }
      }
      return out;
    }

    function renderWalkthroughsForCommit(walkthroughs, commitHash, titleTerm, keywordTerm) {
      const list = walkthroughsForCommit(walkthroughs, commitHash);
      if (!commitHash) return `<div class="emptyState">No commits loaded yet.</div>`;

      const t = (titleTerm || "").trim().toLowerCase();
      const k = (keywordTerm || "").trim().toLowerCase();

      const filtered = list.filter((w) => {
        const title = String(w.title || "").toLowerCase();
        const desc = String(w.description || "").toLowerCase();

        if (t && !title.includes(t)) return false;

        if (k) {
          const steps = Array.isArray(w.steps) ? w.steps : [];
          const stepBlob = steps
            .map((s) =>
              [
                s.text || s.title || s.description || "",
                s.filePath || s.file || s.path || "",
              ].join(" ")
            )
            .join(" ")
            .toLowerCase();

          const blob = [title, desc, stepBlob].join(" ").toLowerCase();
          if (!blob.includes(k)) return false;
        }

        return true;
      });

      if (!filtered.length) {
        if (t || k) {
          const what =
            t && k
              ? `title="${escapeHtml(titleTerm)}", keyword="${escapeHtml(keywordTerm)}"`
              : t
              ? `title="${escapeHtml(titleTerm)}"`
              : `keyword="${escapeHtml(keywordTerm)}"`;

          return `<div class="emptyState">No walkthrough matches (${what}) for this commit.</div>`;
        }
        return `<div class="emptyState">No walkthrough is available for this commit.</div>`;
      }

      return filtered
        .map((w) => {
          const title = escapeHtml(w.title || "Walkthrough");
          const desc = escapeHtml(w.description || "");
          const steps = Array.isArray(w.steps) ? w.steps : [];

          const stepsHtml = steps.length
            ? `<ol class="steps">` +
              steps
                .map((s) => {
                  const st = escapeHtml(s.text || s.title || s.description || "");
                  const fp = escapeHtml(s.filePath || "");
                  const ln =
                    typeof s.line === "number"
                      ? s.line
                      : typeof s.lineNumber === "number"
                      ? s.lineNumber
                      : null;

                  const meta = [fp, ln !== null ? `L${ln}` : ""].filter(Boolean).join(" · ");

                  const stepJson = escapeHtml(JSON.stringify(s));

                  return `<li style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                    <div style="flex:1;">
                      <div>${st || "<span class='muted'>(step)</span>"}</div>
                      ${meta ? `<div class="muted">${meta}</div>` : ""}
                    </div>
                    <button class="smallbtn wtOpenStep" data-step="${stepJson}">Open step</button>
                  </li>`;
                })
                .join("") +
              `</ol>`
            : `<div class="muted">No steps for this walkthrough.</div>`;

          return `<div class="card">
                    <div class="cardTitle">${title}</div>
                    ${desc ? `<div class="muted" style="margin-top:4px;">${desc}</div>` : ""}
                    <div style="margin-top:8px;">${stepsHtml}</div>
                  </div>`;
        })
        .join("");
    }

    function renderAnnotations(annotations) {
      if (!annotations || annotations.length === 0) {
        return `<div class="emptyState">No annotations were found in this lesson export.</div>`;
      }
      return annotations
        .map(
          (a) => `
        <div class="annItem">
          <div class="t">${escapeHtml(a.title || a.id)}</div>
          <div class="muted"><code>${escapeHtml(a.filePath || "")}</code> : ${escapeHtml(String(a.line ?? ""))}</div>
          <div class="muted" style="margin-top:6px;">${escapeHtml(a.preview || "")}</div>
          <button class="smallbtn" data-open-annotation="1" data-annotation-id="${escapeHtml(a.id)}">Open (read-only)</button>
        </div>
      `
        )
        .join("");
    }

    function escapeHtml(s) {
      return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }
  }
}

function normalizeWalkthroughs(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(fixWalkthrough);
  if (raw.walkthroughs && Array.isArray(raw.walkthroughs)) return raw.walkthroughs.map(fixWalkthrough);
  return [];
}

function fixWalkthrough(w) {
  return {
    id: String(w.id || w.walkthroughId || w.title || w.name || Math.random().toString(36).slice(2)),
    // Instructor mode uses `name`; keep `title` as our display field.
    title: w.title || w.name || w.walkthroughName || "Walkthrough",
    description: w.description || "",
    steps: Array.isArray(w.steps) ? w.steps.map((s) => ({ ...s })) : [],
    media: Array.isArray(w.media) ? w.media.map((m) => ({ ...m })) : [],
  };
}

function normalizeAnnotations(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(fixAnnotation);
  if (raw.annotations && Array.isArray(raw.annotations)) return raw.annotations.map(fixAnnotation);
  return [];
}

function fixAnnotation(a) {
  const text = a.text || a.body || a.content || "";
  return {
    id: String(a.id || a.annotationId || Math.random().toString(36).slice(2)),
    title: a.title || "Annotation",
    filePath: a.filePath || a.file || a.path || "",
    line: typeof a.line === "number" ? a.line : typeof a.lineNumber === "number" ? a.lineNumber : null,
    commit: a.commit || a.commitHash || a.sha || null,
    preview: String(text).slice(0, 140),
  };
}

function collectMediaForCommit(walkthroughs, commitHash) {
  if (!commitHash) return [];
  const out = [];
  for (const w of walkthroughs || []) {
    for (const m of w.media || []) {
      if ((m.commitHash || m.commit || m.sha) === commitHash && m.packagePath) {
        out.push(m);
      }
    }
  }
  return out;
}

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}

module.exports = { StudentHomeViewProvider };