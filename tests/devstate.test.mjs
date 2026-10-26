// The read-only summary of what a unit reports (js/devstate.js).   node tests/devstate.test.mjs
import assert from "node:assert/strict";
import { summarise, headline } from "../js/devstate.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("  ok  " + name); };

const pool = (usedIds = [], refIds = []) => ({
  patterns: Array.from({ length: 64 }, (_, i) => ({ len: usedIds.includes(i) ? 64 : 0, uses: refIds.includes(i) ? 2 : 0 })),
});
const list = (rows) => ({ song: 1, tracks: rows.map((r) => ({
  entry: r.entry ?? 127, staged: 127, pattern: r.pattern ?? 127,
  entries: Array.from({ length: 16 }, (_, e) => (r.entries?.[e] ?? { value: 0, reps: 1 })),
})) });

t("counts kept vs referenced patterns", () => {
  const s = summarise(pool([0, 1, 2, 3], [0, 1]), list([{}]));
  assert.equal(s.used, 4);
  assert.equal(s.referenced, 2);
  assert.equal(s.free, 60);
});

t("cells carry the pattern id, a REST and an empty entry apart", () => {
  const s = summarise(pool([0, 1, 2], [0]), list([{ entries: { 0: { value: 1, reps: 1 },
                                                               1: { value: 65, reps: 4 },
                                                               2: { value: 3, reps: 2, chained: true } } }]));
  assert.deepEqual(s.cells[0][0], { value: 1, id: 0, reps: 1, chained: false });
  assert.equal(s.cells[0][1].id, null, "a REST names no pattern");
  assert.equal(s.cells[0][2].chained, true);
  assert.equal(s.cells[0][2].reps, 2);
  assert.equal(s.cells[0][5].value, 0);
});

t("headline names the current track's entry and pattern", () => {
  const s = summarise(pool([0, 1, 2], [1]), list([
    { entry: 2, pattern: 1 }, { entry: 127, pattern: 127 }, {}, {}, {}, {}]), 1);
  assert.match(headline(s), /T2 on entry 3, pattern 2/);
  assert.match(headline(s), /pool 1\/3 used of 64/);
  assert.match(headline(s), /song ON/);
});

t("headline copes with a track on no entry", () => {
  const s = summarise(pool([]), list([{ entry: 127, pattern: 127 }]), 0);
  assert.match(headline(s), /T1 on no entry, no pattern/);
});

console.log(`\n${n} devstate tests passed`);
