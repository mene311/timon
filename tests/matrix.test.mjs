// writeMatrix / clearMatrix against a fake 2.0.1 device: pool of 64, six tracks of 16 entries,
// a track's steps being the pattern it is on.   node tests/matrix.test.mjs
import assert from "node:assert/strict";
import * as fel from "../js/felucca.js";
import { writeMatrix, writeBlock, clearMatrix, checkWritable, blockOf } from "../js/skiff-write.js";

const NSTEP = 64, NTRK = 6, NTAG = 16;
const mkStep = (n, notes, ties = 0) => ({ n, notes: [notes[0] ?? 0, notes[1] ?? 0, 0, 0], time: n ? 0 : 2,
  flags: 0, vel: n ? 100 : 0, hit: 0, acc: 0, hi: 0, chance: 100, ratchet: 1, flam: 0, cond: 0, nudge: 0, ties });

function fakeDevice({ song = 0, playing = 0, silentWrites = false, setFails = false } = {}) {
  const pool = Array.from({ length: 64 }, () => ({ len: 0, uses: 0, steps: null }));
  const tracks = Array.from({ length: NTRK }, () => ({
    entry: 127, pattern: 127, staged: 127,
    entries: Array.from({ length: NTAG }, () => ({ value: 0, reps: 1 })),
  }));
  let calls = { setStep: 0, new: 0, set: 0, clear: 0, play: 0 };
  const listState = () => ({ op: 0, rc: 0, song, tracks: tracks.map((t) => ({
    entry: t.entry, staged: t.staged ?? 127, pattern: t.pattern,
    entries: t.entries.map((e) => ({ value: e.value, reps: e.reps, chained: false })),
  })) });
  const firstFree = () => pool.findIndex((p) => p.len === 0);
  const dev = {
    calls: () => calls,
    pool: async () => ({ op: 0, rc: 0, patterns: pool.map((p) => ({ len: p.len, uses: p.uses })),
                         free: pool.filter((p) => p.len === 0).length }),
    raw: (id, i) => pool[id]?.steps?.[i],          // (the test's own peephole: the pool's content)
    list: async () => listState(),
    listOp: async (op, tr, en, value) => {
      if (playing) return { rc: 3, tracks: [] };
      if (op === fel.LOP.NEW) {
        calls.new++;
        const id = firstFree();
        if (id < 0) return { rc: 4, tracks: [] };
        pool[id] = { len: NSTEP, uses: 0, steps: Array.from({ length: NSTEP }, () => mkStep(0, [])) };
        tracks[tr].entries[en].value = id + 1;
        tracks[tr].staged = en;                         // STAGED, as the firmware does: pattern stays as it was
        return listState();
      }
      if (op === fel.LOP.PLAY) {
        calls.play = (calls.play ?? 0) + 1;
        const v = tracks[tr].entries[en].value;
        if (!v) return { rc: 1, tracks: [] };
        tracks[tr].entry = en; tracks[tr].pattern = v - 1; tracks[tr].staged = 127;
        return listState();
      }
      if (op === fel.LOP.SET) {
        calls.set++;
        if (setFails) return { rc: 1, tracks: [] };   // the unit refusing: a pattern not kept
        if (!(value >= 1 && value <= 64) || pool[value - 1].len === 0) return { rc: 1, tracks: [] };
        tracks[tr].entries[en].value = value;
        tracks[tr].staged = en;
        return listState();
      }
      if (op === fel.LOP.CLEAR) {
        calls.clear++;
        tracks[tr].entries[en].value = 0;
        if (tracks[tr].entry === en) { tracks[tr].entry = 127; tracks[tr].pattern = 127; }
        return listState();
      }
      return { rc: 5, tracks: [] };
    },
    getStep: async (tr, i) => {
      const p = pool[tracks[tr].pattern];
      return p?.steps ? { ...p.steps[i], track: tr, index: i } : null;
    },
    setStep: async (tr, i, st, depth = 5) => {
      calls.setStep++;
      const p = pool[tracks[tr].pattern];
      if (silentWrites)                                 // the unit took nothing: it answers with what it holds
        return fel.readStep([tr, i, ...fel.stepBytes(p.steps[i], depth)]);
      const back = fel.readStep([tr, i, ...fel.stepBytes(st, depth)]);
      p.steps[i] = back;
      return back;
    },
    poolOp: async (op, id) => {
      if (playing) return { rc: 3 };
      if (op === 1 || op === 2) { if (pool[id].uses > 0) return { rc: 2 }; pool[id] = { len: 0, uses: 0, steps: null }; }
      if (op === 3) for (let i = 0; i < 64; i++) if (!pool[i].uses) pool[i] = { len: 0, uses: 0, steps: null };
      return { rc: 0 };
    },
  };
  return dev;
}

