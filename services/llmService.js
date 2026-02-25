// services/llmService.js
// OpenAI-backed LLM helper for Student Mode 
const https = require("https");

function clampText(text, maxChars) {
  const s = String(text ?? "");
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + `\n\n[Truncated to ${maxChars} chars]`;
}

function postJson(url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);

    const req = https.request(
      {
        method: "POST",
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`OpenAI HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("OpenAI returned non-JSON response."));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(JSON.stringify(bodyObj));
    req.end();
  });
}

function buildMessages({ mode, question, scope, editor }) {
  const allowedFiles = Array.isArray(scope.allowedFiles) ? scope.allowedFiles : [];
  const commit = scope.commit || "";
  const cmeta = scope.commitMeta || {};
  const activeFile = scope.activeFile || "";

  const selectionBlock = editor?.selection?.text
    ? `Selected lines ${editor.selection.startLine}-${editor.selection.endLine}:\n${editor.selection.text}`
    : "(No selection)";

  const codeText = clampText(editor?.fullText || "", 20000);

  const system =
    `You are CodeTime's Student Mode assistant.\n` +
    `CRITICAL RULES:\n` +
    `- Only use the Lesson Context provided. Do NOT assume anything not explicitly shown.\n` +
    `- Only reference files that appear in Allowed Files.\n` +
    `- If the question needs info outside the context, reply: "Not enough information in the loaded lesson to answer that.".\n` +
    `- Be concise but clear.\n`;

  const context =
    `LESSON CONTEXT (authoritative):\n` +
    `Lesson ID: ${scope.lessonId || "(unknown)"}\n` +
    `Timeline commit: ${commit ? commit.slice(0, 12) : "(none)"}\n` +
    `Commit message: ${cmeta.message || ""}\n` +
    `Author/Date: ${cmeta.author || ""} / ${cmeta.date || ""}\n` +
    `Active file: ${activeFile || "(none)"}\n\n` +
    `Allowed files (${allowedFiles.length}):\n` +
    allowedFiles.slice(0, 200).map((f) => `- ${f}`).join("\n") +
    (allowedFiles.length > 200 ? `\n- ...and ${allowedFiles.length - 200} more` : "") +
    `\n\nIN-EDITOR CODE (current snapshot):\n` +
    codeText +
    `\n\nSELECTION:\n` +
    selectionBlock;

  const user =
    `TASK MODE: ${mode}\n` +
    `USER REQUEST:\n${question}\n\n` +
    `Answer using ONLY the Lesson Context above.`;

  return [
    { role: "system", content: system },
    { role: "developer", content: context },
    { role: "user", content: user },
  ];
}

async function askOpenAI(messages) {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY. Set it and restart VS Code.");

  const model = (process.env.CODETIME_OPENAI_MODEL || "gpt-4o-mini").trim();

  const json = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${apiKey}` },
    {
      model,
      messages,
      temperature: 0.2,
    }
  );

  const text = json?.choices?.[0]?.message?.content;
  return text || "(No response text)";
}

async function askLlm({ mode, question, scope, editor }) {
  const messages = buildMessages({ mode, question, scope, editor });
  return await askOpenAI(messages);
}

module.exports = { askLlm };