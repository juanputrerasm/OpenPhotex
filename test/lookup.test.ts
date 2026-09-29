import test from "node:test";
import assert from "node:assert/strict";
import {
  findPodEntry,
  findPodEntryByTitle,
  findPodEntriesByExtension,
  normalizePodPath,
  parsePod,
  podPathTitle,
} from "../src/index.ts";
import { buildPod1 } from "./fixtures/build.ts";

const pod = parsePod(buildPod1([
  { name: "ART\\Grass.RAW" },
  { name: "DATA\\SUMMIT.SIT" },
  { name: "WORLD\\SUMMIT.SI2" },
  { name: "MODELS\\GRASS.RAW" },
]));

test("normalizePodPath and podPathTitle", () => {
  assert.equal(normalizePodPath(" art\\sub/Grass.raw "), "ART/SUB/GRASS.RAW");
  assert.equal(normalizePodPath(null), "");
  assert.equal(podPathTitle("art\\sub\\grass.raw"), "GRASS.RAW");
  assert.equal(podPathTitle("GRASS.RAW"), "GRASS.RAW");
});

test("findPodEntry ignores case and separator style", () => {
  assert.equal(findPodEntry(pod, "art/grass.raw")?.index, 0);
  assert.equal(findPodEntry(pod, "ART\\GRASS.RAW")?.index, 0);
  assert.equal(findPodEntry(pod, "GRASS.RAW"), null);
});

test("findPodEntryByTitle returns the first match in directory order", () => {
  assert.equal(findPodEntryByTitle(pod, "grass.raw")?.index, 0);
  assert.equal(findPodEntryByTitle(pod, "somewhere\\summit.sit")?.index, 1);
  assert.equal(findPodEntryByTitle(pod, "missing.raw"), null);
});

test("findPodEntriesByExtension matches the end of the file name", () => {
  assert.deepEqual(findPodEntriesByExtension(pod, ".raw").map((e) => e.index), [0, 3]);
  assert.deepEqual(findPodEntriesByExtension(pod, ".SI2").map((e) => e.index), [2]);
});
