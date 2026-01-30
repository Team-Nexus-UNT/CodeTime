// videoStorage.js — video directory + upload helpers for CodeTime
const vscode = require("vscode");
const path = require("path");
const { linkUploadedMedia } = require("./services/mediaLinkService");

/* -------------------------------------------------------------------------- */
/*                          DIRECTORY UTILITIES                               */
/* -------------------------------------------------------------------------- */
async function ensureVideoDir(context) {
  const dir = vscode.Uri.joinPath(context.globalStorageUri, "video");
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}

async function listVideoForWebview(webview, dir) {
  const entries = await vscode.workspace.fs.readDirectory(dir);
  const files = entries
    .filter((e) => e[1] === vscode.FileType.File)
    .map((e) => e[0]);

  return files.map((name) => {
    const raw = vscode.Uri.joinPath(dir, name);
    return {
      fileName: name,
      raw: raw.toString(),
      webviewSrc: webview.asWebviewUri(raw).toString(),
    };
  });
}

/* -------------------------------------------------------------------------- */
/*                             COMMAND HANDLER                                */
/* -------------------------------------------------------------------------- */
async function uploadVideoCommand(context) {
  const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!repoPath) {
    vscode.window.showErrorMessage("CodeTime: No workspace folder open.");
    return;
  }

  const videoDir = await ensureVideoDir(context);

  const picks = await vscode.window.showOpenDialog({
    title: "Select video files to upload",
    canSelectMany: true,
    filters: { Video: ["mp4", "mov", "mkv", "webm"] },
  });
  if (!picks || picks.length === 0) return;

  let linkedCount = 0;

  for (const src of picks) {
    const data = await vscode.workspace.fs.readFile(src);

    const base = path.basename(src.fsPath) || "video";
    const safe = base.replace(/[^A-Za-z0-9_.\- ]/g, "_");

    const destUri = vscode.Uri.joinPath(videoDir, safe);
    await vscode.workspace.fs.writeFile(destUri, data);

    const savedFilePath = destUri.fsPath;

    try {
      await linkUploadedMedia({
        repoPath,
        mediaType: "video",
        savedFilePath,
        defaultTitle: "Video clip",
      });
      linkedCount++;
    } catch (err) {
      console.error("CodeTime: linkUploadedMedia failed:", err);
      vscode.window.showWarningMessage(
        `Uploaded "${safe}" but could not link it to a walkthrough.`
      );
    }
  }

  try {
    await vscode.commands.executeCommand("codetime.instructorMode.refresh");
  } catch {
    // ignore
  }

  vscode.window.showInformationMessage(
    `Uploaded ${picks.length} video file${picks.length > 1 ? "s" : ""}. Linked ${linkedCount}.`
  );
}

module.exports = {
  ensureVideoDir,
  listVideoForWebview,
  uploadVideoCommand,
};
