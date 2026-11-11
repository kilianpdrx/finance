"use strict";
/**
 * electron-builder `afterPack`: copies the staged backend and interface into the
 * packaged app's Resources/ folder (before signing, so they get signed too).
 *
 * Not `extraResources`: it drops a `node_modules` folder found at the root of its
 * source before any filter applies — exactly where Next's standalone server keeps
 * its dependencies.
 */
const fs = require("node:fs/promises");
const path = require("node:path");

const STAGE = path.join(__dirname, "..", "stage");
const PARTS = {
  backend: ["finance-backend", "finance-backend.exe"],   // one of them, per system
  web: ["server.js"],
};

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const resources = electronPlatformName === "darwin"
    ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(appOutDir, "resources");

  for (const [name, entries] of Object.entries(PARTS)) {
    const from = path.join(STAGE, name);
    const found = await Promise.any(entries.map((e) => fs.access(path.join(from, e)))).then(() => true, () => false);
    if (!found) throw new Error(`stage/${name} est incomplet (${entries.join(" ou ")} absent) : lancez scripts/stage.mjs.`);
    const to = path.join(resources, name);
    await fs.rm(to, { recursive: true, force: true });
    await fs.cp(from, to, { recursive: true, verbatimSymlinks: true });
    console.log(`  • ${name} copié dans ${path.relative(appOutDir, to)}`);
  }
  const nextDeps = path.join(resources, "web", "node_modules", "next", "package.json");
  await fs.access(nextDeps).catch(() => {
    throw new Error("L'interface copiée n'a pas ses dépendances (node_modules/next).");
  });
};
