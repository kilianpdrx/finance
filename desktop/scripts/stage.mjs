// Assemble ce que l'application embarque, dans desktop/stage/ :
//   stage/web      le serveur Next « standalone », comme l'image Docker (web/Dockerfile) :
//                  .next/standalone + .next/static + public
//   stage/backend  le dossier produit par PyInstaller (backend/finance-backend.spec)
//
//   node scripts/stage.mjs --web <dossier web/ déjà construit> --backend <dist/finance-backend>
//
// Les chemins sont donnés, jamais devinés : l'interface se construit dans une copie de
// web/ (un `next build` dans web/ casserait le serveur de développement qui tourne).
import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { web: { type: "string" }, backend: { type: "string" } } });
if (!values.web || !values.backend) {
  console.error("Usage : node scripts/stage.mjs --web <dossier web construit> --backend <dist/finance-backend>");
  process.exit(2);
}
const web = resolve(values.web);
const backend = resolve(values.backend);
const stage = join(dirname(fileURLToPath(import.meta.url)), "..", "stage");

async function mustExist(path, what) {
  await access(path).catch(() => {
    console.error(`${what} introuvable : ${path}`);
    process.exit(1);
  });
}
await mustExist(join(web, ".next", "standalone", "server.js"), "Le serveur Next standalone (npm run build)");
await mustExist(join(web, ".next", "static"), "Les fichiers statiques de Next");
await mustExist(backend, "Le dossier PyInstaller");

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(join(web, ".next", "standalone"), join(stage, "web"), { recursive: true, verbatimSymlinks: true });
await cp(join(web, ".next", "static"), join(stage, "web", ".next", "static"), { recursive: true });
await cp(join(web, "public"), join(stage, "web", "public"), { recursive: true });
// Copiés par le traçage de Next mais jamais chargés par le serveur de production :
// sharp (et ses bibliothèques @img, 18 Mo) sert à next/image, que l'interface
// n'utilise pas ; TypeScript (9 Mo) au serveur de développement. Pas retirés de
// l'image Docker, qui n'est pas touchée ici.
for (const unused of ["@img", "sharp", "typescript"]) {
  await rm(join(stage, "web", "node_modules", unused), { recursive: true, force: true });
}
await cp(backend, join(stage, "backend"), { recursive: true, verbatimSymlinks: true });
console.log(`stage/ prêt : ${stage}`);
