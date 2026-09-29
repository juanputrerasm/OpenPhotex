/*
  The core library (src/) must stay free of environment-specific APIs so that browsers, Web
  Workers and Node.js can all load it unchanged. tsconfig.json already compiles src/ without DOM
  or Node types; this also catches what a type-only check would miss, such as a dynamic import
  or a global reached through globalThis.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;

// Checked against the code with comments removed.
const FORBIDDEN_IMPORTS: [RegExp, string][] = [
  [/from\s+["']node:|import\(\s*["']node:|require\(/, "Node module import"],
  [/from\s+["'](fs|path|os|buffer|crypto|url)["']/, "Node built-in import"],
  [/from\s+["'](?!\.\.?\/)/, "third-party import"],
];
// Checked against the code with comments and string literals removed, so messages may say "File".
const FORBIDDEN_GLOBALS: [RegExp, string][] = [
  [/\b(Buffer|process|__dirname)\b/, "Node global"],
  [/\b(window|document|navigator|self|localStorage|indexedDB|fetch|Blob|File|FileReader|Worker)\b/, "browser global"],
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? sources(join(dir, d.name)) : d.name.endsWith(".ts") && !d.name.endsWith(".d.ts") ? [join(dir, d.name)] : []);
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function stripStrings(code: string): string {
  return code.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

test("core sources use no Node, browser or third-party APIs", () => {
  const files = sources(SRC);
  assert.ok(files.length > 0);
  for (const file of files) {
    const code = stripComments(readFileSync(file, "utf8"));
    for (const [pattern, label] of FORBIDDEN_IMPORTS) assert.doesNotMatch(code, pattern, `${label} in ${file}`);
    const bare = stripStrings(code);
    for (const [pattern, label] of FORBIDDEN_GLOBALS) assert.doesNotMatch(bare, pattern, `${label} in ${file}`);
  }
});

test("VERSION matches package.json", async () => {
  const { VERSION } = await import("../src/index.ts");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
});

test("the built package has no runtime dependencies", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies, undefined);
});