const pat = (hits) => Array.from({ length: NSTEP }, (_, i) => (hits.includes(i) ? mkStep(1, [60]) : mkStep(0, [])));
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("  ok  " + name); };
const tAsync = async (name, fn) => { await fn(); n++; console.log("  ok  " + name); };

await tAsync("writeMatrix: allocates, writes, assigns and verifies", async () => {
  const dev = fakeDevice();
  const patterns = [pat([0, 4, 8, 12]), pat([2, 6, 10, 14]), pat([0, 8])];
  const cells = [{ track: 0, entry: 0, pattern: 0 }, { track: 0, entry: 1, pattern: 1 },
                 { track: 5, entry: 15, pattern: 2 }, { track: 3, entry: 7, pattern: 0 }];
  const r = await writeMatrix(dev, { patterns, cells, nstep: NSTEP, depth: 5 });
  assert.deepEqual(r.ids, [0, 1, 2]);
  const st = await dev.list();
  assert.equal(st.tracks[0].entries[0].value, 1);
  assert.equal(st.tracks[0].entries[1].value, 2);
  assert.equal(st.tracks[5].entries[15].value, 3);
  assert.equal(st.tracks[3].entries[7].value, 1);      // the same pattern, reused
  // the steps really landed, read from the pool itself (the tracks moved on to the assigned entries)
  assert.equal(dev.raw(0, 0).n, 1);
  assert.equal(dev.raw(0, 4).n, 1);
  assert.equal(dev.raw(0, 1).n, 0);
  assert.equal(dev.raw(1, 2).n, 1);
  assert.equal(dev.raw(2, 8).n, 1);
});

await tAsync("writeMatrix: a pattern written twice across cells is stored once", async () => {
  const dev = fakeDevice();
  const patterns = [pat([0])];
  const cells = [{ track: 0, entry: 0, pattern: 0 }, { track: 1, entry: 0, pattern: 0 }, { track: 2, entry: 0, pattern: 0 }];
  const r = await writeMatrix(dev, { patterns, cells, nstep: NSTEP, depth: 5 });
  assert.equal(r.ids.length, 1);
  const st = await dev.list();
  assert.deepEqual([0, 1, 2].map((tr) => st.tracks[tr].entries[0].value), [1, 1, 1]);
});

await tAsync("writeMatrix: song MODE on is not a refusal — the unit is stopped and the write goes ahead", async () => {
  const dev = fakeDevice({ song: 1 });                 // song mode on, but playing = 0
  const r = await writeMatrix(dev, { patterns: [pat([0])], cells: [{ track: 0, entry: 0, pattern: 0 }], nstep: NSTEP });
  assert.deepEqual(r.ids, [0]);
});

await tAsync("writeMatrix: a unit that is playing refuses with rc 3 and says so", async () => {
  const dev = fakeDevice({ playing: 1 });
  await assert.rejects(() => writeMatrix(dev, { patterns: [pat([0])], cells: [{ track: 0, entry: 0, pattern: 0 }], nstep: NSTEP }),
                       /the unit is playing — press PLAY to stop it/);
});

await tAsync("writeMatrix: refuses when the pool is too full", async () => {
  const dev = fakeDevice();
  for (let k = 0; k < 63; k++) {                       // 63 of 64 used
    await dev.listOp(fel.LOP.NEW, 0, 0);
  }
  await assert.rejects(() => writeMatrix(dev, { patterns: [pat([0]), pat([1])], cells: [], nstep: NSTEP }),
                       /free pattern/);
});

await tAsync("writeMatrix: a silent device is caught by the read-back", async () => {
  const dev = fakeDevice({ silentWrites: true });
  await assert.rejects(() => writeMatrix(dev, { patterns: [pat([0, 8])], cells: [{ track: 0, entry: 0, pattern: 0 }], nstep: NSTEP }),
                       /did not take/);
});

