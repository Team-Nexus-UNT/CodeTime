// services/llmService.js
// OpenAI-backed LLM helper for Student Mode
const fetch = require("node-fetch");

function clampText(text, maxChars) {
  const s = String(text || "");
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + "\n\n[Truncated to " + maxChars + " chars]";
}

function buildNumberedCode(text) {
  const lines = String(text || "").split(/\r?\n/);
  return lines
    .map(function (line, index) {
      return String(index + 1).padStart(4, " ") + ": " + line;
    })
    .join("\n");
}

function parseLineQuery(question) {
  const q = String(question || "").trim();
  if (!q) return null;

  let match = q.match(/(?:lines?|line numbers?)\s+(\d+)\s*(?:-|to|through|thru)\s*(\d+)/i);
  if (match) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      return {
        startLine: Math.min(start, end),
        endLine: Math.max(start, end)
      };
    }
  }

  match = q.match(/(?:line)\s+(\d+)/i);
  if (match) {
    const line = Number(match[1]);
    if (Number.isFinite(line)) {
      return { startLine: line, endLine: line };
    }
  }

  return null;
}

function shouldDirectlyAnswerLineQuery(question) {
  const q = String(question || "").trim().toLowerCase();
  if (!q) return false;

  const hasLineReference = /\bline\s+\d+\b|\blines\s+\d+\s*(?:-|to|through|thru)\s*\d+\b/i.test(q);
  if (!hasLineReference) return false;

  const explanationWords = [
    "mean",
    "means",
    "explain",
    "why",
    "how",
    "do",
    "does",
    "doing",
    "purpose",
    "used",
    "use",
    "work",
    "works"
  ];

  const hasExplanationIntent = explanationWords.some(function (word) {
    return q.indexOf(word) !== -1;
  });

  if (hasExplanationIntent) {
    return false;
  }

  return /\b(what is on|what's on|show|display|give me|tell me|contents? of)\b/i.test(q);
}

function getLineSnippet(fullText, range) {
  if (!range) return null;

  const lines = String(fullText || "").split(/\r?\n/);
  if (!lines.length) {
    return {
      ok: false,
      text: "No code is loaded in the editor.",
      totalLines: 0
    };
  }

  if (range.startLine < 1 || range.startLine > lines.length) {
    return {
      ok: false,
      text: "That line number is outside the current file. This file has " + lines.length + " lines.",
      totalLines: lines.length
    };
  }

  const endLine = Math.min(range.endLine, lines.length);
  const selected = [];

  for (let i = range.startLine; i <= endLine; i += 1) {
    selected.push("Line " + i + ": " + lines[i - 1]);
  }

  return {
    ok: true,
    text: selected.join("\n"),
    totalLines: lines.length,
    startLine: range.startLine,
    endLine: endLine
  };
}

function buildMessages(params) {
  const mode = params.mode;
  const question = params.question;
  const scope = params.scope || {};
  const editor = params.editor || {};

  const allowedFiles = Array.isArray(scope.allowedFiles) ? scope.allowedFiles : [];
  const commit = scope.commit || "";
  const cmeta = scope.commitMeta || {};
  const activeFile = scope.activeFile || "";
  const rawCodeText = String(editor.fullText || "");
  const parsedRange = parseLineQuery(question);
  const lineSnippet = getLineSnippet(rawCodeText, parsedRange);

  const selectionBlock = editor.selection && editor.selection.text
    ? "Selected lines " + editor.selection.startLine + "-" + editor.selection.endLine + ":\n" + editor.selection.text
    : "(No selection)";

  const codeText = clampText(rawCodeText, 20000);
  const numberedCode = clampText(buildNumberedCode(rawCodeText), 26000);

  const commitRules = mode === "commit"
    ? "\nCOMMIT MODE RULES:\n" +
      "- The user is asking about the current commit.\n" +
      "- Use the commit message and the visible code snapshot to explain what likely changed and why.\n" +
      "- If the commit question truly cannot be answered from the lesson context, say so.\n"
    : "";

  const lineRules = parsedRange
    ? "\nLINE REFERENCE RULES:\n" +
      "- The user referenced line " + parsedRange.startLine + (parsedRange.endLine !== parsedRange.startLine ? (" through line " + parsedRange.endLine) : "") + ".\n" +
      "- If the user asks what is on that line, quote it exactly from the numbered code.\n" +
      "- If the user asks what something on that line means or does, explain it instead of only repeating the text.\n"
    : "";

  const system =
    "You are CodeTime's Student Mode assistant.\n" +
    "RULES:\n" +
    "- Use the lesson context as the source of truth.\n" +
    "- You may explain standard programming concepts that are visible in the current code, even if the lesson author did not explicitly define them.\n" +
    "- For line-number questions, respect the numbered code block exactly, including blank lines.\n" +
    "- If the user asks what code is on a line, answer with the exact line content.\n" +
    "- If the user asks what code on a line means or does, explain the code on that line in plain language and mention the exact line when useful.\n" +
    "- Only say 'Not enough information in the loaded lesson to answer that.' when the answer depends on missing project or lesson context.\n" +
    "- Be concise but clear.\n" +
    commitRules +
    lineRules;

  const lineContext = parsedRange
    ? "\n\nLINE FOCUS:\n" + (lineSnippet ? lineSnippet.text : "Unable to resolve the requested line.")
    : "";

  const context =
    "LESSON CONTEXT:\n" +
    "Lesson ID: " + (scope.lessonId || "(unknown)") + "\n" +
    "Timeline commit: " + (commit ? commit.slice(0, 12) : "(none)") + "\n" +
    "Commit message: " + (cmeta.message || "") + "\n" +
    "Author/Date: " + (cmeta.author || "") + " / " + (cmeta.date || "") + "\n" +
    "Active file: " + (activeFile || "(none)") + "\n\n" +
    "Allowed files (" + allowedFiles.length + "):\n" +
    allowedFiles.slice(0, 200).map(function (f) { return "- " + f; }).join("\n") +
    (allowedFiles.length > 200 ? "\n- ...and " + (allowedFiles.length - 200) + " more" : "") +
    "\n\nCURRENT CODE:\n" + codeText +
    "\n\nNUMBERED CODE:\n" + numberedCode +
    lineContext +
    "\n\nSELECTION:\n" + selectionBlock;

  const user =
    "TASK MODE: " + mode + "\n" +
    "USER REQUEST:\n" + question + "\n\n" +
    "Answer using the lesson context and the visible code.";

  return [
    { role: "system", content: system },
    { role: "developer", content: context },
    { role: "user", content: user }
  ];
}

async function askLlm(params) {
  const mode = params.mode;
  const question = params.question;
  const scope = params.scope;
  const editor = params.editor;

  try {
    if (shouldDirectlyAnswerLineQuery(question)) {
      const directSnippet = getLineSnippet(editor && editor.fullText ? editor.fullText : "", parseLineQuery(question));
      if (directSnippet && directSnippet.text) {
        return directSnippet.text;
      }
    }

    const messages = buildMessages({
      mode: mode,
      question: question,
      scope: scope,
      editor: editor
    });

    const response = await fetch("https://codetime-backend.onrender.com/api/llm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        question: question,
        mode: mode,
        context: messages
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error("LLM backend HTTP " + response.status + ": " + text.slice(0, 300));
    }

    const data = await response.json();

    if (data && typeof data.text === "string" && data.text.trim()) {
      return data.text.trim();
    }

    return "The LLM returned an empty response.";
  } catch (err) {
    console.error("LLM backend error:", err);
    return "Error connecting to LLM backend.";
  }
}

module.exports = { askLlm };
