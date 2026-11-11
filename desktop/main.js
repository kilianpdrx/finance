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
 * Startup: « Démarrage… » → backend → /api/health → interface → its /api/health
 * (which crosses the proxy) → the app. Closing the window stops both servers.
 */
const { app, BrowserWindow, Menu, dialog, nativeTheme, session, shell, utilityProcess } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";
const BACKEND_START_MS = 90_000;  // first opening: Gatekeeper / Defender scan the files, migrations run
const INTERFACE_START_MS = 30_000;
const STOP_GRACE_MS = 5_000;

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
const servers = {};       // { backend, web }: { proc, exited, code, label, tail }

// ── Log ─────────────────────────────────────────────────────────────────────
// desktop.log, next to the backend's finance.log: what this process did, the
// servers' output while they start, and their last lines if one stops. Not their
// routine output afterwards — finance.log has the backend's.
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
      server.tail.push(line);
      if (server.tail.length > 200) server.tail.shift();
      if (always || !server.healthy) log(`[${name}] ${line}`);
    }
  });
}

// ── Ports ───────────────────────────────────────────────────────────────────
function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, HOST, () => probe.close(() => resolve(true)));
  });
}

function anyFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, HOST, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** The interface's port stays the same from one launch to the next: the page's
 *  saved state (profile, period, accounts, masking, theme) lives in its origin's
 *  storage, and the origin includes the port. Drawn once in 20000–29999, below
 *  every system's ephemeral range; drawn again only if another program took it. */
async function interfacePort() {
  const file = path.join(userData, "ports.json");
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(file, "utf8")).interface;
  } catch {
    // first launch, or an unreadable file: draw one
  }
  if (Number.isInteger(saved) && saved >= 20000 && saved <= 29999 && (await portIsFree(saved))) return saved;
  for (let i = 0; i < 50; i++) {
    const port = 20000 + Math.floor(Math.random() * 10000);
    if (await portIsFree(port)) {
      fs.writeFileSync(file, JSON.stringify({ interface: port }));
      if (saved) log(`Port ${saved} occupé par un autre programme : l'interface passe sur ${port}.`);
      return port;
    }
  }
  throw new Error("Aucun port libre n'a été trouvé pour l'interface.");
}

// ── Servers ─────────────────────────────────────────────────────────────────
/** `stopped`: the French sentence for "it stopped" (« L'interface s'est arrêtée »). */
function track(label, stopped, proc) {
  const server = { proc, label, stopped, exited: false, code: null, healthy: false, tail: [] };
  proc.on("exit", (code, signal) => {
    server.exited = true;
    server.code = code ?? signal;
    log(`${stopped} (code ${server.code}).`);
    if (!quitting && server.healthy) {
      for (const line of server.tail.slice(-50)) log(`[${label}, dernières lignes] ${line}`);
      fail(`${stopped} de manière inattendue (code ${server.code}).`, { running: true });
    }
  });
  return server;
}

function startBackend(apiPort, webPort) {
  if (!fs.existsSync(backendExe)) throw new Error(`Serveur introuvable : ${backendExe}`);
  const proc = spawn(backendExe, ["--port", String(apiPort), "--watch-stdin"], {
    cwd: backendDir,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      FINANCE_DATA_DIR: dataDir,
      APP_VERSION: `v${app.getVersion()}`,
      FINANCE_APP_PORTS: `${webPort},${apiPort}`,
      MPLCONFIGDIR: path.join(userData, "cache", "matplotlib"),
      PYTHONUNBUFFERED: "1",
      PYTHONIOENCODING: "utf-8",
    },
  });
  const server = track("Le serveur de données", "Le serveur de données s'est arrêté", proc);
  proc.on("error", (err) => {
    server.exited = true;
    server.code = err.code;
    log(`Le serveur de données n'a pas pu être lancé : ${err.message}`);
  });
  follow(server, proc.stdout, "serveur");
  follow(server, proc.stderr, "serveur");
  servers.backend = server;
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
  const server = track("L'interface", "L'interface s'est arrêtée", proc);
  follow(server, proc.stdout, "interface");
  follow(server, proc.stderr, "interface", { always: true });
  servers.web = server;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntilHealthy(server, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exited) {
      for (const line of server.tail.slice(-20)) log(`[${server.label}, dernières lignes] ${line}`);
      throw new Error(`${server.stopped} pendant le démarrage (code ${server.code}).`);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) {
        server.healthy = true;
        return;
      }
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  throw new Error(`${server.label} n'a pas répondu en ${Math.round(timeoutMs / 1000)} secondes.`);
}

