import { splitEvoLines } from "./text.ts";

/*
  4x4 Evolution 2's track scripts, `SCRIPTS\<track>.SC` (4x42.exe ..\core\event.cpp, the command reader 0x450170).

  A line is one rule: conditions, `->`, then actions; a line with no `->` is actions with no condition. `//` starts a
  comment to the end of the line.

    objectsIntersect(boxc,vehicle1)                ->  startPathObject(9)
    foundSecret1 && !gaveSecret1                   ->  raise(gaveSecret1,forever); foundSecret(1); Message("Found secret 1")
    co1 & co2 & !gaveComp                          ->  raise(gaveComp,forever); giveMoney(16800)
    unlockObjective(1); unlockObjective(2)

  Conditions are joined by `&&` or `&` and may be negated with `!`; each is a call (`objectsIntersect(a,b)`) or a flag
  name (one that `raise` sets). Actions are calls separated by `;`. Arguments are split on commas outside quotes, and a
  quoted argument keeps its text without the quotes.

  Over the stock install the calls are: raise, objectsIntersect, Message, giveMoney, foundSecret, completedObjective,
  startPathObject, unlockObjective, stopPathObject, displayObjective, unlockMission, setWaterTidePeriod,
  setWaterTideHeight. The reader keeps whatever a line names; what each does is the host's.
*/

export interface EvoScriptCall {
  name: string;
  args: string[];
}

export interface EvoScriptCondition {
  negate: boolean;
  /** A call (`objectsIntersect`), or null for a flag. */
  call: EvoScriptCall | null;
  /** The flag's name, for a flag condition. */
  flag: string | null;
}

export interface EvoScriptRule {
  /** Empty for a rule with no `->`. */
  conditions: EvoScriptCondition[];
  actions: EvoScriptCall[];
  /** The line it was read from, counted from 1. */
  line: number;
}

export interface EvoScript {
  sourceName: string;
  rules: EvoScriptRule[];
  warnings: string[];
}

/** Splits `text` on `separator` where it is outside quotes and brackets. */
function splitOutside(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0, quoted = false, start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "(") depth++;
    else if (!quoted && ch === ")") depth--;
    else if (!quoted && depth === 0) {
      separator.lastIndex = i;
      const m = separator.exec(text);
      if (m && m.index === i) {
        parts.push(text.slice(start, i));
        i += m[0].length - 1;
        start = i + 1;
      }
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function parseCall(text: string): EvoScriptCall | null {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*$/s.exec(text.trim());
  if (!m) return null;
  const args = m[2].trim() ? splitOutside(m[2], /,/y).map((a) => (a.startsWith('"') && a.endsWith('"') && a.length >= 2 ? a.slice(1, -1) : a)) : [];
  return { name: m[1], args };
}

/** Removes a `//` comment that is not inside quotes. */
function stripComment(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (!quoted && line[i] === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}

export function parseEvoScript(bytes: Uint8Array, sourceName: string): EvoScript {
  const rules: EvoScriptRule[] = [];
  const warnings: string[] = [];
  splitEvoLines(bytes).forEach((raw, index) => {
    const text = stripComment(raw).trim();
    if (!text) return;
    const arrow = text.indexOf("->");
    const left = arrow >= 0 ? text.slice(0, arrow) : "";
    const right = arrow >= 0 ? text.slice(arrow + 2) : text;
    const conditions: EvoScriptCondition[] = [];
    for (const part of splitOutside(left, /&&|&/y)) {
      const negate = part.startsWith("!");
      const body = negate ? part.slice(1).trim() : part;
      const call = parseCall(body);
      if (call) conditions.push({ negate, call, flag: null });
      else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(body)) conditions.push({ negate, call: null, flag: body });
      else warnings.push(`${sourceName}:${index + 1}: unreadable condition "${part}"`);
    }
    const actions: EvoScriptCall[] = [];
    for (const part of splitOutside(right, /;/y)) {
      const call = parseCall(part);
      if (call) actions.push(call);
      else warnings.push(`${sourceName}:${index + 1}: unreadable action "${part}"`);
    }
    if (actions.length) rules.push({ conditions, actions, line: index + 1 });
  });
  return { sourceName, rules, warnings };
}
