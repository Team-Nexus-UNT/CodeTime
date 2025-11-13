const vscode = require('vscode');

function getTimelinePanelHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body {
      margin: 0;
      padding: 16px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }
    h1 { margin-top: 0; font-size: 18px; }
    p  { font-size: 12px; opacity: 0.8; }
    .box {
      margin-top: 12px;
      padding: 10px;
      border-radius: 6px;
      border: 1px solid var(--vscode-editorWidget-border);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <h1>CodeTime Timeline</h1>
  <p>This confirms FR1: extension activation and timeline command.</p>
  <div class="box">
    Next: hook this to real CodeTime activity data.
  </div>
</body>
</html>`;
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log('CodeTime Starter extension activated');

  // Test command
  const testDisposable = vscode.commands.registerCommand('codetime.test', () => {
    vscode.window.showInformationMessage('CodeTime Starter: command ran successfully!');
  });
  context.subscriptions.push(testDisposable);

  // Timeline command -> webview panel
  const timelineDisposable = vscode.commands.registerCommand('codetime.openTimeline', () => {
    const panel = vscode.window.createWebviewPanel(
      'codetimeTimelinePanel',
      'CodeTime Timeline',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    panel.webview.html = getTimelinePanelHtml();
  });
  context.subscriptions.push(timelineDisposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
