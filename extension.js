// extension.js — CodeTime: Audio/Video Upload + Annotations (modular)
const vscode = require('vscode');

// Views
const { registerWalkthroughView } = require('./walkthroughView');
const { registerTimelineView } = require('./timelineView');
const { registerInstructorMode } = require('./instructorModeView');
const { PlaybackProvider } = require('./services/playbackProvider');
const HomeViewProvider = require('./homeView');
const InstructorDashboardViewProvider = require('./instructorDashboardView');
const StudentHomeViewProvider = require('./studentHomeView');

// Feature modules
const { uploadAudioCommand } = require('./audioStorage');
const { uploadVideoCommand } = require('./videoStorage');
const {
  registerAnnotationSupport,
  refreshAnnotations,
  disposeAnnotations
} = require('./annotations');

// Git integration (Sprint 4)
const gitService = require('./services/gitService');
const {
  initCommitSnapshots,
  showDiffForCommit,
  showFileAtCommit
} = require('./services/commitDiffController');

// Walkthrough storage/actions
const walkthroughStorage = require('./walkthroughStorage');
const path = require('path');
const { exportWalkthroughPackage } = require('./services/exportService');


/* ============================================================================
   ACTIVATE
============================================================================ */
async function activate(context) {
  // Ensure extension storage exists
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  // initialize commit snapshot provider
  initCommitSnapshots(context, gitService);


// sprint 5
const setMode = async (mode) => {
  await context.globalState.update("codetime.mode", mode);
  await vscode.commands.executeCommand("setContext", "codetime.mode", mode);
};

await setMode("none");

context.subscriptions.push(
  vscode.commands.registerCommand("codetime.chooseInstructor", async () => {
    await setMode("instructor");
    await vscode.commands.executeCommand("workbench.view.extension.codetimeInstructor");
    try { await vscode.commands.executeCommand("codetime.instructor.dashboard.focus"); } catch {}
  })
);

context.subscriptions.push(
  vscode.commands.registerCommand("codetime.chooseStudent", async () => {
    await setMode("student");
    await vscode.commands.executeCommand("workbench.view.extension.codetimeStudent");
    try { await vscode.commands.executeCommand("codetime.student.home.focus"); } catch {}
  })
);

context.subscriptions.push(
  vscode.commands.registerCommand("codetime.backToHome", async () => {
    await setMode("none");
    await vscode.commands.executeCommand("workbench.view.extension.codetimeHome");
    try { await vscode.commands.executeCommand("codetime.homeView.focus"); } catch {}
  })
);


  /* ------------------------------------------------------------------------
     Playback Provider 
  ------------------------------------------------------------------------ */
  const playbackProvider = new PlaybackProvider();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      'codetime-playback',
      playbackProvider
    )
  );

  //Home View
  context.subscriptions.push(
  vscode.window.registerWebviewViewProvider(
    'codetime.homeView',
    new HomeViewProvider(context)
  )
);

  //Instructor View
context.subscriptions.push(
  vscode.window.registerWebviewViewProvider(
    'codetime.instructor.dashboard',
    new InstructorDashboardViewProvider(context, gitService)
  )
);

  //Student View
context.subscriptions.push(
  vscode.window.registerWebviewViewProvider(
    'codetime.student.home',
    new StudentHomeViewProvider(context)
  )
);


  /* ------------------------------------------------------------------------
     Views
  ------------------------------------------------------------------------ */
  // registerTimelineView(context, gitService);
  //await registerInstructorMode(context);
  //registerWalkthroughView(context);

  // legacy views disabled (now consolidated into dashboard shell)

  /* ------------------------------------------------------------------------
     Smoke test
  ------------------------------------------------------------------------ */
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.test', () => {
      vscode.window.showInformationMessage('CodeTime activated ✔');
    })
  );



/* ------------------------------------------------------------------------
   Walkthrough commands
------------------------------------------------------------------------ */
context.subscriptions.push(
  vscode.commands.registerCommand('codetime.addWalkthroughStep', async (walkthroughId) => {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('CodeTime: Open a file to capture a walkthrough step.');
        return null;
      }

      const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const fileAbs = editor.document.uri.fsPath;
      const fileRel = repoPath ? path.relative(repoPath, fileAbs) : editor.document.fileName;
      const line = editor.selection.active.line + 1; // 1-based for humans

      // Prefer commit chosen in Timeline; fallback to HEAD
      let commitHash = globalThis._codetimeCurrentCommitHash;
      if (!commitHash && repoPath) {
        const head = await gitService.runGit(repoPath, ['rev-parse', 'HEAD']);
        commitHash = (head || '').trim();
      }

      const label = await vscode.window.showInputBox({
        prompt: 'Step title (optional)',
        placeHolder: `Example: Explain ${path.basename(fileRel)}`
      });

      const note = await vscode.window.showInputBox({
        prompt: 'Step note (optional)',
        placeHolder: 'What should the student notice here?'
      });

      const updated = walkthroughStorage.addStepToWalkthrough(walkthroughId, {
        label: label || `Step @ ${fileRel}:${line}`,
        file: fileRel,
        line,
        commitHash: commitHash || '',
        note: note || ''
      });

      if (!updated) {
        vscode.window.showErrorMessage('CodeTime: Walkthrough not found.');
        return null;
      }

      vscode.window.showInformationMessage('CodeTime: Added walkthrough step ✔');
      return updated;
    } catch (err) {
      console.error('codetime.addWalkthroughStep error:', err);
      vscode.window.showErrorMessage('CodeTime: Failed to add walkthrough step. Check Dev Tools console.');
      return null;
    }
  })
);

