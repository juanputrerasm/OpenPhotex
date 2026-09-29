#!/usr/bin/env node
/*
  Copy the built browser/Node core into another project, for consumers without a bundler or
  npm install step (JSTrackViewer is served as static files and loads it from a Web Worker,
  where import maps do not apply).

    npm run build && npm run vendor -- ../JSTrackViewer/src/vendor/openphotex

  Copies dist/**\/*.js except the CLI, plus LICENSE and a VERSION stamp naming the package
  version and the OpenPhotex commit it was built from. The target folder is replaced.
*/
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const target = process.argv[2];
if (!target) {
  process.stderr.write("usage: npm run vendor -- <target-directory>\n");
  process.exit(1);
}
const dist = join(root, "dist");
if (!existsSync(join(dist, "index.js"))) {
  process.stderr.write("dist/ is missing; run 'npm run build' first.\n");
  process.exit(1);
}

const out = resolve(target);
if (existsSync(out)) {
  // Only ever replace a folder this script created.
  if (!existsSync(join(out, "VERSION"))) {
    process.stderr.write(`${out} exists and has no VERSION stamp; refusing to replace it.\n`);
    process.exit(1);
  }
  rmSync(out, { recursive: true });
}
mkdirSync(out, { recursive: true });

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const files = walk(dist).filter((path) => path.endsWith(".js") && !relative(dist, path).startsWith("cli"));
for (const file of files) {
  const dest = join(out, relative(dist, file));
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(file, dest);
}
cpSync(join(root, "LICENSE"), join(out, "LICENSE"));

const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
let commit = "unknown";
try {
  commit = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["-C", root, "status", "--porcelain", "--", "src"], { encoding: "utf8" }).trim();
  if (dirty) commit += "-dirty";
} catch { /* not a git checkout */ }
writeFileSync(join(out, "VERSION"), [
  `openphotex ${version} (${commit})`,
  "Vendored build of https://github.com/juanputrerasm/OpenPhotex. Do not edit these files;",
  "change OpenPhotex and re-run its 'npm run vendor -- <this folder>'.",
  "",
].join("\n"));
process.stdout.write(`Vendored openphotex ${version} (${commit}): ${files.length} files into ${out}\n`);
