// extension.js — CodeTime: Audio/Video Upload + Annotations (modular)
const vscode = require('vscode');

// Views
const { registerWalkthroughView } = require('./walkthroughView');
const { registerTimelineView } = require('./timelineView');
const { registerInstructorMode } = require('./instructorModeView');
const { PlaybackProvider } = require('./services/playbackProvider');

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

/* ============================================================================
   ACTIVATE
============================================================================ */
async function activate(context) {
  // Ensure extension storage exists
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  // initialize commit snapshot provider
  initCommitSnapshots(context, gitService);

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



  /* ------------------------------------------------------------------------
     Views
  ------------------------------------------------------------------------ */
  registerTimelineView(context, gitService);
  await registerInstructorMode(context);
  registerWalkthroughView(context);

  /* ------------------------------------------------------------------------
     Smoke test
  ------------------------------------------------------------------------ */
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.test', () => {
      vscode.window.showInformationMessage('CodeTime activated ✔');
    })
  );

    /* ------------------------------------------------------------------------
     Playback (Step 1 Test Command) REMOVE after playback wired to timeline
  ------------------------------------------------------------------------ */
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.playback.testOpen', async () => {
      const uri = vscode.Uri.parse('codetime-playback:/test');
  
      // Always set content (no _docs access)
      playbackProvider.setContent(
        uri,
        'CodeTime Playback Mode\n\nStep 1 working.\n'
      );
  
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );
  

  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.playback.testUpdate', async () => {
      const uri = vscode.Uri.parse('codetime-playback:/test');

      const text =
        `CodeTime Playback Mode\n\n` +
        `Updated at: ${new Date().toLocaleTimeString()}\n\n` +
        `If this updated without opening a new tab, Step 1 is complete ✅`;

      playbackProvider.setContent(uri, text);
    })
  );

    /* ------------------------------------------------------------------------
     Playback (Step 2 Commands)
  ------------------------------------------------------------------------ */
  // Stable URI per "session key" so it stays ONE tab
  const getPlaybackUri = (key) =>
    vscode.Uri.from({
      scheme: 'codetime-playback',
      path: key
    });
  

  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.playback.open', async ({ key }) => {
      const uri = getPlaybackUri(key);

      // Put some initial content so tab isn't blank
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
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.openInstructorMode', async () => {
      try {
        await vscode.commands.executeCommand('workbench.view.extension.codetime');
        await vscode.commands.executeCommand('codetime.instructorMode.focus');
      } catch {
        // Fallback for older VS Code versions
        await vscode.commands.executeCommand('workbench.view.extension.codetime');
      }
    })
  );

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
