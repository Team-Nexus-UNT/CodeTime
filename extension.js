// extension.js — CodeTime: Audio/Video Upload + Annotations (modular)
const vscode = require('vscode');
const path = require('path');

// Views
const { PlaybackProvider } = require('./services/playbackProvider');
const HomeViewProvider = require('./homeView');
const InstructorDashboardViewProvider = require('./instructorDashboardView');
const { StudentHomeViewProvider } = require('./studentHomeView');

// Feature modules
const { uploadAudioCommand } = require('./audioStorage');
const { uploadVideoCommand } = require('./videoStorage');
const {
  registerAnnotationSupport,
  refreshAnnotations,
  disposeAnnotations,
} = require('./annotations');

// Git integration (Sprint 4)
const gitService = require('./services/gitService');
const {
  initCommitSnapshots,
  showDiffForCommit,
  showFileAtCommit,
} = require('./services/commitDiffController');

// Walkthrough storage/actions
const walkthroughStorage = require('./walkthroughStorage');
const { exportWalkthroughPackage } = require('./services/exportService');

const LANGUAGE_ID_BY_EXTENSION = {
  js: 'javascript',
  jsx: 'javascriptreact',
  ts: 'typescript',
  tsx: 'typescriptreact',
  html: 'html',
  css: 'css',
  json: 'json',
  md: 'markdown',
  py: 'python',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  php: 'php',
  xml: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shellscript',
};


const studentChangedLineDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
  overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.modifiedForeground'),
  overviewRulerLane: vscode.OverviewRulerLane.Right,
  
});

const studentRemovedAnchorDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
  overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
  overviewRulerLane: vscode.OverviewRulerLane.Right,
  
});

function clearStudentDiffDecorations(editor) {
  if (!editor) return;
  editor.setDecorations(studentChangedLineDecoration, []);
  editor.setDecorations(studentRemovedAnchorDecoration, []);
}

async function applyStudentDiffDecorations(editor, repoPath, fileRelPath, compareCommitHash, commitHash) {
  if (!editor || !repoPath || !fileRelPath || !commitHash) {
    clearStudentDiffDecorations(editor);
    return;
  }

  try {
    const diffInfo = await gitService.getChangedLineRanges(
      repoPath,
      compareCommitHash || null,
      commitHash,
      fileRelPath
    );

    const docLineCount = Math.max(1, editor.document.lineCount || 1);
    const changedRanges = (diffInfo.changedLines || [])
      .filter((lineNumber) => lineNumber >= 1 && lineNumber <= docLineCount)
      .map((lineNumber) => {
        const lineIndex = lineNumber - 1;
        const line = editor.document.lineAt(lineIndex);
        return new vscode.Range(line.range.start, line.range.end);
      });

    const removalRanges = (diffInfo.removalAnchors || [])
      .map((lineNumber) => Math.min(Math.max(1, lineNumber), docLineCount) - 1)
      .map((lineIndex) => {
        const line = editor.document.lineAt(lineIndex);
        return {
          range: new vscode.Range(line.range.start, line.range.start),
          hoverMessage: new vscode.MarkdownString('Lines existed in the previous commit but were removed before this snapshot.'),
        };
      });

    editor.setDecorations(studentChangedLineDecoration, changedRanges);
    editor.setDecorations(studentRemovedAnchorDecoration, removalRanges);
  } catch {
    clearStudentDiffDecorations(editor);
  }
}