/** Stop both servers: the backend gets SIGTERM (it finishes its requests and
 *  closes the database; on Windows kill() terminates it — SQLite's WAL is
 *  crash-safe), SIGKILL if it is still there after a few seconds. */
function stopServers() {
  const waits = [];
  for (const server of Object.values(servers)) {
    if (!server || server.exited) continue;
    waits.push(new Promise((resolve) => {
      server.proc.once("exit", resolve);
      const timer = setTimeout(() => {
        if (!server.exited) server.proc.kill("SIGKILL");
      }, STOP_GRACE_MS);
      timer.unref?.();
    }));
    if (server === servers.backend) {
      server.proc.stdin?.end();         // its watchdog stops it too
      server.proc.kill("SIGTERM");
    } else {
      server.proc.kill();
    }
  }
  return Promise.all(waits);
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
function originOf(url) {
  try {
    return new URL(url).origin;   // for a blob: URL, the origin that made it
  } catch {
    return null;
  }
}

const isAppUrl = (url) => appOrigin !== null && originOf(url) === appOrigin;

function isWebLink(url) {
  try {
    return ["https:", "http:"].includes(new URL(url).protocol) && !isAppUrl(url);
  } catch {
    return false;
  }
}

function openInBrowser(url) {
  shell.openExternal(url).catch((err) => log(`Le navigateur n'a pas pu s'ouvrir : ${err.message}`));
}

function secureContents(contents) {
  // Inside the app's own origin only. A link to the web opens in the browser; a
  // file dropped on the window, or anything else, goes nowhere.
  const guard = (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (isWebLink(url)) openInBrowser(url);
    else log(`Navigation refusée (${originOf(url) ?? "adresse illisible"}).`);
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
  contents.on("will-attach-webview", (event) => event.preventDefault());
  // The payslip PDF opens in a window of its own: an empty page, then a blob:
  // URL of the app's origin (which the system browser could not read).
  contents.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank" || (url.startsWith("blob:") && isAppUrl(url))) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: { width: 1000, height: 820, title: "Finance", autoHideMenuBar: true },
      };
    }
    if (isWebLink(url)) openInBrowser(url);
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
  win.on("closed", () => {
    win = null;
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
  fs.mkdirSync(logDir, { recursive: true });
  logStream = fs.createWriteStream(path.join(logDir, "desktop.log"), { flags: "w" });
  log(`Finance ${app.getVersion()} — ${process.platform} ${process.arch}, Electron ${process.versions.electron}`);

  Menu.setApplicationMenu(buildMenu());
  secureSession();
  createWindow();

  try {
    const webPort = await interfacePort();
    const apiPort = await anyFreePort();
    appOrigin = `http://${HOST}:${webPort}`;
    log(`Ports : interface ${webPort}, serveur ${apiPort}.`);

    startBackend(apiPort, webPort);
    await waitUntilHealthy(servers.backend, `http://${HOST}:${apiPort}/api/health`, BACKEND_START_MS);
    log(`Serveur de données prêt (${Date.now() - started} ms).`);

    startInterface(apiPort, webPort);
    await waitUntilHealthy(servers.web, `${appOrigin}/api/health`, INTERFACE_START_MS);
    log(`Interface prête (${Date.now() - started} ms).`);

    if (!win) return;          // closed during startup: quitting
    await win.loadURL(`${appOrigin}/`);
    ready = true;
    log(`Fenêtre ouverte (${Date.now() - started} ms).`);
  } catch (err) {
    if (!quitting) fail(err.message);
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
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.on("web-contents-created", (_event, contents) => secureContents(contents));
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", (event) => {
    if (Object.values(servers).every((s) => !s || s.exited)) {
      logStream?.end();
      return;
    }
    event.preventDefault();
    stopServers().then(() => {
      log(ready ? "Finance fermé." : "Finance fermé pendant le démarrage.");
      logStream?.end(() => app.exit(0));
    });
  });

  app.whenReady().then(start);
}
