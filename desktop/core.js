"use strict";
/**
 * What the main process decides without Electron: which addresses a window may
 * open, the interface's port, the log of each launch, waiting for a server,
 * stopping them. main.js wires it to Electron; `npm test` (node --test) checks
 * it, with no Electron and no build.
 */
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Addresses ───────────────────────────────────────────────────────────────
function originOf(url) {
  try {
    return new URL(url).origin;   // for a blob: URL, the origin that made it
  } catch {
    return null;
  }
}

const isAppUrl = (url, appOrigin) => appOrigin !== null && originOf(url) === appOrigin;

function isWebLink(url, appOrigin) {
  try {
    return ["https:", "http:"].includes(new URL(url).protocol) && !isAppUrl(url, appOrigin);
  } catch {
    return false;
  }
}

/** Where a page may navigate: "app" (inside the app's own origin), "browser" (a
 *  web link: the system browser opens it) or "refuse" (a dropped file, any
 *  other scheme). */
function navigationTarget(url, appOrigin) {
  if (isAppUrl(url, appOrigin)) return "app";
  return isWebLink(url, appOrigin) ? "browser" : "refuse";
}

/** What window.open may open: "child" — an empty page, then a blob: URL of the
 *  app's origin, which is how the payslip PDF opens (the system browser could
 *  not read that blob) —, "browser" for a web link, else "refuse". */
function windowOpenTarget(url, appOrigin) {
  if (url === "about:blank" || (url.startsWith("blob:") && isAppUrl(url, appOrigin))) return "child";
  return isWebLink(url, appOrigin) ? "browser" : "refuse";
}

// ── Ports ───────────────────────────────────────────────────────────────────
function portIsFree(port, host = HOST) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

/** The interface's port stays the same from one launch to the next: the page's
 *  saved state (profile, period, accounts, masking, theme) lives in its origin's
 *  storage, and the origin includes the port. Drawn once in 20000–29999, below
 *  every system's ephemeral range, kept in `file`; drawn again only if another
 *  program took it. */
async function stickyPort(file, { isFree = portIsFree, random = Math.random, log = () => {} } = {}) {
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(file, "utf8")).interface;
  } catch {
    // first launch, or an unreadable file: draw one
  }
  const valid = Number.isInteger(saved) && saved >= 20000 && saved <= 29999;
  if (valid && (await isFree(saved))) return saved;
  for (let i = 0; i < 50; i++) {
    const port = 20000 + Math.floor(random() * 10000);
    if (await isFree(port)) {
      fs.writeFileSync(file, JSON.stringify({ interface: port }));
      if (valid) log(`Port ${saved} occupé par un autre programme : l'interface passe sur ${port}.`);
      return port;
    }
  }
  throw new Error("Aucun port libre n'a été trouvé pour l'interface.");
}

/** The backend binds its own port (`--port 0`) before anything else and says
 *  which on its first line — FINANCE_BACKEND_PORT=51234 (backend/desktop_server.py).
 *  Probing a free port here and passing it on left seconds for another program
 *  to take it. */
const PORT_LINE = /^FINANCE_BACKEND_PORT=(\d{1,5})$/;

function backendPortFrom(line) {
  const match = PORT_LINE.exec(line.trim());
  if (!match) return null;
  const port = Number(match[1]);
  return port >= 1 && port <= 65535 ? port : null;
}

// ── Log ─────────────────────────────────────────────────────────────────────
/** desktop.log is this launch's; the one before is kept as desktop.previous.log,
 *  so the log of a crash survives the relaunch that follows it. */
function rotateLog(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const current = path.join(dir, "desktop.log");
  try {
    fs.renameSync(current, path.join(dir, "desktop.previous.log"));   // replaces the older one
  } catch {
    // first launch: nothing to keep
  }
  return current;
}

// ── Servers ─────────────────────────────────────────────────────────────────
/** `promise`, or an Error(`message`) after `ms`. */
function within(promise, ms, message) {
  let timer;
  const late = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Ask `url` until it answers as wanted: `accept(response)` (default: a 2xx).
 *  `check()` runs before each try and throws to give up (the server stopped,
 *  the app is quitting). */
async function waitForHttp(url, { timeoutMs, accept = (res) => res.ok, check = () => {}, intervalMs = 250 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    check();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (accept(res)) return;
    } catch {
      // not listening yet
    }
    await sleep(intervalMs);
  }
  check();
  throw new Error(`pas de réponse en ${Math.round(timeoutMs / 1000)} secondes`);
}

/** Stop `servers` — each { proc, exited, stop(), kill() }: stop() asks, kill()
 *  forces it if the process is still there after `graceMs`. Resolves true once
 *  all have exited, false at `deadlineMs` whatever happened: quitting the app
 *  must never hang on a process that ignores both. */
function stopAll(servers, { graceMs, deadlineMs }) {
  const waits = [];
  for (const server of servers) {
    if (!server || server.exited) continue;
    waits.push(new Promise((resolve) => {
      server.proc.once("exit", resolve);
      const timer = setTimeout(() => {
        if (!server.exited) server.kill();
      }, graceMs);
      timer.unref?.();
    }));
    server.stop();
  }
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), deadlineMs);
  });
  return Promise.race([Promise.all(waits).then(() => true), deadline]).finally(() => clearTimeout(timer));
}

module.exports = {
  HOST,
  backendPortFrom,
  navigationTarget,
  originOf,
  portIsFree,
  rotateLog,
  sleep,
  stickyPort,
  stopAll,
  waitForHttp,
  windowOpenTarget,
  within,
};
