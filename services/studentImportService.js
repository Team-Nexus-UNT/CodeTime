// services/studentImportService.js
const vscode = require("vscode");
const path = require("path");
const fs = require('fs');
const { execFile } = require('child_process');

/**
 * Student import expects an Instructor export folder that contains:
 * - manifest.json
 * - annotations.json (optional)
 * - walkthroughs.json (optional)
 * - repo.bundle (optional but used for playback snapshots)
 * - media/ (optional)
 */

async function importStudentLesson(context) {
  const picks = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title: "Select exported lesson folder (must contain manifest.json)",
  });

  if (!picks || picks.length === 0) return null;

  let lessonFolderUri = picks[0];
  let manifestUri = vscode.Uri.joinPath(lessonFolderUri, "manifest.json");

  // Verify manifest exists (support selecting the parent folder by mistake)
  const resolveLessonRoot = async (baseUri) => {
    // 1) manifest at root
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(baseUri, "manifest.json"));
      return baseUri;
    } catch (_) {}

    // 2) search one level deep for *\manifest.json
    const entries = await vscode.workspace.fs.readDirectory(baseUri);
    const candidates = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.Directory) continue;
      const child = vscode.Uri.joinPath(baseUri, name);
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(child, "manifest.json"));
        candidates.push({ label: name, uri: child });
      } catch (_) {}
    }

    if (candidates.length === 1) return candidates[0].uri;

    if (candidates.length > 1) {
      const picked = await vscode.window.showQuickPick(
        candidates.map((c) => ({ label: c.label, description: "Contains manifest.json", uri: c.uri })),
        { title: "Multiple lesson folders found. Pick the one to import." }
      );
      if (picked && picked.uri) return picked.uri;
    }

    return null;
  };

  const resolved = await resolveLessonRoot(lessonFolderUri);
  if (!resolved) {
    vscode.window.showErrorMessage(
      "Could not find manifest.json. Select the exported lesson folder (or the parent folder containing it)."
    );
    return null;
  }

  lessonFolderUri = resolved;
  manifestUri = vscode.Uri.joinPath(lessonFolderUri, "manifest.json");

  // Copy into global storage: <globalStorage>/studentLessons/<id or timestamp>/
  const storageRoot = vscode.Uri.joinPath(context.globalStorageUri, "studentLessons");
  await vscode.workspace.fs.createDirectory(storageRoot);

  const manifest = JSON.parse((await vscode.workspace.fs.readFile(manifestUri)).toString());
  const safeId =
    (manifest && manifest.lessonId ? String(manifest.lessonId) : null) ||
    `lesson_${Date.now()}`;

  const destFolder = vscode.Uri.joinPath(storageRoot, safeId);

  // If already exists, make a new folder to avoid overwriting
  let finalDest = destFolder;
  try {
    await vscode.workspace.fs.stat(finalDest);
    finalDest = vscode.Uri.joinPath(storageRoot, `${safeId}_${Date.now()}`);
  } catch (_) {
    // doesn't exist, OK
  }

  await copyFolder(lessonFolderUri, finalDest);

  // Return normalized lesson object for UI
  const importedManifestUri = vscode.Uri.joinPath(finalDest, "manifest.json");
  const importedManifest = JSON.parse(
    (await vscode.workspace.fs.readFile(importedManifestUri)).toString()
  );

  return {
    id: path.basename(finalDest.fsPath),
    rootUri: finalDest,
    manifest: importedManifest,
  };
}

async function listImportedStudentLessons(context) {
  const storageRoot = vscode.Uri.joinPath(context.globalStorageUri, "studentLessons");
  try {
    await vscode.workspace.fs.stat(storageRoot);
  } catch (_) {
    return [];
  }

  const entries = await vscode.workspace.fs.readDirectory(storageRoot);
  const folders = entries.filter(([, type]) => type === vscode.FileType.Directory);

  const lessons = [];
  for (const [name] of folders) {
    const rootUri = vscode.Uri.joinPath(storageRoot, name);
    const manifestUri = vscode.Uri.joinPath(rootUri, "manifest.json");
    try {
      const manifest = JSON.parse((await vscode.workspace.fs.readFile(manifestUri)).toString());
      lessons.push({ id: name, rootUri, manifest });
    } catch (_) {
      // ignore malformed lesson folders
    }
  }
  return lessons;
}

async function readJsonIfExists(rootUri, fileName) {
  try {
    const uri = vscode.Uri.joinPath(rootUri, fileName);
    const raw = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(raw.toString());
  } catch (_) {
    return null;
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
    } else if (type === vscode.FileType.File) {
      const bytes = await vscode.workspace.fs.readFile(src);
      await vscode.workspace.fs.writeFile(dest, bytes);
    }
  }
}

/**
 * Student import expects an Instructor export folder that contains:
 * - manifest.json
 * - annotations.json (optional)
 * - walkthroughs.json (optional)
 * - repo.bundle (optional but used for playback snapshots)
 * - media/ (optional)
 */