await tAsync("writeMatrix: a refreeze allocates fresh patterns and leaves the old ones unused", async () => {
  const dev = fakeDevice();
  await writeMatrix(dev, { patterns: [pat([0, 4])], cells: [{ track: 0, entry: 0, pattern: 0 }], nstep: NSTEP });
  await writeMatrix(dev, { patterns: [pat([0, 4])], cells: [{ track: 0, entry: 0, pattern: 0 }], nstep: NSTEP });
  const p = await dev.pool();
  const used = p.patterns.filter((x) => x.len > 0).length;
  assert.equal(used, 2, "two frees, two patterns: the old one is UNUSED, never destroyed");
  assert.equal(p.free, 62);
  // and the 2.0 pool cleanup reclaims it
  const st = await dev.list();
  assert.equal(st.tracks[0].entries[0].value, 2, "the cell points at the newest pattern");
});

await tAsync("writeMatrix: the authoring entry is put back as it was", async () => {
  const dev = fakeDevice();
  await writeMatrix(dev, { patterns: [pat([0])], cells: [{ track: 0, entry: 0, pattern: 0 }],
                           nstep: NSTEP, authorTrack: 0, authorEntry: 15 });
  const st = await dev.list();
  assert.equal(st.tracks[0].entries[15].value, 0, "entry 15 was empty and must be empty again");
  assert.equal(st.tracks[0].entries[0].value, 1, "the planned cell is still assigned");
});

await tAsync("writeMatrix: a cell ON the authoring entry survives the restore", async () => {
  const dev = fakeDevice();
  await writeMatrix(dev, { patterns: [pat([0]), pat([1])],
                           cells: [{ track: 0, entry: 15, pattern: 1 }],
                           nstep: NSTEP, authorTrack: 0, authorEntry: 15 });
  const st = await dev.list();
  assert.equal(st.tracks[0].entries[15].value, 2, "the cell on entry 15 must end up on its pattern");
});

await tAsync("clearMatrix: clears entries and unused pool slots", async () => {
  const dev = fakeDevice();
  await writeMatrix(dev, { patterns: [pat([0]), pat([1])], cells: [{ track: 0, entry: 0, pattern: 0 }, { track: 1, entry: 2, pattern: 1 }], nstep: NSTEP });
  await clearMatrix(dev, { cells: [{ track: 0, entry: 0 }] });
  let st = await dev.list();
  assert.equal(st.tracks[0].entries[0].value, 0);
  assert.equal(st.tracks[1].entries[2].value, 2, "the other cell is untouched");
  await clearMatrix(dev, { mode: "unused" });
  const p = await dev.pool();
  assert.equal(p.free, 64);
});

t("checkWritable: room and tracks, never the song byte", () => {
  assert.doesNotThrow(() => checkWritable({ list: { song: 1, tracks: [1] }, pool: { free: 9 } }, 1));
  assert.throws(() => checkWritable({ list: { song: 0, tracks: [1] }, pool: { free: 0 } }, 1), /pool has 0 free/);
  assert.doesNotThrow(() => checkWritable({ list: { song: 0, tracks: [1] }, pool: { free: 9 } }, 1));
});



await tAsync("a NEW that stages (pattern 127) still yields the right id and the steps land", async () => {
  const dev = fakeDevice();
  const r = await writeMatrix(dev, { patterns: [pat([0, 8])], cells: [{ track: 2, entry: 4, pattern: 0 }], nstep: NSTEP, authorTrack: 2 });
  assert.deepEqual(r.ids, [0]);
  assert.ok(dev.calls().play >= 1, "the track was brought onto the new pattern before writing");
  assert.equal(dev.raw(0, 0).n, 1, "the pattern is not blank: its steps were written");
  assert.equal(dev.raw(0, 8).n, 1);
});


// ---- blocks of 16: T1 1..16, T2 17..32, T3 33..48, T4 49..64 ------------------------------------
const sixteen = () => Array.from({ length: 16 }, (_, k) => pat([k * 2 % 16, (k * 2 + 4) % 16]));

