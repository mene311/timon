// The drum track's bank (generator.drumBank): the lane knobs must actually change the sequences.
//   node tests/drums.test.mjs
import assert from "node:assert/strict";
import { drumBank, DRUM_LANES, generateDrums } from "../js/generator.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("  ok  " + name); };

const base = { length: 16, rate: 6, kick: 4, snare: 2, chh: 8, ohh: 0, lrot: 0, lgrid: 1, drift: 50 };
const notesOf = (bank, slot, step) => (bank[slot].steps[step].notes || []).map((x) => x.note).sort((a, b) => a - b);

t("a drum track yields 16 sequences of 64 steps, on the GM lanes", () => {
  const b = drumBank(base, 16);
  assert.equal(b.length, 16);
  assert.equal(b[0].steps.length, 64);
  const all = new Set();
  for (const s of b[0].steps) for (const x of s.notes) all.add(x.note);
  for (const nn of all) assert.ok([36, 38, 42, 46].includes(nn), `unexpected note ${nn}`);
});

t("the kick knob changes the kick lane", () => {
  const four = drumBank({ ...base, kick: 4 }, 16);
  const zero = drumBank({ ...base, kick: 0 }, 16);
  const count = (b) => b[0].steps.filter((s) => (s.notes || []).some((x) => x.note === 36)).length;
  assert.ok(count(four) > 0, "4 pulses must produce kicks");
  assert.equal(count(zero), 0, "0 pulses must produce none");
});

t("the snare and the hats change too", () => {
  const a = drumBank({ ...base, snare: 0, chh: 0 }, 16);
  const b = drumBank({ ...base, snare: 2, chh: 8 }, 16);
  const has = (bank, note) => bank[0].steps.some((s) => (s.notes || []).some((x) => x.note === note));
  assert.equal(has(a, 38), false);
  assert.equal(has(b, 38), true);
  assert.equal(has(a, 42), false);
  assert.equal(has(b, 42), true);
});

t("Rotate turns the hat figure from slot to slot", () => {
  const b = drumBank({ ...base, lrot: 3 }, 16);
  const hats = b.map((p) => p.steps.slice(0, 16).map((s) => ((s.notes || []).some((x) => x.note === 42) ? "x" : ".")).join(""));
  assert.ok(new Set(hats).size > 1, "the 16 slots must not be identical");
  assert.equal(hats[0], drumBank({ ...base, lrot: 3 }, 1)[0].steps.slice(0, 16)
    .map((s) => ((s.notes || []).some((x) => x.note === 42) ? "x" : ".")).join(""), "slot 0 keeps the figure");
});

t("Grid snaps the hits", () => {
  const off = drumBank({ ...base, lgrid: 1 }, 1)[0].steps;
  const on = drumBank({ ...base, lgrid: 4 }, 1)[0].steps;
  const hits = (steps) => steps.map((s, i) => ((s.notes || []).length ? i : -1)).filter((i) => i >= 0);
  for (const i of hits(on)) assert.equal(i % 4, 0, `a hit at ${i} is off a 1/4 grid`);
  assert.ok(hits(off).length >= hits(on).length);
});

t("zero on every lane is a silent pattern, not a crash", () => {
  const b = drumBank({ ...base, kick: 0, snare: 0, chh: 0, ohh: 0 }, 2);
  assert.equal(b[0].steps.every((s) => (s.notes || []).length === 0), true);
});

t("generateDrums is the same figure the bank is built from", () => {
  const one = generateDrums({ lanes: [{ pulses: 4 }, { pulses: 2 }, { pulses: 8 }, { pulses: 0 }], grid: 1 });
  const two = drumBank({ ...base }, 1)[0].steps;
  const notes = (steps) => steps.map((x) => x.notes.map((y) => y.note).sort((a, b) => a - b));
  assert.deepEqual(notes(one.slice(0, 16)), notes(two.slice(0, 16)), "the same figure; the bank just sets its own velocities");
});

console.log(`\n${n} drum tests passed`);
