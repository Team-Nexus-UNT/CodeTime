// services/gitService.js
// Centralized git helpers used by Instructor & Student modes.
const { execFileSync } = require("child_process");
const path = require("path");

function runGit(repoPath, args, opts = {}) {
  // Always run in repoPath and return stdout as string.
  return execFileSync("git", args, {
    cwd: repoPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

async function isGitRepo(repoPath) {
  try {
    const out = runGit(repoPath, ["rev-parse", "--is-inside-work-tree"]).trim();
    return out === "true";
  } catch {
    return false;
  }
}

function parseCommitLines(raw) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const commits = [];
  for (const line of lines) {
    const parts = line.split("\x1f"); // unit separator
    if (parts.length < 4) continue;
    const [hash, author, date, message] = parts;
    commits.push({ hash, author, date, message });
  }
  return commits;
}

async function getCommitList(repoPath, limit = 25) {
  const n = Number.isFinite(limit) ? Math.max(1, Math.min(500, limit)) : 25;
  const raw = runGit(repoPath, [
    "log",
    `-n`,
    String(n),
    "--pretty=format:%H%x1f%an%x1f%ad%x1f%s",
    "--date=iso",
  ]);
  return parseCommitLines(raw);
}

async function getCommitInfoForHashes(repoPath, hashes) {
  if (!Array.isArray(hashes) || !hashes.length) return [];
  const out = [];
  for (const h of hashes) {
    const hash = String(h || "").trim();
    if (!hash) continue;
    try {
      const raw = runGit(repoPath, [
        "show",
        "-s",
        "--pretty=format:%H%x1f%an%x1f%ad%x1f%s",
        "--date=iso",
        hash,
      ]);
      const parsed = parseCommitLines(raw);
      if (parsed[0]) out.push(parsed[0]);
    } catch {
      // skip missing hashes (e.g., lesson exported from a different repo state)
    }
  }
  return out;
}

function normalizeToRepoRelative(repoRoot, filePath) {
  let normalized = String(filePath ?? "");
  if (!normalized) throw new Error("Invalid file path provided to gitService.");

  // Normalize slashes for consistent handling
  normalized = normalized.replace(/\\/g, "/");
  const repoRootNormalized = String(repoRoot ?? "").replace(/\\/g, "/").replace(/\/$/, "");
  const repoBase = repoRootNormalized ? repoRootNormalized.split("/").filter(Boolean).pop() : "";

  // 1) If the path starts with the current repo root, strip it.
  if (repoRootNormalized && normalized.toLowerCase().startsWith(repoRootNormalized.toLowerCase())) {
    normalized = normalized.substring(repoRootNormalized.length);
  }

  // 2) If the path contains "/<repoBase>/" (common when instructor exported absolute paths),
  // strip everything up to and including that segment.
  if (repoBase) {
    const needle = `/${repoBase}/`.toLowerCase();
    const idx = normalized.toLowerCase().lastIndexOf(needle);
    if (idx !== -1) {
      normalized = normalized.substring(idx + needle.length);
    }
  }

  // Trim leading slashes
  normalized = normalized.replace(/^\/+/g, "");

  // Helper: check if a candidate exists in HEAD
  const existsInHead = (candidate) => {
    try {
      runGit(repoRoot, ["cat-file", "-e", `HEAD:${candidate}`]);
      return true;
    } catch {
      return false;
    }
  };

  // 3) If still looks absolute (drive letter, or contains colon), try to recover by scanning suffixes
  // and picking the first suffix that exists in the repo.
  const looksAbsolute = /^[A-Za-z]:\//.test(normalized) || normalized.includes(":");
  if (looksAbsolute) {
    // remove drive prefix like "C:/"
    normalized = normalized.replace(/^[A-Za-z]:\//, "");
    normalized = normalized.replace(/^\/+/g, "");

    const parts = normalized.split("/").filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const candidate = parts.slice(i).join("/");
      if (existsInHead(candidate)) {
        return candidate;
      }
    }

    throw new Error("Path normalization failed: " + filePath);
  }

  // 4) If it's relative but still not found, also try suffix recovery (handles extra leading folders)
  if (normalized && !existsInHead(normalized)) {
    const parts = normalized.split("/").filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const candidate = parts.slice(i).join("/");
      if (existsInHead(candidate)) {
        return candidate;
      }
    }
  }

  if (!normalized) throw new Error("Path normalization failed: " + filePath);
  return normalized;
}


async function fileExistsAtCommit(repoPath, commitHash, fileRelPath) {
  try {
    const rel = normalizeToRepoRelative(repoPath, fileRelPath);
    runGit(repoPath, ["cat-file", "-e", `${commitHash}:${rel}`]);
    return true;
  } catch {
    return false;
  }
}

async function getFileAtCommit(repoPath, commitHash, fileRelPath) {
  const rel = normalizeToRepoRelative(repoPath, fileRelPath);
  try {
    return runGit(repoPath, ["show", `${commitHash}:${rel}`]);
  } catch (err) {
    // Normal during playback: the file may not exist at this commit.
    return null;
  }
}

module.exports = {
  runGit,
  isGitRepo,
  getCommitList,
  getCommitInfoForHashes,
  fileExistsAtCommit,
  getFileAtCommit,
};