await tAsync("writeBlock T1: creates patterns 1..16 and points the entries at them", async () => {
  const dev = fakeDevice();
  const r = await writeBlock(dev, { track: 0, patterns: sixteen(), nstep: NSTEP, depth: 5 });
  assert.equal(r.base, 0);
  assert.deepEqual(r.ids, Array.from({ length: 16 }, (_, k) => k));
  const st = await dev.list();
  assert.deepEqual(st.tracks[0].entries.slice(0, 16).map((e) => e.value),
                   Array.from({ length: 16 }, (_, k) => k + 1));
  const pool = await dev.pool();
  assert.equal(pool.patterns.filter((p) => p.len > 0).length, 16);
});

await tAsync("writeBlock T2: its block is 17..32, not the first free slots", async () => {
  const dev = fakeDevice();
  await writeBlock(dev, { track: 0, patterns: sixteen(), nstep: NSTEP });
  const r = await writeBlock(dev, { track: 1, patterns: sixteen(), nstep: NSTEP });
  assert.equal(r.base, 16);
  assert.deepEqual(r.ids.slice(0, 3), [16, 17, 18]);
  const st = await dev.list();
  assert.equal(st.tracks[1].entries[0].value, 17);
  assert.equal(st.tracks[1].entries[15].value, 32);
  const pool = await dev.pool();
  assert.equal(pool.patterns.filter((p) => p.len > 0).length, 32);
});

await tAsync("writeBlock twice: reuses the same patterns (the pool does not grow)", async () => {
  const dev = fakeDevice();
  await writeBlock(dev, { track: 0, patterns: sixteen(), nstep: NSTEP });
  const after1 = (await dev.pool()).patterns.filter((p) => p.len > 0).length;
  const news1 = dev.calls().new;
  await writeBlock(dev, { track: 0, patterns: sixteen(), nstep: NSTEP });
  const after2 = (await dev.pool()).patterns.filter((p) => p.len > 0).length;
  assert.equal(after2, after1, "the second write reuses the block instead of allocating 16 more");
  assert.equal(dev.calls().new, news1, "no NEW was needed: every slot already existed");
});

await tAsync("writeBlock on T5 says there is no block, not 'pool full'", async () => {
  const dev = fakeDevice();
  await assert.rejects(() => writeBlock(dev, { track: 4, patterns: sixteen(), nstep: NSTEP }),
                       /track 5 has no block of 16/);
});

await tAsync("blockOf: the four blocks, and nothing for T5/T6", () => {
  assert.deepEqual([0, 1, 2, 3].map((t) => blockOf(t).lo), [1, 17, 33, 49]);
  assert.equal(blockOf(4), null);
  assert.equal(blockOf(5), null);
});


// ---- the regression that produced "SET track 1 entry 0: ... a pattern not kept" -----------------
await tAsync("the pattern the cells point at survives the scratch entry being cleared", async () => {
  const dev = fakeDevice();
  const r = await writeMatrix(dev, { patterns: [pat([0]), pat([4])],
                                     cells: [{ track: 0, entry: 0, pattern: 0 }, { track: 0, entry: 1, pattern: 1 }],
                                     nstep: NSTEP, authorTrack: 0, authorEntry: 15 });
  const pool = await dev.pool();
  for (const id of r.ids) assert.ok(pool.patterns[id].len > 0, `pattern ${id + 1} must still be kept`);
  const st = await dev.list();
  assert.deepEqual([st.tracks[0].entries[0].value, st.tracks[0].entries[1].value], [1, 2]);
  assert.equal(st.tracks[0].entries[15].value, 0, "and the scratch entry went back to empty");
});

await tAsync("a cell ON the scratch entry is left alone (no clear after the set)", async () => {
  const dev = fakeDevice();
  await writeMatrix(dev, { patterns: [pat([0])], cells: [{ track: 0, entry: 15, pattern: 0 }],
                           nstep: NSTEP, authorTrack: 0, authorEntry: 15 });
  const st = await dev.list();
  assert.equal(st.tracks[0].entries[15].value, 1);
});

await tAsync("SET gets SET's own words, not the COPY wording", async () => {
  const dev = fakeDevice({ setFails: true });
  await assert.rejects(
    () => writeMatrix(dev, { patterns: [pat([0])], cells: [{ track: 0, entry: 0, pattern: 0 }], nstep: NSTEP }),
    /not kept/);
});

console.log(`\n${n} matrix tests passed`);
