"use strict";
// The desktop app's decisions that need no Electron (core.js). `npm test`.
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const core = require("../core");

const APP = "http://127.0.0.1:23456";

describe("addresses a window may open", () => {
  it("stays inside the app's own origin", () => {
    assert.equal(core.navigationTarget(`${APP}/transactions?x=1`, APP), "app");
    assert.equal(core.navigationTarget(`${APP}/`, APP), "app");
  });

  it("sends web links to the system browser, the app's host on another port included", () => {
    assert.equal(core.navigationTarget("https://github.com/kilianpdrx/finance", APP), "browser");
    assert.equal(core.navigationTarget("http://127.0.0.1:8000/api/system/backup", APP), "browser");
  });

  it("refuses a dropped file and every other scheme", () => {
    for (const url of ["file:///Users/x/releve.csv", "javascript:alert(1)", "data:text/html,<p>x", "pas une adresse"]) {
      assert.equal(core.navigationTarget(url, APP), "refuse", url);
    }
  });

  it("knows no app before its port is chosen", () => {
    assert.equal(core.navigationTarget(`${APP}/`, null), "browser");
  });

  it("opens the payslip PDF in a child window: an empty page, then a blob: of the app", () => {
    assert.equal(core.windowOpenTarget("about:blank", APP), "child");
    assert.equal(core.windowOpenTarget(`blob:${APP}/0f6c1d2e-7a5b-4c3d-9e8f-123456789abc`, APP), "child");
  });

  it("refuses a blob: made by another origin, and app pages as new windows", () => {
    assert.equal(core.windowOpenTarget("blob:https://example.com/0f6c1d2e", APP), "refuse");
    assert.equal(core.windowOpenTarget(`${APP}/budget`, APP), "refuse");
    assert.equal(core.windowOpenTarget("file:///etc/hosts", APP), "refuse");
    assert.equal(core.windowOpenTarget("https://example.com/", APP), "browser");
  });
});

describe("the interface's port", () => {
  let dir;
  let file;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "finance-ports-"));
    file = path.join(dir, "ports.json");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sequence = (...values) => () => values.shift();   // stands in for Math.random

  it("is drawn once, then kept from one launch to the next", async () => {
    const first = await core.stickyPort(file, { isFree: async () => true, random: sequence(0.5) });
    assert.equal(first, 25000);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { interface: 25000 });
    const again = await core.stickyPort(file, { isFree: async () => true, random: () => assert.fail("drawn again") });
    assert.equal(again, 25000);
  });

  it("is drawn again, and said in the log, only when another program took it", async () => {
    fs.writeFileSync(file, JSON.stringify({ interface: 25000 }));
    const said = [];
    const port = await core.stickyPort(file, {
      isFree: async (p) => p !== 25000,
      random: sequence(0.5, 0.1234),
      log: (line) => said.push(line),
    });
    assert.equal(port, 21234);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).interface, 21234);
    assert.match(said[0], /25000 occupé/);
  });

  it("ignores a saved port outside its range or an unreadable file", async () => {
    for (const content of [JSON.stringify({ interface: 8000 }), "{pas du json"]) {
      fs.writeFileSync(file, content);
      const said = [];
      const port = await core.stickyPort(file, { isFree: async () => true, random: sequence(0), log: (l) => said.push(l) });
      assert.equal(port, 20000);
      assert.deepEqual(said, []);
    }
  });

  it("gives up after 50 draws", async () => {
    await assert.rejects(core.stickyPort(file, { isFree: async () => false }), /Aucun port libre/);
  });

  it("finds a port taken on 127.0.0.1", async () => {
    const taken = net.createServer();
    await new Promise((resolve) => taken.listen(0, "127.0.0.1", resolve));
    try {
      assert.equal(await core.portIsFree(taken.address().port), false);
    } finally {
      await new Promise((resolve) => taken.close(resolve));
    }
  });
});

describe("the backend's port line", () => {
  it("is read from the backend's first line", () => {
    assert.equal(core.backendPortFrom("FINANCE_BACKEND_PORT=51234"), 51234);
    assert.equal(core.backendPortFrom("FINANCE_BACKEND_PORT=51234\r"), 51234);
  });

  it("is nothing else", () => {
    for (const line of ["INFO: Uvicorn running on http://127.0.0.1:8000", "FINANCE_BACKEND_PORT=0",
      "FINANCE_BACKEND_PORT=70000", "FINANCE_BACKEND_PORT=12a", "x FINANCE_BACKEND_PORT=1234"]) {
      assert.equal(core.backendPortFrom(line), null, line);
    }
  });
});

