"use strict";
/**
 * Finance — the desktop app. Starts the two servers the Docker image runs, each
 * on 127.0.0.1 only (invariant 5), and opens a window on the interface:
 *
 *   backend   Resources/backend/finance-backend   FastAPI frozen by PyInstaller
 *                                                (backend/desktop_server.py)
 *   interface Resources/web/server.js             Next's standalone server, in an
 *                                                Electron utility process
 *
 * Startup: « Démarrage… » → backend, which takes a port and says which → the
 * interface starts meanwhile (it needs the address, not the backend itself) →
 * both answer → the interface's /api/health (which crosses the proxy) → the app.
 * Closing the window quits and stops both servers.
 *
 * The decisions that need no Electron live in core.js, tested by `npm test`.
 */
const { app, BrowserWindow, Menu, dialog, nativeTheme, session, shell, utilityProcess } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const core = require("./core");

const { HOST } = core;
const BACKEND_START_MS = 90_000;  // first opening: Gatekeeper / Defender scan the files, migrations run
const INTERFACE_START_MS = 30_000;
const STOP_GRACE_MS = 5_000;      // then SIGKILL (the backend gives its requests 3 s)
const QUIT_DEADLINE_MS = 8_000;   // then the app exits whatever is still running

// Test hook: a separate profile, data folder and single-instance lock.
if (process.env.FINANCE_USER_DATA) app.setPath("userData", path.resolve(process.env.FINANCE_USER_DATA));

const userData = app.getPath("userData");
const dataDir = path.join(userData, "data");
const logDir = path.join(dataDir, "logs");
const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, "stage");
const backendDir = path.join(resources, "backend");
const backendExe = path.join(backendDir, process.platform === "win32" ? "finance-backend.exe" : "finance-backend");
const webDir = path.join(resources, "web");

let win = null;
let appOrigin = null;     // http://127.0.0.1:<interface port>, once chosen
let ready = false;        // the app is on screen
let quitting = false;
let failed = false;
const servers = {};       // { backend, web }, see track()

// ── Log ─────────────────────────────────────────────────────────────────────
// desktop.log, next to the backend's finance.log: what this process did, the
// servers' output while they start, and their last lines if one stops. Not their
// routine output afterwards — finance.log has the backend's. The previous
// launch's is kept as desktop.previous.log.
const LOG_CAP = 1_000_000;
let logStream = null;
let logged = 0;

function log(line) {
  const text = `${new Date().toISOString()} ${line}\n`;
  if (!logStream || logged > LOG_CAP) return;
  logged += Buffer.byteLength(text);
  logStream.write(logged > LOG_CAP ? "… journal limité à 1 Mo pour cette session\n" : text);
}

function follow(server, stream, name, { always = false } = {}) {
  let partial = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const lines = (partial + chunk).split(/\r?\n/);
    partial = lines.pop();
    for (const line of lines) {
      if (!line) continue;
      server.onLine?.(line);
      server.tail.push(line);
      if (server.tail.length > 200) server.tail.shift();
      if (always || !server.healthy) log(`[${name}] ${line}`);
    }
  });
}

// ── Servers ─────────────────────────────────────────────────────────────────
/** `stopped`: the French sentence for "it stopped" (« L'interface s'est arrêtée »).
 *  `stop` asks the process to end, `kill` forces it (core.stopAll). */
function track(label, stopped, proc, { stop, kill }) {
  const server = {
    proc, label, stopped, stop, kill,
    exited: false, code: null, healthy: false, tail: [], onLine: null, onExit: null,
  };
  proc.on("exit", (code, signal) => {
    server.exited = true;
    server.code = code ?? signal;
    log(`${stopped} (code ${server.code}).`);
    server.onExit?.();
    if (!quitting && server.healthy) {
      for (const line of server.tail.slice(-50)) log(`[${label}, dernières lignes] ${line}`);
      fail(`${stopped} de manière inattendue (code ${server.code}).`, { running: true });
    }
  });
  return server;
}

function startBackend(webPort) {
  if (!fs.existsSync(backendExe)) throw new Error(`Serveur introuvable : ${backendExe}`);
  // --port 0: it binds a free port itself, before its (long) startup, and says
  // which on its first line (core.backendPortFrom).
  const proc = spawn(backendExe, ["--port", "0", "--watch-stdin"], {
    cwd: backendDir,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      FINANCE_DATA_DIR: dataDir,
      APP_VERSION: `v${app.getVersion()}`,
      FINANCE_APP_PORTS: String(webPort),     // the backend adds its own
      MPLCONFIGDIR: path.join(userData, "cache", "matplotlib"),
      PYTHONUNBUFFERED: "1",
      PYTHONIOENCODING: "utf-8",
    },
  });
  const server = track("Le serveur de données", "Le serveur de données s'est arrêté", proc, {
    // SIGTERM: it finishes its requests (3 s at most) and closes the database;
    // on Windows kill() terminates it — SQLite's WAL is crash-safe. Closing its
    // stdin stops it too (its watchdog).
    stop: () => {
      proc.stdin?.end();
      proc.kill("SIGTERM");
    },
    kill: () => proc.kill("SIGKILL"),
  });
  server.port = new Promise((resolve, reject) => {
    server.onLine = (line) => {
      const port = core.backendPortFrom(line);
      if (port) {
        server.onLine = null;
        resolve(port);
      }
    };
    server.onExit = () => reject(new Error(`${server.stopped} pendant le démarrage (code ${server.code}).`));
  });
  server.port.catch(() => {});   // read by start(); a rejection after a failure is not news
  proc.on("error", (err) => {
    server.exited = true;
    server.code = err.code;
    log(`Le serveur de données n'a pas pu être lancé : ${err.message}`);
    server.onExit?.();
  });
  follow(server, proc.stdout, "serveur");
  follow(server, proc.stderr, "serveur");
  servers.backend = server;
  return server;
}

