// videoStorage.js — video directory + upload helpers for CodeTime
const vscode = require('vscode');

/* -------------------------------------------------------------------------- */
/*                          DIRECTORY UTILITIES                               */
/* -------------------------------------------------------------------------- */
async function ensureVideoDir(context) {
  const dir = vscode.Uri.joinPath(context.globalStorageUri, 'video');
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}

async function listVideoForWebview(webview, dir) {
  const entries = await vscode.workspace.fs.readDirectory(dir);
  const files = entries
    .filter(e => e[1] === vscode.FileType.File)
    .map(e => e[0]);

  return files.map(name => {
    const raw = vscode.Uri.joinPath(dir, name);
    return {
      fileName: name,
      raw: raw.toString(),
      webviewSrc: webview.asWebviewUri(raw).toString()
    };
  });
}

/* -------------------------------------------------------------------------- */
/*                             COMMAND HANDLER                                */
/* -------------------------------------------------------------------------- */
async function uploadVideoCommand(context) {
  const videoDir = await ensureVideoDir(context);
  const picks = await vscode.window.showOpenDialog({
    title: 'Select video files to upload',
    canSelectMany: true,
    filters: { Video: ['mp4', 'mov', 'mkv', 'webm'] }
  });
  if (!picks || picks.length === 0) return;

  for (const src of picks) {
    const data = await vscode.workspace.fs.readFile(src);
    const base = src.path.split('/').pop() || 'video';
    const safe = base.replace(/[^A-Za-z0-9_.\- ]/g, '_');
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(videoDir, safe), data);
  }

  try {
    await vscode.commands.executeCommand('codetime.instructorMode.refresh');
  } catch {
    // ignore
  }

  vscode.window.showInformationMessage(
    `Uploaded ${picks.length} video file${picks.length > 1 ? 's' : ''}.`
  );
}

module.exports = {
  ensureVideoDir,
  listVideoForWebview,
  uploadVideoCommand
};
