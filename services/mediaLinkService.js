// services/mediaLinkService.js
const vscode = require("vscode");
const path = require("path");

const walkthroughStorage = require("../walkthroughStorage");
const gitService = require("./gitService");

/**
 * Make a path relative to the workspace (so it works across machines).
 * Falls back to absolute path if we can't determine workspace.
 */
function toWorkspaceRelativePath(absPath) {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) return absPath;

  // Normalize slashes so it behaves on Windows/macOS/Linux
  const rel = path.relative(ws, absPath);
  return rel && !rel.startsWith("..") ? rel : absPath;
}

/**
 * Ask user to pick a walkthrough to attach media to.
 */
async function pickWalkthrough() {
  const all = walkthroughStorage.getAllWalkthroughs();

  if (!all.length) {
    vscode.window.showErrorMessage(
      "CodeTime: No walkthroughs found. Create a walkthrough first."
    );
    return null;
  }

  const items = all.map((w) => ({
    label: w.name || "(Untitled walkthrough)",
    description: w.description || "",
    walkthroughId: w.id,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a walkthrough to link this media to",
    matchOnDescription: true,
  });

  return picked?.walkthroughId || null;
}

/**
 * Ask user to pick a commit to attach media to.
 */
async function pickCommit(repoPath, limit = 30) {
  const ok = await gitService.isGitRepo(repoPath);
  if (!ok) {
    vscode.window.showErrorMessage("CodeTime: This workspace is not a Git repository.");
    return null;
  }

  const commits = await gitService.getCommitList(repoPath, limit);
  if (!commits.length) {
    vscode.window.showErrorMessage("CodeTime: No commits found.");
    return null;
  }

  const items = commits.map((c) => ({
    label: `${c.message}`,
    description: `${c.hash.slice(0, 7)} • ${c.author} • ${c.date}`,
    hash: c.hash,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select the commit this media should be linked to",
    matchOnDescription: true,
  });

  return picked?.hash || null;
}

/**
 * Adds a media record into a walkthrough: walkthrough.media[]
 */
function addMediaToWalkthrough(walkthroughId, mediaRecord) {
  const walkthrough = walkthroughStorage.getWalkthroughById(walkthroughId);
  if (!walkthrough) return null;

  const currentMedia = Array.isArray(walkthrough.media) ? walkthrough.media : [];
  const updated = [...currentMedia, mediaRecord];

  return walkthroughStorage.updateWalkthrough(walkthroughId, { media: updated });
}

/**
 * Main function: link an uploaded media file to a walkthrough + commit.
 * Call this AFTER you have the saved file path.
 */
async function linkUploadedMedia({
  repoPath,
  mediaType, // "audio" | "video"
  savedFilePath, // absolute path where you saved the file
  defaultTitle,
  fileContext, // optional: { filePath, startLine, endLine }
}) {
  if (!repoPath) {
    vscode.window.showErrorMessage("CodeTime: No workspace folder open.");
    return null;
  }

  const walkthroughId = await pickWalkthrough();
  if (!walkthroughId) return null;

  const commitHash = await pickCommit(repoPath);
  if (!commitHash) return null;

  const title =
    (await vscode.window.showInputBox({
      prompt: `Title for this ${mediaType} clip (optional)`,
      value: defaultTitle || "",
    })) || defaultTitle || "";

  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: mediaType,
    title,
    commitHash,
    createdAt: new Date().toISOString(),
    path: toWorkspaceRelativePath(savedFilePath),
  };

  // Optional: link to file/lines too (nice bonus, not required)
  if (fileContext?.filePath) {
    record.filePath = fileContext.filePath;
    if (typeof fileContext.startLine === "number") record.startLine = fileContext.startLine;
    if (typeof fileContext.endLine === "number") record.endLine = fileContext.endLine;
  }

  const updated = addMediaToWalkthrough(walkthroughId, record);

  if (updated) {
    vscode.window.showInformationMessage(
      `CodeTime: Linked ${mediaType} to commit ${commitHash.slice(0, 7)}.`
    );
  } else {
    vscode.window.showErrorMessage("CodeTime: Failed to link media to walkthrough.");
  }

  return updated;
}

module.exports = { linkUploadedMedia };
