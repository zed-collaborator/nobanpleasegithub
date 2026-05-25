#!/usr/bin/env node

/**
 * Commit Grinder — blasts commits as fast as GitHub allows.
 * Makes a tiny change, commits, pushes, repeats.
 */

const { execSync } = require("child_process");
const { appendFileSync, writeFileSync, existsSync } = require("fs");
const { join } = require("path");

// ── Config ──────────────────────────────────────────────────────────────────
const TOTAL = parseInt(process.env.TOTAL || "1000", 10);       // how many commits
const DELAY = parseInt(process.env.DELAY || "0", 10);          // ms between each (0 = max speed)
const BATCH = parseInt(process.env.BATCH || "5", 10);          // commits before each push
const PREFIX = process.env.PREFIX || "auto";                   // commit msg prefix
const FILE = process.env.FILE || "data.txt";                   // file to modify
const DIR = process.argv[2] || process.cwd();
// ────────────────────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
  cyan: "\x1b[36m", magenta: "\x1b[35m", gray: "\x1b[90m",
};

function ts() { return new Date().toISOString().replace("T", " ").slice(0, 19); }
function log(tag, color, msg) {
  process.stdout.write(`${c.gray}[${ts()}]${c.reset} ${color}${tag}${c.reset} ${msg}\n`);
}

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: DIR, encoding: "utf-8", stdio: ["pipe","pipe","pipe"] }).trim();
  } catch (e) {
    return null;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  process.stdout.write([
    "",
    `${c.cyan}${c.bold}  ╔═══════════════════════════════════════╗${c.reset}`,
    `${c.cyan}${c.bold}  ║       COMMIT GRINDER  v3.0            ║${c.reset}`,
    `${c.cyan}${c.bold}  ╚═══════════════════════════════════════╝${c.reset}`,
    "",
    `  ${c.dim}target   :${c.reset} ${c.bold}${TOTAL}${c.reset} commits`,
    `  ${c.dim}delay    :${c.reset} ${DELAY}ms`,
    `  ${c.dim}batch    :${c.reset} push every ${BATCH} commits`,
    `  ${c.dim}file     :${c.reset} ${FILE}`,
    "",
    `${c.yellow}  Starting grind...${c.reset}`,
    "",
  ].join("\n"));

  const path = join(DIR, FILE);
  let done = 0;
  let errors = 0;
  const start = Date.now();

  while (done < TOTAL) {
    // tiny change
    appendFileSync(path, `${Date.now()}\n`);

    const msg = `${PREFIX}: ${new Date().toISOString().replace("T"," ").slice(0,19)}`;
    git("add -A");

    const r = git(`commit -m "${msg}"`);
    if (!r) { errors++; log("SKIP", c.yellow, `commit ${done+1} failed (nothing new?)`); continue; }

    done++;
    const bar = progressBar(done, TOTAL, 30);
    process.stdout.write(
      `${c.gray}[${ts()}]${c.reset} ${c.green}${String(done).padStart(String(TOTAL).length)}/${TOTAL}${c.reset} ${bar} ${c.dim}${msg}${c.reset}\n`
    );

    // push every BATCH commits
    if (done % BATCH === 0) {
      log("PUSH", c.cyan, `pushing batch (${done}/${TOTAL})...`);
      const p = git("push");
      if (p !== null) {
        log(" OK ", c.green, `pushed — ${done} total`);
      } else {
        errors++;
        log("ERR ", c.red, "push failed — will retry next batch");
      }
    }

    if (DELAY > 0) await sleep(DELAY);
  }

  // final push
  log("PUSH", c.cyan, `final push...`);
  git("push");

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  const rate = (done / ((Date.now() - start) / 1000)).toFixed(1);

  process.stdout.write([
    "",
    `${c.green}${c.bold}  DONE!${c.reset}`,
    `  ${c.dim}commits :${c.reset} ${c.bold}${done}${c.reset}`,
    `  ${c.dim}errors  :${c.reset} ${errors}`,
    `  ${c.dim}time    :${c.reset} ${secs}s`,
    `  ${c.dim}rate    :${c.reset} ${rate} commits/s`,
    "",
  ].join("\n"));
}

function progressBar(cur, total, width) {
  const pct = cur / total;
  const filled = Math.round(width * pct);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `${c.green}${bar}${c.reset} ${(pct * 100).toFixed(1)}%`;
}

run().catch(e => { log("FATAL", c.red, e.message); process.exit(1); });
