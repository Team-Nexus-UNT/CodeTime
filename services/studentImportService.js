// services/studentImportService.js
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const LESSONS_DIR_NAME = "studentLessons";
const MANIFEST_FILE = "manifest.json";
const BUNDLE_FILE = "repo.bundle";
const LESSON_REPO_DIR = ".repo";

async function importStudentLesson(context) {
  const picks = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title: "Select exported lesson folder (must contain manifest.json)",
  });

  if (!picks || picks.length === 0) return null;

  const lessonFolderUri = await resolveLessonRoot(picks[0]);
  if (!lessonFolderUri) {
    vscode.window.showErrorMessage(
      "Could not find manifest.json. Select the exported lesson folder (or the parent folder containing it)."
    );
    return null;
  }

  const storageRoot = vscode.Uri.joinPath(context.globalStorageUri, LESSONS_DIR_NAME);
  await vscode.workspace.fs.createDirectory(storageRoot);

  const manifest = await readJsonFile(vscode.Uri.joinPath(lessonFolderUri, MANIFEST_FILE));
  const safeId = (manifest?.lessonId ? String(manifest.lessonId) : null) || `lesson_${Date.now()}`;
  const finalDest = await getUniqueLessonDestination(storageRoot, safeId);

  await copyFolder(lessonFolderUri, finalDest);

  return {
    id: path.basename(finalDest.fsPath),
    rootUri: finalDest,
    manifest: await readJsonFile(vscode.Uri.joinPath(finalDest, MANIFEST_FILE)),
  };
}

async function resolveLessonRoot(baseUri) {
  if (await uriExists(vscode.Uri.joinPath(baseUri, MANIFEST_FILE))) {
    return baseUri;
  }

  const entries = await vscode.workspace.fs.readDirectory(baseUri);
  const candidates = [];

  for (const [name, type] of entries) {
    if (type !== vscode.FileType.Directory) continue;

    const child = vscode.Uri.joinPath(baseUri, name);
    if (await uriExists(vscode.Uri.joinPath(child, MANIFEST_FILE))) {
      candidates.push({ label: name, description: "Contains manifest.json", uri: child });
    }
  }

  if (candidates.length === 1) return candidates[0].uri;

  if (candidates.length > 1) {
    const picked = await vscode.window.showQuickPick(candidates, {
      title: "Multiple lesson folders found. Pick the one to import.",
    });
    return picked?.uri || null;
  }

  return null;
}

async function getUniqueLessonDestination(storageRoot, safeId) {
  const baseDest = vscode.Uri.joinPath(storageRoot, safeId);
  if (!(await uriExists(baseDest))) {
    return baseDest;
  }
  return vscode.Uri.joinPath(storageRoot, `${safeId}_${Date.now()}`);
}

async function listImportedStudentLessons(context) {
  const storageRoot = vscode.Uri.joinPath(context.globalStorageUri, LESSONS_DIR_NAME);
  if (!(await uriExists(storageRoot))) {
    return [];
  }

  const entries = await vscode.workspace.fs.readDirectory(storageRoot);
  const folders = entries.filter(([, type]) => type === vscode.FileType.Directory);
  const lessons = [];

  for (const [name] of folders) {
    const rootUri = vscode.Uri.joinPath(storageRoot, name);
    try {
      const manifest = await readJsonFile(vscode.Uri.joinPath(rootUri, MANIFEST_FILE));
      lessons.push({ id: name, rootUri, manifest });
    } catch {
      // Ignore malformed lesson folders.
    }
  }

  return lessons;
}

async function readJsonIfExists(rootUri, fileName) {
  try {
    return await readJsonFile(vscode.Uri.joinPath(rootUri, fileName));
  } catch {
    return null;
  }
}

async function readJsonFile(uri) {
  const raw = await vscode.workspace.fs.readFile(uri);
  return JSON.parse(raw.toString());
}

async function uriExists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function copyFolder(srcUri, destUri) {
  await vscode.workspace.fs.createDirectory(destUri);
  const entries = await vscode.workspace.fs.readDirectory(srcUri);

  for (const [name, type] of entries) {
    const src = vscode.Uri.joinPath(srcUri, name);
    const dest = vscode.Uri.joinPath(destUri, name);

    if (type === vscode.FileType.Directory) {
      await copyFolder(src, dest);
      continue;
    }

    if (type === vscode.FileType.File) {
      const bytes = await vscode.workspace.fs.readFile(src);
      await vscode.workspace.fs.writeFile(dest, bytes);
    }
  }
}

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error((stderr || err.message).toString().trim()));
      }
      resolve(stdout.toString());
    });
  });
}

/**
 * Ensure the imported lesson has a local git repo cloned from repo.bundle.
 * Creates: <lessonRoot>/.repo/
 */
async function ensureLessonRepo(lessonRootUri) {
  const bundleUri = vscode.Uri.joinPath(lessonRootUri, BUNDLE_FILE);
  const repoDirUri = vscode.Uri.joinPath(lessonRootUri, LESSON_REPO_DIR);

  try {
    const stat = await vscode.workspace.fs.stat(repoDirUri);
    if (stat?.type === vscode.FileType.Directory) {
      return repoDirUri.fsPath;
    }
  } catch {}

  if (!(await uriExists(bundleUri))) {
    return null;
  }

  fs.mkdirSync(repoDirUri.fsPath, { recursive: true });
  try {
    fs.rmSync(repoDirUri.fsPath, { recursive: true, force: true });
  } catch {}
  fs.mkdirSync(repoDirUri.fsPath, { recursive: true });

  const tempCloneDir = `${repoDirUri.fsPath}_tmp_${Date.now()}`;
  try {
    fs.rmSync(tempCloneDir, { recursive: true, force: true });
  } catch {}

  await runGit(["clone", bundleUri.fsPath, tempCloneDir], lessonRootUri.fsPath);

  try {
    fs.rmSync(repoDirUri.fsPath, { recursive: true, force: true });
  } catch {}
  fs.renameSync(tempCloneDir, repoDirUri.fsPath);

  return repoDirUri.fsPath;
}

async function deleteImportedStudentLesson(context, lessonId) {
  const storageRoot = vscode.Uri.joinPath(context.globalStorageUri, LESSONS_DIR_NAME);
  const target = vscode.Uri.joinPath(storageRoot, lessonId);

  try {
    await vscode.workspace.fs.delete(target, { recursive: true, useTrash: false });
    return true;
  } catch (error) {
    const message = error?.message || String(error);
    vscode.window.showErrorMessage(`Failed to remove lesson '${lessonId}': ${message}`);
    return false;
  }
}

module.exports = {
  importStudentLesson,
  listImportedStudentLessons,
  readJsonIfExists,
  ensureLessonRepo,
  deleteImportedStudentLesson,
};
