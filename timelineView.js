// timelineView.js — Timeline view provider (stub)
const vscode = require('vscode');

function registerTimelineView(context) {
  const provider = {
    resolveWebviewView(view) {
      view.webview.options = { enableScripts: false };
      view.webview.html = '<html><body>Timeline Coming Soon…</body></html>';
    }
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codetime.timelineView', provider)
  );
}

module.exports = { registerTimelineView };
