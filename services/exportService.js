// services/exportService.js
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

const walkthroughStorage = require("../walkthroughStorage");
const gitService = require("./gitService");

/**
 * Read annotations from workspace .codetime/annotations.json (if present).
 */
function loadWorkspaceAnnotations(repoPath) {
  try {
    const p = path.join(repoPath, ".codetime", "annotations.json");
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, "utf8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.annotations)) return parsed.annotations;
    return [];
  } catch (e) {
    console.error("CodeTime: failed to load annotations for export", e);
    return [];
  }
}

function normalizeMediaPath(repoPath, pth) {
  if (!pth) return null;
  if (path.isAbsolute(pth)) return pth;
  return path.join(repoPath, pth);
}

async function pickExportFolder(repoPath, suggestedFolderName) {
  const picked = await vscode.window.showOpenDialog({
    title: "Select a folder to export the CodeTime lesson package into",
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(repoPath),
    openLabel: "Export here",
  });
  if (!picked || !picked[0]) return null;

  const base = picked[0].fsPath;
  const folder = path.join(base, suggestedFolderName);

  // Prevent clobbering an existing folder without warning
  if (fs.existsSync(folder)) {
    const choice = await vscode.window.showQuickPick(
      ["Overwrite existing folder", "Cancel"],
      { placeHolder: `Folder already exists: ${folder}` }
    );
    if (choice !== "Overwrite existing folder") return null;
    try { fs.rmSync(folder, { recursive: true, force: true }); } catch {}
  }

  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

/**
 * Export the ENTIRE lesson (all walkthroughs + annotations + media + git bundle)
 * as a folder structure:
 *
 * <ExportFolder>/
 *   manifest.json
 *   repo.bundle
 *   walkthroughs.json
 *   annotations.json
 *   media/
 *     <walkthroughId>/
 *       <mediaId>_<originalName>
 *
 * Student Mode can later import this folder and treat it read-only.
 */
async function exportLessonPackage() {
  const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!repoPath) {
    vscode.window.showErrorMessage("CodeTime: No workspace folder open.");
    return;
  }

  const isRepo = await gitService.isGitRepo(repoPath);
  if (!isRepo) {
    vscode.window.showErrorMessage(
      "CodeTime: This workspace is not a Git repository (needed for export)."
    );
    return;
  }

  const walkthroughs = walkthroughStorage.getAllWalkthroughs();
  if (!walkthroughs.length) {
    vscode.window.showErrorMessage("CodeTime: No walkthroughs found. Create one first.");
    return;
  }

  const suggestedFolderName = `codetime-lesson-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}`;

  const exportDir = await pickExportFolder(repoPath, suggestedFolderName);
  if (!exportDir) return;

  const mediaDir = path.join(exportDir, "media");
  fs.mkdirSync(mediaDir, { recursive: true });

  // 1) Export Git bundle
  const bundlePath = path.join(exportDir, "repo.bundle");
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "CodeTime: Exporting Git history…" },
    async () => {
      await gitService.runGit(repoPath, ["bundle", "create", bundlePath, "--all"]);
    }
  );

  // 2) Export annotations
  const annotations = loadWorkspaceAnnotations(repoPath);
  fs.writeFileSync(path.join(exportDir, "annotations.json"), JSON.stringify(annotations, null, 2), "utf8");

  // 3) Export walkthroughs + media files
  const exportedWalkthroughs = [];
  const referencedCommits = new Set();

  for (const w of walkthroughs) {
    const wMedia = Array.isArray(w.media) ? w.media : [];
    const wSteps = Array.isArray(w.steps) ? w.steps : [];

    for (const s of wSteps) if (s?.commitHash) referencedCommits.add(s.commitHash);
    for (const m of wMedia) if (m?.commitHash) referencedCommits.add(m.commitHash);

    const wFolder = path.join(mediaDir, w.id);
    fs.mkdirSync(wFolder, { recursive: true });

    const exportedMedia = [];
    for (const m of wMedia) {
      const abs = normalizeMediaPath(repoPath, m.path);
      if (!abs) {
        exportedMedia.push({ ...m, exported: false, missing: true });
        continue;
      }

      try {
        // Prefer a direct file copy. This avoids edge-cases where VS Code's FS layer
        // can return empty buffers for large binaries on some platforms.
        const stat = fs.existsSync(abs) ? fs.statSync(abs) : null;
        if (!stat || !stat.isFile() || stat.size === 0) {
          exportedMedia.push({ ...m, exported: false, missing: true, reason: "missing-or-empty" });
          continue;
        }

        const origName = path.basename(abs) || `${m.type || "media"}-${m.id}`;
        const safeName = origName.replace(/[^\w\-. ]/g, "_");
        const outName = `${m.id}_${safeName}`;
        const outPath = path.join(wFolder, outName);

        fs.copyFileSync(abs, outPath);

        exportedMedia.push({
          ...m,
          exported: true,
          missing: false,
          exportedBytes: stat.size,
          // Path relative to the package root
          packagePath: path.join("media", w.id, outName).replace(/\\/g, "/"),
        });
      } catch (e) {
        console.error("CodeTime: failed to export media", abs, e);
        exportedMedia.push({ ...m, exported: false, missing: true });
      }
    }

    exportedWalkthroughs.push({
      ...w,
      media: exportedMedia,
    });
  }

  fs.writeFileSync(
    path.join(exportDir, "walkthroughs.json"),
    JSON.stringify(exportedWalkthroughs, null, 2),
    "utf8"
  );

  // 4) Manifest (metadata for Student Mode import later)
  const manifest = {
    format: "codetime.lesson",
    version: 2,
    createdAt: new Date().toISOString(),
    git: { bundle: "repo.bundle" },
    files: {
      walkthroughs: "walkthroughs.json",
      annotations: "annotations.json",
      mediaDir: "media/"
    },
    stats: {
      walkthroughCount: exportedWalkthroughs.length,
      annotationCount: Array.isArray(annotations) ? annotations.length : 0,
      referencedCommitCount: referencedCommits.size
    },
    referencedCommits: Array.from(referencedCommits),
  };

  fs.writeFileSync(path.join(exportDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  vscode.window.showInformationMessage(`CodeTime: Export complete → ${exportDir}`);
}

module.exports = { exportLessonPackage, exportWalkthroughPackage: exportLessonPackage };