function startInterface(apiPort, webPort) {
  const entry = path.join(webDir, "server.js");
  if (!fs.existsSync(entry)) throw new Error(`Interface introuvable : ${entry}`);
  const proc = utilityProcess.fork(entry, [], {
    cwd: webDir,
    stdio: "pipe",
    serviceName: "Finance — interface",
    env: {
      ...process.env,
      // Explicit: server.js listens on HOSTNAME || "0.0.0.0", and macOS shells
      // export HOSTNAME (the machine's name).
      HOSTNAME: HOST,
      PORT: String(webPort),
      BACKEND_URL: `http://${HOST}:${apiPort}`,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  // A utility process takes no signal: kill() is all there is, and it dies with
  // the app anyway.
  const server = track("L'interface", "L'interface s'est arrêtée", proc, {
    stop: () => proc.kill(),
    kill: () => proc.kill(),
  });
  follow(server, proc.stdout, "interface");
  follow(server, proc.stderr, "interface", { always: true });
  servers.web = server;
  return server;
}

class Quitting extends Error {}

/** Until `url` answers: a 2xx (the server is healthy), or with `anyAnswer` any
 *  HTTP answer at all (the server is up, what it serves may not be yet). */
async function waitUntil(server, url, timeoutMs, { anyAnswer = false } = {}) {
  try {
    await core.waitForHttp(url, {
      timeoutMs,
      accept: anyAnswer ? () => true : (res) => res.ok,
      check: () => {
        if (quitting || failed) throw new Quitting();
        if (server.exited) {
          for (const line of server.tail.slice(-20)) log(`[${server.label}, dernières lignes] ${line}`);
          throw new Error(`${server.stopped} pendant le démarrage (code ${server.code}).`);
        }
      },
    });
  } catch (err) {
    if (err instanceof Quitting || server.exited) throw err;
    throw new Error(`${server.label} n'a pas répondu en ${Math.round(timeoutMs / 1000)} secondes.`);
  }
  if (!anyAnswer) server.healthy = true;
}

function stopServers() {
  return core.stopAll(Object.values(servers), { graceMs: STOP_GRACE_MS, deadlineMs: QUIT_DEADLINE_MS });
}

async function fail(reason, { running = false } = {}) {
  if (failed || quitting) return;
  failed = true;
  log(`ÉCHEC : ${reason}`);
  const stopped = stopServers();
  const { response } = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
    type: "error",
    title: "Finance",
    message: running ? "Finance s'est arrêté" : "Finance n'a pas pu démarrer",
    detail: `${reason}\n\nLes journaux (desktop.log, finance.log) sont dans le dossier « logs » des données de l'application.`,
    buttons: ["Ouvrir le dossier des journaux", "Quitter"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) await shell.openPath(logDir);
  await stopped;
  quitting = true;
  app.quit();
}

// ── Window & security ───────────────────────────────────────────────────────
function openInBrowser(url) {
  shell.openExternal(url).catch((err) => log(`Le navigateur n'a pas pu s'ouvrir : ${err.message}`));
}

function secureContents(contents) {
  // Inside the app's own origin only. A link to the web opens in the browser; a
  // file dropped on the window, or anything else, goes nowhere.
  const guard = (event, url) => {
    const target = core.navigationTarget(url, appOrigin);
    if (target === "app") return;
    event.preventDefault();
    if (target === "browser") openInBrowser(url);
    else log(`Navigation refusée (${core.originOf(url) ?? "adresse illisible"}).`);
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    const target = core.windowOpenTarget(url, appOrigin);
    if (target === "child") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: { width: 1000, height: 820, title: "Finance", autoHideMenuBar: true },
      };
    }
    if (target === "browser") openInBrowser(url);
    return { action: "deny" };
  });
}