describe("desktop.log", () => {
  it("keeps the previous launch's log, so a crash's log survives the next launch", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finance-log-"));
    try {
      const first = core.rotateLog(path.join(dir, "logs"));
      fs.writeFileSync(first, "lancement 1\n");
      core.rotateLog(path.join(dir, "logs"));
      fs.writeFileSync(first, "lancement 2\n");
      const current = core.rotateLog(path.join(dir, "logs"));
      assert.equal(fs.existsSync(current), false);
      assert.equal(fs.readFileSync(path.join(dir, "logs", "desktop.previous.log"), "utf8"), "lancement 2\n");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("waiting for a server", () => {
  let server;
  let url;
  let answers;
  beforeEach(async () => {
    answers = [];
    server = http.createServer((_req, res) => {
      res.statusCode = answers.length ? answers.shift() : 200;
      res.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${server.address().port}/api/health`;
  });
  afterEach(() => new Promise((resolve) => server.close(resolve)));

  it("asks again until the answer is a 2xx", async () => {
    answers.push(502, 503);
    await core.waitForHttp(url, { timeoutMs: 5_000, intervalMs: 10 });
    assert.equal(answers.length, 0);
  });

  it("can take any answer: the server is up, what is behind it may not be", async () => {
    answers.push(502);
    await core.waitForHttp(url, { timeoutMs: 5_000, intervalMs: 10, accept: () => true });
    assert.equal(answers.length, 0);
  });

  it("gives up when check() throws: the server stopped, the app is quitting", async () => {
    answers.push(503, 503, 503, 503);
    let tries = 0;
    await assert.rejects(core.waitForHttp(url, {
      timeoutMs: 5_000, intervalMs: 10,
      check: () => {
        if (++tries > 2) throw new Error("arrêté");
      },
    }), /arrêté/);
  });

  it("gives up after its time", async () => {
    await assert.rejects(core.waitForHttp("http://127.0.0.1:1/", { timeoutMs: 100, intervalMs: 10 }), /pas de réponse/);
  });

  it("within() gives the answer, or an error once the time is up", async () => {
    assert.equal(await core.within(Promise.resolve(51234), 100, "trop tard"), 51234);
    await assert.rejects(core.within(new Promise(() => {}), 20, "trop tard"), /trop tard/);
  });
});

describe("stopping the servers", () => {
  /** A process that exits when asked (`obeys: "stop"`), only when forced
   *  (`"kill"`), or never. */
  function fakeServer(obeys) {
    const proc = new EventEmitter();
    const server = { proc, exited: false, asked: 0, forced: 0 };
    const exit = () => setImmediate(() => {
      server.exited = true;
      proc.emit("exit", 0);
    });
    server.stop = () => {
      server.asked += 1;
      if (obeys === "stop") exit();
    };
    server.kill = () => {
      server.forced += 1;
      if (obeys === "kill") exit();
    };
    return server;
  }

  it("asks each, forces the one still there after the grace period", async () => {
    const polite = fakeServer("stop");
    const stubborn = fakeServer("kill");
    assert.equal(await core.stopAll([polite, stubborn, undefined], { graceMs: 20, deadlineMs: 2_000 }), true);
    assert.deepEqual([polite.asked, polite.forced, stubborn.asked, stubborn.forced], [1, 0, 1, 1]);
  });

  it("never hangs: past the deadline the app quits anyway", async () => {
    const stuck = fakeServer("never");
    const started = Date.now();
    assert.equal(await core.stopAll([stuck], { graceMs: 10, deadlineMs: 60 }), false);
    assert.ok(Date.now() - started < 1_000);
    assert.equal(stuck.forced, 1);
  });

  it("leaves a server that already exited alone", async () => {
    const gone = fakeServer("stop");
    gone.exited = true;
    assert.equal(await core.stopAll([gone], { graceMs: 10, deadlineMs: 100 }), true);
    assert.equal(gone.asked, 0);
  });
});
