// annotations.js — Annotation decoration, hover preview, and delete support
const vscode = require('vscode');

let annotationDecorationType;

function ensureAnnotationDecorationType() {
  if (!annotationDecorationType) {
    annotationDecorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true
    });
  }
}

function disposeAnnotations() {
  if (annotationDecorationType) annotationDecorationType.dispose();
  annotationDecorationType = undefined;
}

function getFileKey(document) {
  const relative = vscode.workspace.asRelativePath(document.uri, false);
  return relative || document.uri.fsPath;
}

async function getAnnotationFileUri(document) {
  let rootUri;
  const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (wsFolder) rootUri = wsFolder.uri;
  else if (vscode.workspace.workspaceFolders?.length > 0) rootUri = vscode.workspace.workspaceFolders[0].uri;
  else rootUri = vscode.Uri.joinPath(document.uri, '..');

  const dir = vscode.Uri.joinPath(rootUri, '.codetime');
  await vscode.workspace.fs.createDirectory(dir);
  return vscode.Uri.joinPath(dir, 'annotations.json');
}

async function loadAnnotations(document) {
  try {
    const fileUri = await getAnnotationFileUri(document);
    const data = await vscode.workspace.fs.readFile(fileUri);
    const raw = Buffer.from(data).toString('utf8').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.annotations)) return parsed.annotations;
    return [];
  } catch {
    return [];
  }
}

async function saveAnnotations(document, annotations) {
  const fileUri = await getAnnotationFileUri(document);
  const payload = JSON.stringify({ annotations }, null, 2);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(payload, 'utf8'));
}

function encodeArgs(obj) {
  // Safe JSON → URI for command links in Markdown hovers
  return encodeURIComponent(JSON.stringify(obj));
}

async function refreshAnnotations(editor) {
  if (!editor) return;
  ensureAnnotationDecorationType();

  const document = editor.document;
  const all = await loadAnnotations(document);
  const fileKey = getFileKey(document);
  const current = globalThis._codetimeCurrentCommitHash ?? null;

  // If no commit selected, display everything
  const relevant = all.filter(a => {
    if (a.file !== fileKey) return false;
    if (!current) return true;

    // Show annotations that match the currently selected commit
    return a.commitHash === current;
  });


  const decorations = relevant.map(ann => {
    const preview = (ann.text || '').trim();
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = false;

    const args = { id: ann.id, file: fileKey };
    const encoded = encodeArgs(args);

    md.appendMarkdown(preview ? preview : '_(no text)_');
    md.appendMarkdown('\n\n---\n');
    md.appendMarkdown(`[Delete annotation](command:codetime.deleteAnnotation?${encoded})`);

    const line = Math.min(ann.startLine ?? ann.line ?? 0, document.lineCount - 1);
    return {
      range: new vscode.Range(line, 0, line, 0),
      hoverMessage: md,
      renderOptions: { after: {
        contentText: ` 💬 `,
        color: '#aaa',
        margin: '0 0 0 10px'
      } }
    };
  });

  editor.setDecorations(annotationDecorationType, decorations);
}

async function addAnnotationCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return vscode.window.showErrorMessage('No active editor');

  const document = editor.document;
  const selection = editor.selection;

  const startLine = selection.start.line;
  const endLine = selection.isEmpty ? startLine : selection.end.line;

  const text = await vscode.window.showInputBox({ prompt: 'Enter annotation' });
  if (!text) return;

  const all = await loadAnnotations(document);
  const fileKey = getFileKey(document);

  all.push({
    id: Date.now() + '-' + Math.random().toString(36).slice(2),
    file: fileKey,
    startLine,
    endLine,
    text,
    commitHash: globalThis._codetimeCurrentCommitHash ?? null
  });

  await saveAnnotations(document, all);
  refreshAnnotations(editor);
}

async function deleteAnnotationCommand(args) {
  try {
    if (!args?.id || !args?.file) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const document = editor.document;

    const all = await loadAnnotations(document);
    const next = all.filter(a => !(a.id === args.id && a.file === args.file));
    await saveAnnotations(document, next);
    await refreshAnnotations(editor);
    vscode.window.showInformationMessage('Annotation deleted.');
  } catch (e) {
    vscode.window.showErrorMessage('Failed to delete annotation: ' + e.message);
  }
}

function registerAnnotationSupport(context) {
  ensureAnnotationDecorationType();

  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.addAnnotation', addAnnotationCommand)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.deleteAnnotation', deleteAnnotationCommand)
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) refreshAnnotations(editor);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codetime.refreshAnnotations', () => {
      const ed = vscode.window.activeTextEditor;
      if (ed) refreshAnnotations(ed);
    })
  );
  
}

module.exports = {
  registerAnnotationSupport,
  refreshAnnotations,
  disposeAnnotations
};
