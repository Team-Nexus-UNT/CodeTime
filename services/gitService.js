// services/gitService.js
const { execFile } = require("child_process");

function runGit(repoPath, args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: repoPath, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || err.message).toString().trim()));
        return;
      }
      resolve(stdout.toString());
    });
  });
}

async function isGitRepo(repoPath) {
  try {
    const out = await runGit(repoPath, ["rev-parse", "--is-inside-work-tree"]);
    return out.trim() === "true";
  } catch {
    return false;
  }
}

async function getCommitList(repoPath, limit = 25) {
  const SEP = "__CODETIME_SEP__";
  const format = ["%H", "%an", "%ad", "%s"].join(SEP);

  const out = await runGit(repoPath, [
    "log",
    `--max-count=${limit}`,
    `--pretty=format:${format}`,
    "--date=iso",
  ]);

  if (!out.trim()) return [];

  return out.split("\n").map((line) => {
    const [hash, author, date, message] = line.split(SEP);
    return { hash, author, date, message };
  });
}

module.exports = { runGit, isGitRepo, getCommitList };