context.subscriptions.push(
  vscode.commands.registerCommand('codetime.playWalkthrough', async (walkthroughId) => {
    try {
      const wt = walkthroughStorage.getWalkthroughById(walkthroughId);
      if (!wt) {
        vscode.window.showErrorMessage('CodeTime: Walkthrough not found.');
        return;
      }
      if (!Array.isArray(wt.steps) || wt.steps.length === 0) {
        vscode.window.showInformationMessage('CodeTime: This walkthrough has no steps yet.');
        return;
      }

      const picked = await vscode.window.showQuickPick(
        wt.steps.map((s, idx) => ({
          label: `${idx + 1}. ${s.label || 'Untitled Step'}`,
          description: s.commitHash ? `commit ${String(s.commitHash).slice(0, 8)}` : '',
          detail: s.file ? `${s.file}${s.line ? `:${s.line}` : ''}` : '',
          step: s
        })),
        { placeHolder: 'Choose a step to play' }
      );

      if (!picked) return;
      const step = picked.step;

      if (step.commitHash) {
        globalThis._codetimeCurrentCommitHash = step.commitHash;
        // Open the file snapshot at commit, if we can
        await vscode.commands.executeCommand('codetime.showFileAtCommit', step.commitHash, step.file);
      } else if (step.file) {
        const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const uri = repoPath
          ? vscode.Uri.file(path.join(repoPath, step.file))
          : vscode.Uri.file(step.file);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      }

      // Reveal the line if available
      const editor = vscode.window.activeTextEditor;
      if (editor && step.line) {
        const pos = new vscode.Position(Math.max(0, step.line - 1), 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }

      vscode.window.showInformationMessage('CodeTime: Walkthrough step opened ✔');
    } catch (err) {
      console.error('codetime.playWalkthrough error:', err);
      vscode.window.showErrorMessage('CodeTime: Failed to play walkthrough. Check Dev Tools console.');
    }
  })
);

  /* ------------------------------------------------------------------------
     Playback Scrubber mode
  ------------------------------------------------------------------------ */
  const getPlaybackUri = (key) =>
    vscode.Uri.from({
      scheme: 'codetime-playback',
      path: key
    });
  

  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.playback.open', async ({ key }) => {
      const uri = getPlaybackUri(key);

      playbackProvider.setContent(uri, `Playback Mode\n\nKey: ${key}\n`);

      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });

      return { uri: uri.toString() };
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.playback.setContent', async ({ key, content }) => {
      const uri = getPlaybackUri(key);
      playbackProvider.setContent(uri, content ?? '');
      return { uri: uri.toString() };
    })
  );


  /* ------------------------------------------------------------------------
     Debug: Git commit integration (Sprint 4)
  ------------------------------------------------------------------------ */
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.debugGitCommits', async () => {
      try {
        const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        if (!repoPath) {
          vscode.window.showErrorMessage('CodeTime: No workspace folder open.');
          return;
        }

        const isRepo = await gitService.isGitRepo(repoPath);
        if (!isRepo) {
          vscode.window.showErrorMessage('CodeTime: This workspace is not a Git repository.');
          return;
        }

        const commits = await gitService.getCommitList(repoPath, 10);
        console.log('CodeTime commits:', commits);

        vscode.window.showInformationMessage(
          `CodeTime: Loaded ${commits.length} commits (see Debug Console).`
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `CodeTime Git error: ${err?.message || err}`
        );
      }
    })
  );

    /* ------------------------------------------------------------------------
     FR8 / Diff for commit (Sprint 4)
  ------------------------------------------------------------------------ */
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.showFileAtCommit', async (commitHash) => {
      try {
        await showFileAtCommit(gitService, commitHash);
      } catch (err) {
        vscode.window.showErrorMessage(`CodeTime show-file error: ${err?.message || err}`);
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.showDiffForCommit', async (commitHash) => {
      try {
        await showDiffForCommit(gitService, commitHash);
      } catch (err) {
        vscode.window.showErrorMessage(`CodeTime diff error: ${err?.message || err}`);
      }
    })
  );
  /* ------------------------------------------------------------------------
     Open Instructor Mode
  ------------------------------------------------------------------------ */
 //sprint 5 change
    context.subscriptions.push(
  vscode.commands.registerCommand('codetime.openInstructorMode', async () => {
    await vscode.commands.executeCommand('codetime.chooseInstructor');
  })
);

  /* context.subscriptions.push(
    vscode.commands.registerCommand('codetime.openInstructorMode', async () => {
      try {
        await vscode.commands.executeCommand('workbench.view.extension.codetime');
        await vscode.commands.executeCommand('codetime.instructorMode.focus');
      } catch {
        // Fallback for older VS Code versions
        await vscode.commands.executeCommand('workbench.view.extension.codetime');
      }
    })
  ); */

  /* ------------------------------------------------------------------------
     Media commands
  ------------------------------------------------------------------------ */
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.uploadAudio', () =>
      uploadAudioCommand(context)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.uploadVideo', () =>
      uploadVideoCommand(context)
    )
  );

  // Export: package walkthrough + annotations + media + git bundle (single file)
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.exportPackage', async () => {
      try {
        await exportWalkthroughPackage();
      } catch (err) {
        vscode.window.showErrorMessage(`CodeTime export error: ${err?.message || err}`);
      }
    })
  );

  // Legacy alias
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.recordVideo', () =>
      vscode.commands.executeCommand('codetime.uploadVideo')
    )
  );

  /* ------------------------------------------------------------------------
     Annotations
  ------------------------------------------------------------------------ */
  registerAnnotationSupport(context);

  if (vscode.window.activeTextEditor) {
    refreshAnnotations(vscode.window.activeTextEditor);
  }
}

/* ============================================================================
   DEACTIVATE
============================================================================ */
function deactivate() {
  disposeAnnotations();
}

module.exports = { activate, deactivate };
