#!/usr/bin/env node

/**
 * Auto-Commit Bot — fastest possible commits without rate limits.
 * Watches the repo, stages changes, commits + pushes on every file change.
 * Uses batching + debounce to group rapid bursts into single commits.
 */

const { watch, readdirSync, statSync } = require("fs");
const { join } = require("path");
const { execSync } = require("child_process");

// ── Config ──────────────────────────────────────────────────────────────────
const DEBOUNCE_MS = parseInt(process.env.DEBOUNCE_MS || "300", 10);
const COMMIT_PREFIX = process.env.COMMIT_PREFIX || "auto";
const AUTO_PUSH = process.env.AUTO_PUSH !== "false";
const COMMITTER_NAME = process.env.COMMITTER_NAME || "auto-commit-bot";
const COMMITTER_EMAIL = process.env.COMMITTER_EMAIL || "bot@auto-commit.dev";
const WATCH_DIR = process.argv[2] || process.cwd();
// ────────────────────────────────────────────────────────────────────────────

let timer = null;
let dirty = false;
let pushFailures = 0;
let totalCommits = 0;
let totalPushes = 0;
let totalErrors = 0;
const MAX_BACKOFF = 30_000;

// ── Colors ──────────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

// ── Logger ──────────────────────────────────────────────────────────────────
function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function log(tag, color, msg) {
  process.stdout.write(
    `${c.gray}[${ts()}]${c.reset} ${color}${tag}${c.reset} ${msg}\n`
  );
}

function step(stepNum, msg) {
  process.stdout.write(
    `${c.gray}[${ts()}]${c.reset} ${c.cyan}STEP ${stepNum}${c.reset} ${c.dim}${msg}${c.reset}\n`
  );
}

// ── Git helpers ─────────────────────────────────────────────────────────────
function git(args, silent) {
  try {
    const out = execSync(`git ${args}`, {
      cwd: WATCH_DIR,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: COMMITTER_NAME,
        GIT_AUTHOR_EMAIL: COMMITTER_EMAIL,
        GIT_COMMITTER_NAME: COMMITTER_NAME,
        GIT_COMMITTER_EMAIL: COMMITTER_EMAIL,
      },
    }).trim();
    return { ok: true, out };
  } catch (e) {
    const stderr = e.stderr ? e.stderr.trim() : e.message;
    if (!silent) {
      log("ERROR", c.red, stderr);
      totalErrors++;
    }
    return { ok: false, out: stderr };
  }
}

function hasChanges() {
  const r = git("status --porcelain", true);
  return r.ok && r.out.length > 0 ? r.out : null;
}

// ── Core ────────────────────────────────────────────────────────────────────
function commit() {
  const changes = hasChanges();
  if (!changes) return;

  const files = changes.split("\n");
  const count = files.length;

  // Step 1: Detect
  step(1, `Detected ${count} changed file${count > 1 ? "s" : ""}`);
  files.forEach((f) => {
    const status = f.slice(0, 2).trim();
    const name = f.slice(3);
    const sym =
      { A: "+", M: "~", D: "-", R: ">", "?": "?" }[status[0]] ||
      status[0] ||
      "?";
    process.stdout.write(
      `${c.gray}          ${c.yellow}${sym}${c.reset} ${c.dim}${name}${c.reset}\n`
    );
  });

  // Step 2: Stage
  step(2, "Staging all changes...");
  const addResult = git("add -A");
  if (!addResult.ok) {
    log("FAIL", c.red, "Could not stage files");
    return;
  }
  log("  OK", c.green, `Staged ${count} file${count > 1 ? "s" : ""}`);

  // Step 3: Commit
  const msg = `${COMMIT_PREFIX}: ${ts()}`;
  step(3, `Creating commit...`);
  const commitResult = git(`commit -m "${msg}"`);
  if (!commitResult.ok) {
    log("SKIP", c.yellow, "Nothing to commit (working tree clean)");
    dirty = false;
    return;
  }

  totalCommits++;
  const short = git("rev-parse --short HEAD", true);
  const hash = short.ok ? short.out : "???";
  log("DONE", c.green, `Committed ${c.bold}${hash}${c.reset} ${c.dim}— ${msg}${c.reset}`);

  // Step 4: Push
  if (AUTO_PUSH) {
    push();
  }

  dirty = false;
}

function push() {
  step(4, "Pushing to remote...");
  const r = git("push");
  if (r.ok) {
    pushFailures = 0;
    totalPushes++;
    log("DONE", c.green, `Pushed to origin (${c.bold}${totalPushes} total pushes${c.reset})`);
    printStats();
  } else {
    pushFailures++;
    const delay = Math.min(MAX_BACKOFF, 1000 * 2 ** (pushFailures - 1));
    log("WARN", c.red, `Push failed (${pushFailures}x) — retrying in ${(delay / 1000).toFixed(1)}s`);
    log("ERR ", c.red, r.out);
    setTimeout(push, delay);
  }
}

function printStats() {
  process.stdout.write(
    `${c.gray}          stats: ${c.green}${totalCommits} commits${c.gray} | ${c.cyan}${totalPushes} pushes${c.gray} | ${c.red}${totalErrors} errors${c.reset}\n`
  );
}

// ── Watcher ─────────────────────────────────────────────────────────────────
function scheduleCommit() {
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    commit();
  }, DEBOUNCE_MS);
}

function watchRecursive(dir) {
  if (dir.includes(".git") || dir.includes("node_modules")) return;

  try {
    watch(dir, { persistent: true, recursive: false }, (event, file) => {
      if (!file || file.startsWith(".git")) return;
      const full = join(dir, file);
      try {
        if (statSync(full).isDirectory()) {
          watchRecursive(full);
        }
      } catch {}
      log("WATCH", c.magenta, `${event} — ${relative(WATCH_DIR, full)}`);
      scheduleCommit();
    });
  } catch {}

  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      if (entry.isDirectory()) watchRecursive(join(dir, entry.name));
    }
  } catch {}
}

// ── Main ────────────────────────────────────────────────────────────────────
process.stdout.write(
  [
    "",
    `${c.cyan}${c.bold}  ╔══════════════════════════════════════╗${c.reset}`,
    `${c.cyan}${c.bold}  ║       AUTO-COMMIT BOT  v2.0          ║${c.reset}`,
    `${c.cyan}${c.bold}  ╚══════════════════════════════════════╝${c.reset}`,
    "",
    `  ${c.dim}watching :${c.reset} ${WATCH_DIR}`,
    `  ${c.dim}debounce :${c.reset} ${DEBOUNCE_MS}ms`,
    `  ${c.dim}push     :${c.reset} ${AUTO_PUSH ? c.green + "on" : c.yellow + "off"}${c.reset}`,
    `  ${c.dim}author   :${c.reset} ${COMMITTER_NAME} <${COMMITTER_EMAIL}>`,
    "",
    `  ${c.yellow}Press Ctrl+C to stop.${c.reset}`,
    "",
  ].join("\n")
);

git(`config user.name "${COMMITTER_NAME}"`, true);
git(`config user.email "${COMMITTER_EMAIL}"`, true);

if (hasChanges()) {
  log("INFO", c.yellow, "Found existing changes — committing now...");
  commit();
}

watchRecursive(WATCH_DIR);

log("INFO", c.green, "Watching for file changes...");

// Keep alive
setInterval(() => {
  if (dirty && !timer) commit();
}, 60_000);
