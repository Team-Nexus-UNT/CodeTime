// extension.js — CodeTime: Audio/Video Upload + Annotations (modular)
const vscode = require('vscode');

// Views
const { registerWalkthroughView } = require('./walkthroughView');
const { registerTimelineView } = require('./timelineView');
const { registerInstructorMode } = require('./instructorModeView');

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
