// audioStorage.js — audio directory + upload helpers for CodeTime
const vscode = require('vscode');

/* -------------------------------------------------------------------------- */
/*                          DIRECTORY UTILITIES                               */
/* -------------------------------------------------------------------------- */
async function ensureAudioDir(context) {
  const dir = vscode.Uri.joinPath(context.globalStorageUri, 'audio');
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}

async function listAudioForWebview(webview, dir) {
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
async function uploadAudioCommand(context) {
  const audioDir = await ensureAudioDir(context);
  const picks = await vscode.window.showOpenDialog({
    title: 'Select audio files to upload',
    canSelectMany: true,
    filters: { Audio: ['mp3', 'm4a', 'wav', 'ogg'] }
  });
  if (!picks || picks.length === 0) return;

  for (const src of picks) {
    const data = await vscode.workspace.fs.readFile(src);
    const base = src.path.split('/').pop() || 'audio';
    const safe = base.replace(/[^\w\-. ]/g, '_');
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(audioDir, safe), data);
  }

  try {
    await vscode.commands.executeCommand('codetime.instructorMode.refresh');
  } catch {
    // ignore
  }

  vscode.window.showInformationMessage(
    `Uploaded ${picks.length} audio file${picks.length > 1 ? 's' : ''}.`
  );
}

module.exports = {
  ensureAudioDir,
  listAudioForWebview,
  uploadAudioCommand
};
