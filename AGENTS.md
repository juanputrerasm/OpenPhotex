# Working on OpenPhotex

OpenPhotex is the canonical implementation of understood Terminal Reality file formats. Other projects, such as JSTrackViewer and the future OpenMTM2, consume it instead of keeping their own parsers.

For how to use OpenPhotex while investigating other code, including the CLI and `--json`, see the `openphotex` skill in `~/.claude/skills/openphotex/SKILL.md`. This file covers changing OpenPhotex itself.

## Rules

- **Core stays portable.** `src/` must run unchanged in browsers, Web Workers and Node.js. It takes bytes and returns plain data: no DOM, OPFS, `fetch`, `fs`, `Buffer` or third-party imports. `tsconfig.json` and `test/portability.test.ts` enforce this. Node-only code belongs in `cli/`.
- **Plain data out.** Parsed results must stay structured-cloneable and JSON-serializable, with no references to the input buffer and no rendering types (for example, no Three.js objects).
- **Preserve proven behaviour.** Parsing rules came from real archives. Do not "clean up" a check or quirk without evidence. When behaviour changes, update `docs/` and say why.
- **Test first.** Every format rule has a synthetic fixture test (`test/fixtures/build.ts` writes the bytes independently of the parser). Never commit retail game data. Stock-archive checks go in `test/stock.test.ts` and skip when the files are absent. The same goes for `src/`: no retail data such as game palettes ships in the library, and consumers that need a fallback keep their own.
- **The CLI JSON is an external interface.** Keep keys always present and in a fixed order. Adding a field is fine; removing, renaming or retyping one requires bumping `JSON_SCHEMA_VERSION` in `cli/output.ts` and updating the README.
- **Document.** Format knowledge, evidence and open questions go in `docs/<FORMAT>.md`, never in the skill.

## Commands

```sh
npm test            # build + all tests
npm run typecheck
npm run vendor -- ../JSTrackViewer/src/vendor/openphotex   # refresh a vendored consumer
```

After changing the core, re-vendor it into JSTrackViewer and run that repo's `node --test tests/`.
