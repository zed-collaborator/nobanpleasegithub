#!/usr/bin/env node

/**
 * Commit Grinder v4.0 — max speed commit grinder.
 * Commits locally at full speed, pushes in big batches.
 */

const { execSync } = require("child_process");
const { appendFileSync } = require("fs");
const { join } = require("path");

// ── Config ──────────────────────────────────────────────────────────────────
const TOTAL   = parseInt(process.env.TOTAL   || "100000", 10);
const BATCH   = parseInt(process.env.BATCH   || "100", 10);   // push every N commits
const DELAY   = parseInt(process.env.DELAY   || "0", 10);     // ms between commits (0 = max)
const PREFIX  = process.env.PREFIX  || "auto";
const FILE    = process.env.FILE    || "data.txt";
const DIR     = process.argv[2]     || process.cwd();

const USER    = "dot19kz";
const EMAIL   = "ziryge@gmail.com";
// ────────────────────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
  cyan: "\x1b[36m", gray: "\x1b[90m",
};

function ts() { return new Date().toISOString().replace("T", " ").slice(0, 19); }
function log(tag, color, msg) {
  process.stdout.write(`${c.gray}[${ts()}]${c.reset} ${color}${tag}${c.reset} ${msg}\n`);
}

function git(args) {
  try {
    return execSync(`git ${args}`, {
      cwd: DIR, encoding: "utf-8", stdio: ["pipe","pipe","pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: USER, GIT_AUTHOR_EMAIL: EMAIL,
        GIT_COMMITTER_NAME: USER, GIT_COMMITTER_EMAIL: EMAIL,
      },
    }).trim();
  } catch { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function bar(cur, total, w = 30) {
  const pct = cur / total;
  const f = Math.round(w * pct);
  return `${c.green}${"█".repeat(f)}${"░".repeat(w - f)}${c.reset} ${(pct * 100).toFixed(1)}%`;
}

async function run() {
  // set identity
  git(`config user.name "${USER}"`);
  git(`config user.email "${EMAIL}"`);

  process.stdout.write([
    "",
    `${c.cyan}${c.bold}  ╔══════════════════════════════════════════╗${c.reset}`,
    `${c.cyan}${c.bold}  ║       COMMIT GRINDER  v4.0               ║${c.reset}`,
    `${c.cyan}${c.bold}  ╚══════════════════════════════════════════╝${c.reset}`,
    "",
    `  ${c.dim}target   :${c.reset} ${c.bold}${TOTAL.toLocaleString()}${c.reset} commits`,
    `  ${c.dim}batch    :${c.reset} push every ${BATCH} commits`,
    `  ${c.dim}delay    :${c.reset} ${DELAY}ms`,
    `  ${c.dim}user     :${c.reset} ${USER} <${EMAIL}>`,
    "",
    `${c.yellow}  Grinding...${c.reset}`,
    "",
  ].join("\n"));

  const path = join(DIR, FILE);
  let done = 0, errors = 0, skipped = 0;
  const start = Date.now();

  while (done < TOTAL) {
    // make a tiny change
    appendFileSync(path, `${Date.now()}\n`);

    // stage + commit in one go
    const msg = `${PREFIX}: ${new Date().toISOString().replace("T"," ").slice(0,19)}`;
    git("add -A");
    const r = git(`commit -m "${msg}"`);

    if (!r) { skipped++; continue; }
    done++;

    // print every commit (compact)
    const num = String(done).padStart(String(TOTAL).length);
    process.stdout.write(
      `${c.gray}[${ts()}]${c.reset} ${c.green}${num}/${TOTAL.toLocaleString()}${c.reset} ${bar(done, TOTAL)} ${c.dim}${msg}${c.reset}\n`
    );

    // push in batches
    if (done % BATCH === 0) {
      log("PUSH", c.cyan, `pushing ${done.toLocaleString()} commits...`);
      const p = git("push");
      if (p !== null) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        const rate = (done / ((Date.now() - start) / 1000)).toFixed(1);
        log(" OK ", c.green, `pushed — ${done.toLocaleString()} total | ${rate} c/s | ${elapsed}s elapsed`);
      } else {
        errors++;
        log("ERR ", c.red, `push failed (#${errors}) — retrying in 5s`);
        await sleep(5000);
        git("push"); // retry once
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
    `${c.green}${c.bold}  ═══ DONE ═══${c.reset}`,
    `  ${c.dim}commits  :${c.reset} ${c.bold}${done.toLocaleString()}${c.reset}`,
    `  ${c.dim}skipped  :${c.reset} ${skipped}`,
    `  ${c.dim}errors   :${c.reset} ${errors}`,
    `  ${c.dim}time     :${c.reset} ${secs}s`,
    `  ${c.dim}rate     :${c.reset} ${rate} commits/sec`,
    "",
  ].join("\n"));
}

run().catch(e => { log("FATAL", c.red, e.message); process.exit(1); });
