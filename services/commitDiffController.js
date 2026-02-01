// services/commitDiffController.js
const vscode = require('vscode');
const path = require('path');

let commitProvider = null;

// inline diff decorations
const addedLineDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground')
});

const modifiedLineDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor('diffEditor.modifiedTextBackground')
});

const removedMarkerDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground')
});

// active file helper
function getActiveFileInfo() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;

  const wsFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!wsFolder) return null;

  const repoPath = wsFolder.uri.fsPath;
  const absPath = editor.document.uri.fsPath;
  const relPath = path.relative(repoPath, absPath);

  return {
    repoPath,
    absPath,
    relPath,
    languageId: editor.document.languageId
  };
}

// commit snapshot content provider
class CommitSnapshotProvider {
  constructor(gitService) {
    this.gitService = gitService;
    this._emitter = new vscode.EventEmitter();
    this.onDidChange = this._emitter.event;
    this.targets = new Map();
  }

  makeUri(relPath) {
    return vscode.Uri.from({ scheme: 'codetime', path: '/' + relPath });
  }

  setTarget(relPath, repoPath, commitHash, languageId) {
    this.targets.set(relPath, { repoPath, commitHash, languageId });
    this._emitter.fire(this.makeUri(relPath));
  }

  async provideTextDocumentContent(uri) {
    const relPath = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
    const target = this.targets.get(relPath);

    if (!target) {
      return 'CodeTime: No commit selected for this file.';
    }

    const { repoPath, commitHash } = target;

    const exists = await this.gitService.fileExistsAtCommit(
      repoPath,
      commitHash,
      relPath
    );

    if (!exists) {
      return `CodeTime: File not found at commit ${commitHash}\n\n${relPath}`;
    }

    return this.gitService.getFileAtCommit(repoPath, commitHash, relPath);
  }
}

function initCommitSnapshots(context, gitService) {
  if (commitProvider) return commitProvider;

  commitProvider = new CommitSnapshotProvider(gitService);

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      'codetime',
      commitProvider
    )
  );

  return commitProvider;
}

// inline diff computation + application
function computeLineHighlights(parentText, currentText) {
  const a = parentText.split(/\r?\n/);
  const b = currentText.split(/\r?\n/);

  const max = Math.max(a.length, b.length);
  const added = [];
  const modified = [];
  const removedMarkers = new Map();

  for (let i = 0; i < max; i++) {
    const pa = a[i];
    const cb = b[i];

    if (pa === undefined && cb !== undefined) {
      added.push(i);
      continue;
    }

    if (cb === undefined && pa !== undefined) {
      const markerLine = Math.max(0, b.length - 1);
      if (!removedMarkers.has(markerLine)) {
        removedMarkers.set(markerLine, []);
      }
      removedMarkers.get(markerLine).push(pa);
      continue;
    }

    if (pa !== cb) {
      modified.push(i);
    }
  }

  return { added, modified, removedMarkers };
}

function applyInlineDiffDecorations(editor, parentText, currentText) {
  const { added, modified, removedMarkers } =
    computeLineHighlights(parentText, currentText);

  const addedRanges = added.map(
    (line) =>
      new vscode.Range(
        new vscode.Position(line, 0),
        new vscode.Position(line, 0)
      )
  );

  const modifiedRanges = modified.map(
    (line) =>
      new vscode.Range(
        new vscode.Position(line, 0),
        new vscode.Position(line, 0)
      )
  );

  const removedRanges = [];
  for (const [line, removedLines] of removedMarkers.entries()) {
    const hover = new vscode.MarkdownString(
      `**Removed line(s) near here:**\n\n` +
        removedLines
          .slice(0, 6)
          .map((s) => `- \`${s}\``)
          .join('\n') +
        (removedLines.length > 6
          ? `\n- …and ${removedLines.length - 6} more`
          : '')
    );

    removedRanges.push({
      range: new vscode.Range(
        new vscode.Position(line, 0),
        new vscode.Position(line, 0)
      ),
      hoverMessage: hover
    });
  }

  editor.setDecorations(addedLineDecoration, addedRanges);
  editor.setDecorations(modifiedLineDecoration, modifiedRanges);
  editor.setDecorations(removedMarkerDecoration, removedRanges);
}

// commands
async function showFileAtCommit(gitService, commitHashArg) {
  const fileInfo = getActiveFileInfo();
  if (!fileInfo) {
    vscode.window.showErrorMessage(
      'CodeTime: Open a file inside a workspace.'
    );
    return;
  }

  const commitHash =
    commitHashArg ||
    (await vscode.window.showInputBox({
      prompt: 'Enter Git commit hash',
      placeHolder: 'e.g. a1b2c3d'
    }));

  if (!commitHash) return;

  const { repoPath, relPath, languageId } = fileInfo;

  const isRepo = await gitService.isGitRepo(repoPath);
  if (!isRepo) {
    vscode.window.showErrorMessage(
      'CodeTime: This workspace is not a Git repository.'
    );
    return;
  }

  const exists = await gitService.fileExistsAtCommit(
    repoPath,
    commitHash,
    relPath
  );
  if (!exists) {
    vscode.window.showErrorMessage(
      'CodeTime: File does not exist in this commit.'
    );
    return;
  }

  if (!commitProvider) {
    vscode.window.showErrorMessage(
      'CodeTime: Commit snapshot provider not initialized.'
    );
    return;
  }

  commitProvider.setTarget(relPath, repoPath, commitHash, languageId);
  const uri = commitProvider.makeUri(relPath);

  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, {
    preview: false
  });

  await vscode.languages.setTextDocumentLanguage(doc, languageId);

  try {
    const parent = await gitService.getParentCommit(repoPath, commitHash);
    const parentText = await gitService.getFileAtCommit(
      repoPath,
      parent,
      relPath
    );
    const currentText = await gitService.getFileAtCommit(
      repoPath,
      commitHash,
      relPath
    );

    applyInlineDiffDecorations(editor, parentText, currentText);
  } catch {
    editor.setDecorations(addedLineDecoration, []);
    editor.setDecorations(modifiedLineDecoration, []);
    editor.setDecorations(removedMarkerDecoration, []);
  }
}

async function showDiffForCommit(gitService, commitHashArg) {
  const fileInfo = getActiveFileInfo();
  if (!fileInfo) {
    vscode.window.showErrorMessage(
      'CodeTime: Open a file inside a workspace.'
    );
    return;
  }

  const commitHash =
    commitHashArg ||
    (await vscode.window.showInputBox({
      prompt: 'Enter Git commit hash',
      placeHolder: 'e.g. a1b2c3d'
    }));

  if (!commitHash) return;

  const { repoPath, relPath, languageId } = fileInfo;

  const parent = await gitService.getParentCommit(repoPath, commitHash);
  const currentContent = await gitService.getFileAtCommit(
    repoPath,
    commitHash,
    relPath
  );
  const parentContent = await gitService.getFileAtCommit(
    repoPath,
    parent,
    relPath
  );

  const leftDoc = await vscode.workspace.openTextDocument({
    content: parentContent,
    language: languageId
  });

  const rightDoc = await vscode.workspace.openTextDocument({
    content: currentContent,
    language: languageId
  });

  await vscode.commands.executeCommand(
    'vscode.diff',
    leftDoc.uri,
    rightDoc.uri,
    `CodeTime Diff: ${relPath} (${parent.slice(0, 7)} → ${commitHash.slice(0, 7)})`
  );
}

module.exports = {
  initCommitSnapshots,
  showFileAtCommit,
  showDiffForCommit
};