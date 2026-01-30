// audioStorage.js — audio directory + upload helpers for CodeTime
const vscode = require('vscode');
const { linkUploadedMedia } = require("./services/mediaLinkService");

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

  const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!repoPath) {
    vscode.window.showErrorMessage('CodeTime: No workspace folder open.');
    return;
  }

  for (const src of picks) {
    const data = await vscode.workspace.fs.readFile(src);
    const base = src.path.split('/').pop() || 'audio';
    const safe = base.replace(/[^\w\-. ]/g, '_');

    // Final saved location
    const destUri = vscode.Uri.joinPath(audioDir, safe);

    // Save the file
    await vscode.workspace.fs.writeFile(destUri, data);

    // Link the uploaded audio to walkthrough timeline/commit context
    try {
      await linkUploadedMedia({
        repoPath,
        mediaType: "audio",
        savedFilePath: destUri.fsPath,
        defaultTitle: "Audio clip",
      });
    } catch (err) {
      console.error("CodeTime: linkUploadedMedia (audio) failed:", err);
      vscode.window.showWarningMessage(
        `CodeTime: Uploaded "${safe}", but linking failed. Check Debug Console.`
      );
    }
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
