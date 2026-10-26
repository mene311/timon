// skiff-write.js — write the 64-pattern pool and the 6 x 16 entry matrix (Skiff 2.0), through an
// injected transport so the logic is testable without a unit.
//
//   const dev = { pool(), list(), listOp(op, track, entry, value?), getStep(track, i), setStep(track, i, st) }
//   await writeMatrix(dev, { patterns, cells, nstep, onStatus })
//
// Facts this rests on (web/EDITOR_PROTOCOL.md, 2.0.1):
//   - the pool holds 64 patterns; LIST's entries name a pattern by 1..64 (0 empty, 65 REST)
//   - a track's steps are the pattern it is currently ON: LIST NEW assigns a fresh pattern to an
//     entry and brings the track onto it, TRACK_STEP then writes into that pattern
//   - write and clear need the unit STOPPED (LIST/POOL ops return rc 3 while it plays)
//   - LIST SET's value is the pattern's number + 1
import * as fel from "./felucca.js";

export const RC_TEXT = {
  0: "done", 1: "empty: nothing to copy, or no room after", 2: "done, without its automation",
  3: "the unit is playing", 4: "PATTERNS FULL", 5: "failed",
};

export async function readState(dev) {
  const pool = await dev.pool();
  const list = await dev.list();
  return { pool, list };
}

// Refuse early only for what we can know without asking: room in the pool. Whether the unit is PLAYING
// is the device's answer, not a field to guess at: LIST's SONG byte is song MODE (on/off), and a refused
// op comes back with rc 3 ("the unit is playing") — so the ops below raise that where it happens.
export function checkWritable(state, need) {
  if (state.pool.free < need) throw new Error(`the pool has ${state.pool.free} free pattern${state.pool.free === 1 ? "" : "s"}; this plan needs ${need} — clear some first (POOL > CLEAR UNUSED)`);
  if (state.list.tracks.length < 1) throw new Error("the unit reported no tracks");
}

// rc 3 is the device saying it is playing: that is worth its own sentence, since it is the one thing the
// user has to change on the unit itself.
const refuse = (what, rc) => (rc === 3
  ? new Error(`${what}: the unit is playing — press PLAY to stop it, then try again`)
  : new Error(`${what}: ${RC_TEXT[rc] ?? "no reply"}`));

// Write `patterns` into the pool and point `cells` (x-track, entry) at them.
//   patterns: [[step, ...], ...]   up to 64; each step as the codec's readStep()
//   cells:    [{ track, entry, pattern }] with pattern an index into `patterns`
//   depth:    how far a step write goes (see felucca.stepDepth)
export async function writeMatrix(dev, opts) {
  const { patterns = [], cells = [], nstep = 64, depth = 5, authorTrack = 0, authorEntry = 15,
          onStatus = () => {} } = opts;
  if (!patterns.length) throw new Error("nothing to write");
  if (patterns.length > 64) throw new Error("the pool holds 64 patterns");

  const state = await readState(dev);
  checkWritable(state, patterns.length);
  const ntracks = state.list.tracks.length;
  for (const c of cells) {
    if (c.track < 0 || c.track >= ntracks) throw new Error(`cell track ${c.track} outside 0..${ntracks - 1}`);
    if (c.entry < 0 || c.entry > 15) throw new Error(`cell entry ${c.entry} outside 0..15`);
    if (c.pattern < 0 || c.pattern >= patterns.length) throw new Error(`cell names pattern ${c.pattern}, which is not in the plan`);
  }

  // the authoring entry is sacrificed (NEW overwrites it): remember and restore it at the end
  const saved = state.list.tracks[authorTrack]?.entries?.[authorEntry] ?? { value: 0, reps: 1 };

  const ids = [];
  for (let k = 0; k < patterns.length; k++) {
    onStatus(`pattern ${k + 1}/${patterns.length}: allocating a pool slot…`);
    const r = await dev.listOp(fel.LOP.NEW, authorTrack, authorEntry);
    if (!r || r.rc !== 0) throw refuse("allocating a pool slot", r?.rc);
    const id = r.tracks[authorTrack].pattern;
    if (id < 0 || id > 63) throw new Error(`the unit reported pattern ${id}, which is outside the pool`);
    ids.push(id);

    for (let i = 0; i < nstep; i++) {
      const want = patterns[k][i];
      if (!want) continue;
      const cur = await dev.getStep(authorTrack, i);
      if (cur && fel.sameStep(want, cur, depth)) continue;
      const back = await dev.setStep(authorTrack, i, want, depth);
      if (!back || !fel.sameStep(want, back, depth))
        throw new Error(`pattern ${k + 1}, step ${i + 1}: the unit did not take the write`);
    }
    if (k % 8 === 7) onStatus(`pattern ${k + 1}/${patterns.length} written`);
  }

  // (before the cells: NEW overwrote the authoring entry, and a cell may be on that very entry)
  // put the authoring entry back the way it was (its own pattern, or empty)
  if (saved.value === 0) await dev.listOp(fel.LOP.CLEAR, authorTrack, authorEntry);
  else await dev.listOp(fel.LOP.SET, authorTrack, authorEntry, saved.value);

  for (const c of cells) {
    const r = await dev.listOp(fel.LOP.SET, c.track, c.entry, ids[c.pattern] + 1);
    if (!r || r.rc !== 0) throw refuse(`SET track ${c.track + 1} entry ${c.entry}`, r?.rc);
  }

  // read it all back: every cell must name the pattern the plan says
  const after = await dev.list();
  const bad = [];
  for (const c of cells) {
    const got = after.tracks[c.track]?.entries?.[c.entry]?.value;
    if (got !== ids[c.pattern] + 1)
      bad.push(`T${c.track + 1}/${c.entry}: holds ${got === 0 ? "nothing" : got === fel.ENTRY_REST ? "a REST" : `pattern ${got}`}, expected ${ids[c.pattern] + 1}`);
  }
  if (bad.length) throw new Error("read-back mismatch — " + bad.slice(0, 4).join("; ") + (bad.length > 4 ? ` (+${bad.length - 4} more)` : ""));

  onStatus(`wrote ${patterns.length} pattern${patterns.length === 1 ? "" : "s"} and ${cells.length} entr${cells.length === 1 ? "y" : "ies"} ✓`);
  return { ids, cells: cells.length };
}

// Clear cells (LIST CLEAR) and/or pool patterns (POOL CLEAR / EMPTY / CLEAR UNUSED).
export async function clearMatrix(dev, { cells = [], patterns = [], mode = "clear", onStatus = () => {} } = {}) {
  const state = await readState(dev);          // (song MODE is not "playing"; a refusal says so with rc 3)
  for (const c of cells) {
    const r = await dev.listOp(fel.LOP.CLEAR, c.track, c.entry);
    if (!r || r.rc !== 0) throw refuse(`CLEAR track ${c.track + 1} entry ${c.entry}`, r?.rc);
  }
  if (patterns.length) {
    const op = mode === "empty" ? 2 : 1;                  // 2: EMPTY (2.0), 1: CLEAR
    for (const p of patterns) {
      const r = await dev.poolOp(op, p);
      if (!r || r.rc !== 0) throw refuse(`POOL ${mode} pattern ${p}`, r?.rc);
    }
  } else if (mode === "unused") {
    const r = await dev.poolOp(3);
    if (!r || r.rc !== 0) throw refuse("POOL CLEAR UNUSED", r?.rc);
  }
  onStatus("cleared");
}
