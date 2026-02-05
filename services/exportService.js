// services/exportService.js
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

const walkthroughStorage = require("../walkthroughStorage");
const gitService = require("./gitService");

/**
 * Pick a walkthrough to export.
 */
async function pickWalkthrough() {
  const all = walkthroughStorage.getAllWalkthroughs();
  if (!all.length) {
    vscode.window.showErrorMessage("CodeTime: No walkthroughs found. Create one first.");
    return null;
  }

  const picked = await vscode.window.showQuickPick(
    all.map((w) => ({
      label: w.name || "(Untitled walkthrough)",
      description: w.description || "",
      walkthroughId: w.id,
    })),
    { placeHolder: "Select a walkthrough to export", matchOnDescription: true }
  );

  return picked?.walkthroughId || null;
}

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
  // If absolute path, keep; if relative, resolve to workspace.
  if (path.isAbsolute(pth)) return pth;
  return path.join(repoPath, pth);
}

async function buildGitBundleBase64(repoPath) {
  // Create bundle in a temp location
  const tmp = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "CodeTime: Building Git bundle…" },
    async () => {
      const tmpDir = path.join(repoPath, ".codetime");
      fs.mkdirSync(tmpDir, { recursive: true });

      const bundlePath = path.join(tmpDir, `codetime-${Date.now()}.bundle`);
      await gitService.runGit(repoPath, ["bundle", "create", bundlePath, "--all"]);
      return bundlePath;
    }
  );

  const data = fs.readFileSync(tmp);
  // Cleanup temp bundle file (best-effort)
  try { fs.unlinkSync(tmp); } catch {}
  return Buffer.from(data).toString("base64");
}

/**
 * Export a walkthrough package as a SINGLE FILE (JSON) that embeds:
 * - a Git bundle (commit history + diffs)
 * - referenced audio/video files
 * - annotations
 * - the walkthrough model (steps/media)
 *
 * This keeps Student Mode simple: it can recreate a temp repo from the bundle,
 * unpack media, then reuse the existing timeline/git-based playback logic.
 */
async function exportWalkthroughPackage() {
  const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!repoPath) {
    vscode.window.showErrorMessage("CodeTime: No workspace folder open.");
    return;
  }

  const isRepo = await gitService.isGitRepo(repoPath);
  if (!isRepo) {
    vscode.window.showErrorMessage("CodeTime: This workspace is not a Git repository (needed for export).");
    return;
  }

  const walkthroughId = await pickWalkthrough();
  if (!walkthroughId) return;

  const walkthrough = walkthroughStorage.getWalkthroughById(walkthroughId);
  if (!walkthrough) {
    vscode.window.showErrorMessage("CodeTime: Walkthrough not found.");
    return;
  }

  const suggestedName = (walkthrough.name || "codetime-walkthrough")
    .replace(/[^\w\-. ]/g, "_")
    .trim();

  const saveUri = await vscode.window.showSaveDialog({
    title: "Export CodeTime lesson package",
    defaultUri: vscode.Uri.file(path.join(repoPath, `${suggestedName}.codetime.json`)),
    filters: { "CodeTime Package": ["codetime.json", "json"] },
    saveLabel: "Export"
  });

  if (!saveUri) return;

  const annotations = loadWorkspaceAnnotations(repoPath);

  // Embed media referenced by this walkthrough
  const media = Array.isArray(walkthrough.media) ? walkthrough.media : [];
  const embeddedMedia = [];
  for (const m of media) {
    const abs = normalizeMediaPath(repoPath, m.path);
    if (!abs || !fs.existsSync(abs)) {
      embeddedMedia.push({ ...m, embedded: false, missing: true });
      continue;
    }

    const fileBytes = fs.readFileSync(abs);
    embeddedMedia.push({
      ...m,
      embedded: true,
      missing: false,
      fileName: path.basename(abs),
      dataBase64: Buffer.from(fileBytes).toString("base64"),
    });
  }

  const gitBundleBase64 = await buildGitBundleBase64(repoPath);

  const payload = {
    format: "codetime.lesson",
    version: 1,
    createdAt: new Date().toISOString(),
    walkthrough: {
      ...walkthrough,
      // Replace media with embedded versions
      media: embeddedMedia,
    },
    annotations,
    git: {
      bundleName: "repo.bundle",
      bundleBase64: gitBundleBase64,
    }
  };

  await vscode.workspace.fs.writeFile(saveUri, Buffer.from(JSON.stringify(payload), "utf8"));

  vscode.window.showInformationMessage("CodeTime: Export complete.");
}

module.exports = { exportWalkthroughPackage };
