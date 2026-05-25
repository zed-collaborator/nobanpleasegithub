#!/usr/bin/env node

/**
 * Auto-Commit Bot — fastest possible commits without rate limits.
 * Watches the repo, stages changes, commits + pushes on every file change.
 * Uses batching + debounce to group rapid bursts into single commits.
 */

const { watch, readdirSync, statSync } = require("fs");
const { join, relative } = require("path");
const { execSync } = require("child_process");

// ── Config ──────────────────────────────────────────────────────────────────
const DEBOUNCE_MS = parseInt(process.env.DEBOUNCE_MS || "300", 10); // batch window
const COMMIT_PREFIX = process.env.COMMIT_PREFIX || "auto";
const AUTO_PUSH = process.env.AUTO_PUSH !== "false"; // push by default
const COMMITTER_NAME = process.env.COMMITTER_NAME || "auto-commit-bot";
const COMMITTER_EMAIL = process.env.COMMITTER_EMAIL || "bot@auto-commit.dev";
const WATCH_DIR = process.argv[2] || process.cwd();
// ────────────────────────────────────────────────────────────────────────────

let timer = null;
let dirty = false;
let pushFailures = 0;
const MAX_BACKOFF = 30_000; // 30 s max back-off on push

// ── Helpers ─────────────────────────────────────────────────────────────────
function git(args) {
  try {
    return execSync(`git ${args}`, {
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
  } catch (e) {
    return null;
  }
}

function hasChanges() {
  const out = git("status --porcelain");
  return out && out.length > 0;
}

function commit() {
  if (!hasChanges()) return;

  const now = new Date();
  const ts = now.toISOString().replace("T", " ").slice(0, 19);
  const msg = `${COMMIT_PREFIX}: ${ts}`;

  git("add -A");
  const result = git(`commit -m "${msg}"`);

  if (result) {
    const short = git("rev-parse --short HEAD");
    process.stdout.write(`[${ts}] committed ${short}\n`);

    if (AUTO_PUSH) push();
  }

  dirty = false;
}

function push() {
  const out = git("push");
  if (out !== null) {
    pushFailures = 0;
    process.stdout.write("  → pushed\n");
  } else {
    pushFailures++;
    const delay = Math.min(MAX_BACKOFF, 1000 * 2 ** (pushFailures - 1));
    process.stdout.write(
      `  → push failed (${pushFailures}x), retry in ${delay}ms\n`
    );
    setTimeout(push, delay);
  }
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
  // Skip .git and node_modules
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
    "╔══════════════════════════════════════╗",
    "║       AUTO-COMMIT BOT  v1.0          ║",
    "╚══════════════════════════════════════╝",
    "",
    `  watching : ${WATCH_DIR}`,
    `  debounce : ${DEBOUNCE_MS}ms`,
    `  push     : ${AUTO_PUSH ? "on" : "off"}`,
    `  author   : ${COMMITTER_NAME} <${COMMITTER_EMAIL}>`,
    "",
    "  Press Ctrl+C to stop.",
    "",
  ].join("\n")
);

// Set up git identity for this repo if not set globally
git(`config user.name "${COMMITTER_NAME}"`);
git(`config user.email "${COMMITTER_EMAIL}"`);

// Commit any existing unstaged changes immediately
if (hasChanges()) commit();

watchRecursive(WATCH_DIR);

// Keep alive
setInterval(() => {
  if (dirty && !timer) commit();
}, 60_000);