function secureSession() {
  const allowed = new Set(["clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Finance",
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#09090b" : "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  // Closing the window quits, even with a payslip PDF still open in a window of
  // its own: otherwise the app and both servers kept running with no window to
  // come back to, and opening Finance again showed nothing.
  win.on("closed", () => {
    win = null;
    app.quit();
  });
  win.loadFile(path.join(__dirname, "loading.html"));
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const openData = { label: "Ouvrir le dossier des données", click: () => shell.openPath(dataDir) };
  const template = [
    ...(isMac
      ? [{
          label: "Finance",
          submenu: [
            { role: "about", label: "À propos de Finance" },
            { type: "separator" },
            openData,
            { type: "separator" },
            { role: "hide", label: "Masquer Finance" },
            { role: "hideOthers", label: "Masquer les autres" },
            { role: "unhide", label: "Tout afficher" },
            { type: "separator" },
            { role: "quit", label: "Quitter Finance" },
          ],
        }]
      : [{ label: "Fichier", submenu: [openData, { type: "separator" }, { role: "quit", label: "Quitter" }] }]),
    {
      // On macOS, Cmd+C / Cmd+V only work in a field when the menu has them.
      label: "Édition",
      submenu: [
        { role: "undo", label: "Annuler" },
        { role: "redo", label: "Rétablir" },
        { type: "separator" },
        { role: "cut", label: "Couper" },
        { role: "copy", label: "Copier" },
        { role: "paste", label: "Coller" },
        { role: "selectAll", label: "Tout sélectionner" },
      ],
    },
    {
      label: "Affichage",
      submenu: [
        { role: "reload", label: "Recharger" },
        { type: "separator" },
        { role: "resetZoom", label: "Taille réelle" },
        { role: "zoomIn", label: "Zoom avant" },
        { role: "zoomOut", label: "Zoom arrière" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Plein écran" },
        ...(app.isPackaged ? [] : [{ type: "separator" }, { role: "toggleDevTools", label: "Outils de développement" }]),
      ],
    },
    {
      label: "Fenêtre",
      submenu: isMac
        ? [{ role: "minimize", label: "Réduire" }, { role: "zoom", label: "Agrandir" }, { type: "separator" },
           { role: "front", label: "Tout ramener au premier plan" }]
        : [{ role: "minimize", label: "Réduire" }, { role: "close", label: "Fermer" }],
    },
  ];
  return Menu.buildFromTemplate(template);
}

// ── Life cycle ──────────────────────────────────────────────────────────────
async function start() {
  const started = Date.now();
  const since = () => `${Date.now() - started} ms`;
  logStream = fs.createWriteStream(core.rotateLog(logDir), { flags: "w" });
  log(`Finance ${app.getVersion()} — ${process.platform} ${process.arch}, Electron ${process.versions.electron}`);

  Menu.setApplicationMenu(buildMenu());
  secureSession();
  createWindow();

  // Quitting can start during any step (the window closed while « Démarrage… »
  // shows): each step checks, so nothing is started once it has begun.
  try {
    const webPort = await core.stickyPort(path.join(userData, "ports.json"), { log });
    if (quitting) return;
    appOrigin = `http://${HOST}:${webPort}`;

    const backend = startBackend(webPort);
    const apiPort = await core.within(backend.port, BACKEND_START_MS,
      `Le serveur de données n'a pas démarré en ${BACKEND_START_MS / 1000} secondes.`);
    if (quitting) return;
    log(`Ports : interface ${webPort}, serveur ${apiPort} (${since()}).`);

    // The interface needs the backend's address to start, not the backend:
    // both start together. It is up once it answers a page of its own — not
    // /api/*, which waits for the backend (a first launch can take longer than
    // the interface's own time limit).
    const web = startInterface(apiPort, webPort);
    await Promise.all([
      waitUntil(backend, `http://${HOST}:${apiPort}/api/health`, BACKEND_START_MS)
        .then(() => log(`Serveur de données prêt (${since()}).`)),
      waitUntil(web, `${appOrigin}/`, INTERFACE_START_MS, { anyAnswer: true })
        .then(() => log(`Interface démarrée (${since()}).`)),
    ]);
    // Through the interface's proxy and request guard, as the window will.
    await waitUntil(web, `${appOrigin}/api/health`, INTERFACE_START_MS);
    log(`Interface prête (${since()}).`);

    if (quitting || !win) return;
    await win.loadURL(`${appOrigin}/`);
    ready = true;
    log(`Fenêtre ouverte (${since()}).`);
  } catch (err) {
    if (!quitting && !(err instanceof Quitting)) fail(err.message);
  }
}

app.enableSandbox();

if (!app.requestSingleInstanceLock()) {
  // Two copies would write to the same database.
  app.quit();
} else {
  if (process.platform === "win32") app.setAppUserModelId("io.github.kilianpdrx.finance");
  app.setAboutPanelOptions({ applicationName: "Finance", applicationVersion: app.getVersion() });

  app.on("second-instance", () => {
    if (!win) return;          // quitting
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.on("web-contents-created", (_event, contents) => secureContents(contents));
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    quitting = true;
  });
  let stopping = false;
  app.on("will-quit", (event) => {
    if (Object.values(servers).every((s) => !s || s.exited)) {
      logStream?.end();
      return;
    }
    event.preventDefault();
    if (stopping) return;      // a second quit request while the servers stop
    stopping = true;
    stopServers().then((allStopped) => {
      if (!allStopped) log(`Un serveur ne s'est pas arrêté en ${QUIT_DEADLINE_MS / 1000} secondes : Finance se ferme quand même.`);
      log(ready ? "Finance fermé." : "Finance fermé pendant le démarrage.");
      logStream?.end(() => app.exit(0));
    });
  });

  app.whenReady().then(start);
}
