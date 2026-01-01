// extension.js — CodeTime: Audio/Video Upload + Annotations (modular)
const vscode = require('vscode');

const { registerWalkthroughView } = require('./walkthroughView');
const { registerTimelineView } = require('./timelineView');
const { registerInstructorMode } = require('./instructorModeView');
const { uploadAudioCommand } = require('./audioStorage');
const { uploadVideoCommand } = require('./videoStorage');
const {
  registerAnnotationSupport,
  refreshAnnotations,
  disposeAnnotations
} = require('./annotations');

/* ============================================================================
   ANNOTATION SYSTEM (moved to annotations.js)
   TIMELINE VIEW (moved to timelineView.js)
   INSTRUCTOR MODE HTML (moved to instructorModeView.js)
   VIDEO UTILITIES (moved to videoStorage.js)
   AUDIO UTILITIES (moved to audioStorage.js)
============================================================================ */

/* ============================================================================
   ACTIVATE
============================================================================ */
async function activate(context) {
  // Ensure extension storage exists
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);

  // Views
  registerTimelineView(context);
  await registerInstructorMode(context);
  registerWalkthroughView(context);

  // Smoke test
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.test', () => {
      vscode.window.showInformationMessage('CodeTime activated ✔');
    })
  );

  // Open Instructor Mode (brings CodeTime container into view + focuses panel)
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.openInstructorMode', async () => {
      try {
        await vscode.commands.executeCommand('workbench.view.extension.codetime');
        await vscode.commands.executeCommand('codetime.instructorMode.focus');
      } catch {
        // If focus command isn't available in older VS Code, at least open the container.
        await vscode.commands.executeCommand('workbench.view.extension.codetime');
      }
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
      vscode.commands.executeCommand('codetime.uploadVideo')
    )
  );

  // Annotations
  registerAnnotationSupport(context);
  if (vscode.window.activeTextEditor) {
    refreshAnnotations(vscode.window.activeTextEditor);
  }
}

function deactivate() {
  disposeAnnotations();
}

module.exports = { activate, deactivate };