async function importStudentLesson(context) {
  const picks = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title: "Select exported lesson folder (must contain manifest.json)",
  });

  if (!picks || picks.length === 0) return null;

  let lessonFolderUri = picks[0];
  let manifestUri = vscode.Uri.joinPath(lessonFolderUri, "manifest.json");

  // Verify manifest exists (support selecting the parent folder by mistake)
  const resolveLessonRoot = async (baseUri) => {
    // 1) manifest at root
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(baseUri, "manifest.json"));
      return baseUri;
    } catch (_) {}

    // 2) search one level deep for *\manifest.json
    const entries = await vscode.workspace.fs.readDirectory(baseUri);
    const candidates = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.Directory) continue;
      const child = vscode.Uri.joinPath(baseUri, name);
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(child, "manifest.json"));
        candidates.push({ label: name, uri: child });
      } catch (_) {}
    }

    if (candidates.length === 1) return candidates[0].uri;

    if (candidates.length > 1) {
      const picked = await vscode.window.showQuickPick(
        candidates.map((c) => ({ label: c.label, description: "Contains manifest.json", uri: c.uri })),
        { title: "Multiple lesson folders found. Pick the one to import." }
      );
      if (picked && picked.uri) return picked.uri;
    }

    return null;
  };

  const resolved = await resolveLessonRoot(lessonFolderUri);
  if (!resolved) {
    vscode.window.showErrorMessage(
      "Could not find manifest.json. Select the exported lesson folder (or the parent folder containing it)."
    );
    return null;
  }

  lessonFolderUri = resolved;
  manifestUri = vscode.Uri.joinPath(lessonFolderUri, "manifest.json");

  // Copy into global storage: <globalStorage>/studentLessons/<id or timestamp>/
  const storageRoot = vscode.Uri.joinPath(context.globalStorageUri, "studentLessons");
  await vscode.workspace.fs.createDirectory(storageRoot);

  const manifest = JSON.parse((await vscode.workspace.fs.readFile(manifestUri)).toString());
  const safeId =
    (manifest && manifest.lessonId ? String(manifest.lessonId) : null) ||
    `lesson_${Date.now()}`;

  const destFolder = vscode.Uri.joinPath(storageRoot, safeId);

  // If already exists, make a new folder to avoid overwriting
  let finalDest = destFolder;
  try {
    await vscode.workspace.fs.stat(finalDest);
    finalDest = vscode.Uri.joinPath(storageRoot, `${safeId}_${Date.now()}`);
  } catch (_) {
    // doesn't exist, OK
  }

  await copyFolder(lessonFolderUri, finalDest);

  // Return normalized lesson object for UI
  const importedManifestUri = vscode.Uri.joinPath(finalDest, "manifest.json");
  const importedManifest = JSON.parse(
    (await vscode.workspace.fs.readFile(importedManifestUri)).toString()
  );

  return {
    id: path.basename(finalDest.fsPath),
    rootUri: finalDest,
    manifest: importedManifest,
  };
}

async function listImportedStudentLessons(context) {
  const storageRoot = vscode.Uri.joinPath(context.globalStorageUri, "studentLessons");
  try {
    await vscode.workspace.fs.stat(storageRoot);
  } catch (_) {
    return [];
  }

  const entries = await vscode.workspace.fs.readDirectory(storageRoot);
  const folders = entries.filter(([, type]) => type === vscode.FileType.Directory);

  const lessons = [];
  for (const [name] of folders) {
    const rootUri = vscode.Uri.joinPath(storageRoot, name);
    const manifestUri = vscode.Uri.joinPath(rootUri, "manifest.json");
    try {
      const manifest = JSON.parse((await vscode.workspace.fs.readFile(manifestUri)).toString());
      lessons.push({ id: name, rootUri, manifest });
    } catch (_) {
      // ignore malformed lesson folders
    }
  }
  return lessons;
}

async function readJsonIfExists(rootUri, fileName) {
  try {
    const uri = vscode.Uri.joinPath(rootUri, fileName);
    const raw = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(raw.toString());
  } catch (_) {
    return null;
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
    } else if (type === vscode.FileType.File) {
      const bytes = await vscode.workspace.fs.readFile(src);
      await vscode.workspace.fs.writeFile(dest, bytes);
    }
  }
}


function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).toString().trim()));
      resolve(stdout.toString());
    });
  });
}

/**
 * Ensure the imported lesson has a local git repo cloned from repo.bundle.
 * Creates: <lessonRoot>/.repo/
 */
async function ensureLessonRepo(lessonRootUri) {
  const bundleUri = vscode.Uri.joinPath(lessonRootUri, 'repo.bundle');
  const repoDirUri = vscode.Uri.joinPath(lessonRootUri, '.repo');

  // If repo already exists, return it
  try {
    const stat = await vscode.workspace.fs.stat(repoDirUri);
    if (stat && stat.type === vscode.FileType.Directory) return repoDirUri.fsPath;
  } catch {}

  // If no bundle, cannot build repo
  try {
    await vscode.workspace.fs.stat(bundleUri);
  } catch {
    return null;
  }

  // Clone bundle into .repo (use Node fs for reliable behavior with git)
  fs.mkdirSync(repoDirUri.fsPath, { recursive: true });
  // git clone <bundle> <repoDir>
  // note: if target dir exists but empty, git clone still works if directory doesn't exist.
  // So we remove and recreate to be safe.
  try { fs.rmSync(repoDirUri.fsPath, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(repoDirUri.fsPath, { recursive: true });

  // Clone into a sibling dir then move (git clone requires dest not exist)
  const dest = repoDirUri.fsPath + '_tmp_' + Date.now();
  try { fs.rmSync(dest, { recursive: true, force: true }); } catch {}
  await runGit(['clone', bundleUri.fsPath, dest], lessonRootUri.fsPath);

  // Move into .repo
  try { fs.rmSync(repoDirUri.fsPath, { recursive: true, force: true }); } catch {}
  fs.renameSync(dest, repoDirUri.fsPath);

  return repoDirUri.fsPath;
}

async function deleteImportedStudentLesson(context, lessonId) {
  const storageRoot = vscode.Uri.joinPath(context.globalStorageUri, "studentLessons");
  const target = vscode.Uri.joinPath(storageRoot, lessonId);

  try {
    // VS Code fs supports recursive delete
    await vscode.workspace.fs.delete(target, { recursive: true, useTrash: false });
    return true;
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to remove lesson '${lessonId}': ${e && e.message ? e.message : String(e)}`);
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