/* ============================================================================
   ACTIVATE
============================================================================ */
async function activate(context) {
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  initCommitSnapshots(context, gitService);

  const registerCommand = (commandId, handler) => {
    context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
  };

  const setMode = async (mode) => {
    await context.globalState.update('codetime.mode', mode);
    await vscode.commands.executeCommand('setContext', 'codetime.mode', mode);
  };

  const focusView = async (containerCommand, focusCommand) => {
    await vscode.commands.executeCommand(containerCommand);
    try {
      await vscode.commands.executeCommand(focusCommand);
    } catch {}
  };

  const playbackProvider = new PlaybackProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('codetime-playback', playbackProvider)
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codetime.homeView', new HomeViewProvider(context)),
    vscode.window.registerWebviewViewProvider(
      'codetime.instructor.dashboard',
      new InstructorDashboardViewProvider(context, gitService)
    ),
    vscode.window.registerWebviewViewProvider(
      'codetime.studentHomeView',
      new StudentHomeViewProvider(context)
    )
  );

  await setMode('none');

  registerCommand('codetime.chooseInstructor', async () => {
    await setMode('instructor');
    await focusView('workbench.view.extension.codetimeInstructor', 'codetime.instructor.dashboard.focus');
  });

  registerCommand('codetime.chooseStudent', async () => {
    await setMode('student');
    await focusView('workbench.view.extension.codetimeStudent', 'codetime.studentHomeView.focus');
  });

  registerCommand('codetime.backToHome', async () => {
    await setMode('none');
    await focusView('workbench.view.extension.codetimeHome', 'codetime.homeView.focus');
  });

  registerCommand('codetime.test', () => {
    vscode.window.showInformationMessage('CodeTime activated ✔');
  });

  registerCommand('codetime.addWalkthroughStep', async (walkthroughId) => {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('CodeTime: Open a file to capture a walkthrough step.');
        return null;
      }

      const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const fileAbs = editor.document.uri.fsPath;
      const fileRel = repoPath ? path.relative(repoPath, fileAbs) : editor.document.fileName;
      const line = editor.selection.active.line + 1;

      let commitHash = globalThis._codetimeCurrentCommitHash;
      if (!commitHash && repoPath) {
        const head = await gitService.runGit(repoPath, ['rev-parse', 'HEAD']);
        commitHash = (head || '').trim();
      }

      const label = await vscode.window.showInputBox({
        prompt: 'Step title (optional)',
        placeHolder: `Example: Explain ${path.basename(fileRel)}`,
      });

      const note = await vscode.window.showInputBox({
        prompt: 'Step note (optional)',
        placeHolder: 'What should the student notice here?',
      });

      const updated = walkthroughStorage.addStepToWalkthrough(walkthroughId, {
        label: label || `Step @ ${fileRel}:${line}`,
        file: fileRel,
        line,
        commitHash: commitHash || '',
        note: note || '',
      });

      if (!updated) {
        vscode.window.showErrorMessage('CodeTime: Walkthrough not found.');
        return null;
      }

      vscode.window.showInformationMessage('CodeTime: Added walkthrough step ✔');
      return updated;
    } catch (error) {
      console.error('codetime.addWalkthroughStep error:', error);
      vscode.window.showErrorMessage('CodeTime: Failed to add walkthrough step. Check Dev Tools console.');
      return null;
    }
  });

  registerCommand('codetime.playWalkthrough', async (walkthroughId) => {
    try {
      const wt = walkthroughStorage.getWalkthroughById(walkthroughId);
      if (!wt) {
        vscode.window.showErrorMessage('CodeTime: Walkthrough not found.');
        return;
      }
      if (!Array.isArray(wt.steps) || wt.steps.length === 0) {
        vscode.window.showInformationMessage('CodeTime: This walkthrough has no steps yet.');
        return;
      }

      const picked = await vscode.window.showQuickPick(
        wt.steps.map((step, idx) => ({
          label: `${idx + 1}. ${step.label || 'Untitled Step'}`,
          description: step.commitHash ? `commit ${String(step.commitHash).slice(0, 8)}` : '',
          detail: step.file ? `${step.file}${step.line ? `:${step.line}` : ''}` : '',
          step,
        })),
        { placeHolder: 'Choose a step to play' }
      );

      if (!picked) return;
      const { step } = picked;

      if (step.commitHash) {
        globalThis._codetimeCurrentCommitHash = step.commitHash;
        await vscode.commands.executeCommand('codetime.showFileAtCommit', step.commitHash, step.file);
      } else if (step.file) {
        const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const uri = repoPath ? vscode.Uri.file(path.join(repoPath, step.file)) : vscode.Uri.file(step.file);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      }

      const editor = vscode.window.activeTextEditor;
      if (editor && step.line) {
        const pos = new vscode.Position(Math.max(0, step.line - 1), 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }

      vscode.window.showInformationMessage('CodeTime: Walkthrough step opened ✔');
    } catch (error) {
      console.error('codetime.playWalkthrough error:', error);
      vscode.window.showErrorMessage('CodeTime: Failed to play walkthrough. Check Dev Tools console.');
    }
  });

  const getPlaybackUri = (key) =>
    vscode.Uri.from({
      scheme: 'codetime-playback',
      path: key,
    });

  registerCommand('codetime.playback.open', async ({ key }) => {
    const uri = getPlaybackUri(key);
    playbackProvider.setContent(uri, `Playback Mode\n\nKey: ${key}\n`);

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });

    return { uri: uri.toString() };
  });

  registerCommand('codetime.playback.setContent', async ({ key, content }) => {
    const uri = getPlaybackUri(key);
    playbackProvider.setContent(uri, content ?? '');
    return { uri: uri.toString() };
  });

  registerCommand('codetime.student.openSnapshot', async ({ repoPath, commitHash, compareCommitHash, fileRelPath, key, userInitiated }) => {
    if (!repoPath || !commitHash || !fileRelPath || !key) {
      vscode.window.showErrorMessage('CodeTime Student: missing repoPath/commitHash/fileRelPath/key');
      return;
    }

    const isRepo = await gitService.isGitRepo(repoPath);
    if (!isRepo) {
      vscode.window.showErrorMessage('CodeTime Student: lesson repo is not a valid Git repo.');
      return;
    }

    const exists = await gitService.fileExistsAtCommit(repoPath, commitHash, fileRelPath);
    if (!exists) {
      if (userInitiated) {
        vscode.window.showInformationMessage('This file does not exist in the selected commit.');
      }
      return;
    }

    const content = await gitService.getFileAtCommit(repoPath, commitHash, fileRelPath);
    const uri = vscode.Uri.from({ scheme: 'codetime-playback', path: key });
    playbackProvider.setContent(uri, content ?? '');

    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });

    const languageId = guessLanguageId(fileRelPath);
    try {
      await vscode.languages.setTextDocumentLanguage(doc, languageId);
    } catch {}

    await applyStudentDiffDecorations(editor, repoPath, fileRelPath, compareCommitHash, commitHash);

    return { uri: uri.toString() };
  });

  registerCommand('codetime.debugGitCommits', async () => {
    try {
      const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!repoPath) {
        vscode.window.showErrorMessage('CodeTime: No workspace folder open.');
        return;
      }

      const isRepo = await gitService.isGitRepo(repoPath);
      if (!isRepo) {
        vscode.window.showErrorMessage('CodeTime: This workspace is not a Git repository.');
        return;
      }

      const commits = await gitService.getCommitList(repoPath, 10);
      console.log('CodeTime commits:', commits);
      vscode.window.showInformationMessage(`CodeTime: Loaded ${commits.length} commits (see Debug Console).`);
    } catch (error) {
      vscode.window.showErrorMessage(`CodeTime Git error: ${error?.message || error}`);
    }
  });

  registerCommand('codetime.showFileAtCommit', async (commitHash) => {
    try {
      await showFileAtCommit(gitService, commitHash);
    } catch (error) {
      vscode.window.showErrorMessage(`CodeTime show-file error: ${error?.message || error}`);
    }
  });

  registerCommand('codetime.showDiffForCommit', async (commitHash) => {
    try {
      await showDiffForCommit(gitService, commitHash);
    } catch (error) {
      vscode.window.showErrorMessage(`CodeTime diff error: ${error?.message || error}`);
    }
  });

  registerCommand('codetime.openInstructorMode', async () => {
    await vscode.commands.executeCommand('codetime.chooseInstructor');
  });

  registerCommand('codetime.uploadAudio', () => uploadAudioCommand(context));
  registerCommand('codetime.uploadVideo', () => uploadVideoCommand(context));

  registerCommand('codetime.exportPackage', async () => {
    try {
      await exportWalkthroughPackage();
    } catch (error) {
      vscode.window.showErrorMessage(`CodeTime export error: ${error?.message || error}`);
    }
  });

  registerCommand('codetime.recordVideo', () => vscode.commands.executeCommand('codetime.uploadVideo'));

  registerCommand('codetime.openStudentMode', async () => {
    await vscode.commands.executeCommand('codetime.chooseStudent');
  });

  registerCommand('codetime.importStudentLesson', async () => {
    await vscode.commands.executeCommand('codetime.chooseStudent');
    vscode.window.showInformationMessage("Use the 'Import Lesson' button in the Student view.");
  });

  registerAnnotationSupport(context);

  if (vscode.window.activeTextEditor) {
    refreshAnnotations(vscode.window.activeTextEditor);
  }
}

function guessLanguageId(fileRelPath) {
  const lower = String(fileRelPath || '').toLowerCase();
  const ext = lower.includes('.') ? lower.split('.').pop() : '';
  return LANGUAGE_ID_BY_EXTENSION[ext] || 'plaintext';
}

function deactivate() {
  try {
    disposeAnnotations();
  } catch {}
}

module.exports = { activate, deactivate };
