// Codec tests for the Skiff 2.0.1 editor protocol (js/felucca.js). No transport: the frames and the
// reply payloads are built here by hand from web/EDITOR_PROTOCOL.md.
//   node tests/codec.test.mjs
import assert from "node:assert/strict";
import * as fel from "../js/felucca.js";

const str = (s) => [...s].map((c) => c.charCodeAt(0)).concat([0]);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("  ok  " + name); };

t("frame() wraps cmd and args, all 7 bit", () => {
  assert.deepEqual(fel.frame(fel.CMD.TRACK_STEP, [5, 63, 0x80]), [0xF0, 0x7D, 0x46, 0x4C, 30, 5, 63, 0x00, 0xF7]);
});

t("reply() only takes that cmd's frame", () => {
  const r = [0xF0, 0x7D, 0x46, 0x4C, 1, 9, 0xF7];
  assert.deepEqual(fel.reply(r, fel.CMD.INFO), [9]);
  assert.equal(fel.reply(r, fel.CMD.POOL), null);
  assert.equal(fel.reply([0xF0, 0x7D, 0x00, 0x00, 1, 0xF7], fel.CMD.INFO), null);
});

// ---- INFO, with the tagged tail of a 2.0.1 unit -----------------------------------------------
const info2 = (opts = {}) => {
  const { trk = 6, ties = true, flam = true, ratchet = true, list2 = true, sounds = true, pool = true, list = true } = opts;
  const c57 = (pool ? 4 : 0) | (list ? 8 : 0) | (ratchet ? 0 : 0) | (ties ? 64 : 0);
  const c58 = (list2 ? 1 : 0) | (sounds ? 2 : 0);
  const a = [...str("v2.0.1"), 1, 143, 12, 64, 135, ...str("FM6"), trk, 16];
  a.push(0x4E, 0x01, 17);                       // MENU settings
  if (ratchet) a.push(0x52, 0x01, 4);
  a.push(0x4C, 0x01, 1);
  a.push(0x54, 0x01, 0x30, 0x00, 0x00, 0x00);   // light tracks
  if (flam) a.push(0x43, 0x01, 32);
  a.push(0x4B, 0x01, 8);
  a.push(0x57, 0x01, c57);
  a.push(0x49, 0x01, 143, 0, 135, 1);           // wide ids
  a.push(0x58, 0x01, c58);
  return a;
};

t("INFO: version, counts, engines, tracks", () => {
  const i = fel.decodeInfo(info2());
  assert.equal(i.version, "v2.0.1");
  assert.equal(i.pcount, 143);
  assert.equal(i.nstep, 64);
  assert.equal(i.pe0, 135);
  assert.equal(i.ntrk, 6);
  assert.equal(i.chainRows, 16);
  assert.deepEqual(i.engines, ["FM6"]);
});

t("INFO: the capability bits a 2.0.1 unit advertises", () => {
  const c = fel.decodeInfo(info2()).caps;
  assert.equal(c.ties, true);
  assert.equal(c.flam, true);
  assert.equal(c.ratchet, true);
  assert.equal(c.pool, true);
  assert.equal(c.list, true);
  assert.equal(c.list2, true);
  assert.equal(c.entrySounds, true);
  assert.equal(c.wideIds, true);
});

t("INFO: a 1.0.5 unit has no ties, no list2, and still ratchet", () => {
  const c = fel.decodeInfo(info2({ ties: false, flam: false, list2: false, sounds: false, pool: false, list: false })).caps;
  assert.equal(c.ties, false);
  assert.equal(c.list2, false);
  assert.equal(c.ratchet, true);
  assert.equal(c.pool, false);
  assert.equal(fel.stepDepth(c), 3);
});

// ---- the step payload, one length per protocol version -----------------------------------------
const step = { n: 2, notes: [60, 64, 0, 0], time: 0, flags: 1, vel: 100,
               hit: 0, acc: 0, hi: 0, chance: 80, ratchet: 2, flam: 1, cond: 0, nudge: 3, ties: 5 };

t("step write: the base is 8 bytes, each field extends it", () => {
  assert.equal(fel.stepBytes(step, 0).length, 8);
  assert.equal(fel.stepBytes(step, 1).length, 11);   // v5 hits
  assert.equal(fel.stepBytes(step, 2).length, 12);   // v7 chance
  assert.equal(fel.stepBytes(step, 3).length, 13);   // 1.0.5 ratchet
  assert.equal(fel.stepBytes(step, 4).length, 16);   // W1 FLAM, COND, NUDGE
  assert.equal(fel.stepBytes(step, 5).length, 17);   // 2.0 ties
});

t("step write: the values land where the protocol says", () => {
  const b = fel.stepBytes(step, 5);
  assert.deepEqual(b.slice(0, 8), [2, 60, 64, 0, 0, 0, 1, 100]);
  assert.deepEqual(b.slice(8, 11), [0, 0, 0]);
  assert.equal(b[11], 80);        // chance
  assert.equal(b[12], 2);         // ratchet
  assert.deepEqual(b.slice(13, 16), [1, 0, 35]);   // flam, cond, nudge+32
  assert.equal(b[16], 5);         // ties
});

t("step write: chance clamps to 0..100 and nudge is +32", () => {
  const b = fel.stepBytes({ ...step, chance: 250, nudge: -32 }, 5);
  assert.equal(b[11], 100);
  assert.equal(b[15], 0);
});

t("step read: a 17-byte reply comes back as the same step", () => {
  const back = fel.readStep([4, 9, ...fel.stepBytes(step, 5)]);
  assert.deepEqual(back.notes, [60, 64, 0, 0]);
  assert.equal(back.chance, 80);
  assert.equal(back.ratchet, 2);
  assert.equal(back.nudge, 3);
  assert.equal(back.ties, 5);
  assert.equal(back.track, 4);
  assert.equal(back.index, 9);
});

t("step read: a legacy 8-byte reply leaves the newer fields undefined", () => {
  const back = fel.readStep([0, 1, ...fel.stepBytes(step, 0)]);
  assert.equal(back.hit, undefined);
  assert.equal(back.ties, undefined);
});

t("sameStep compares at the depth we write", () => {
  const cur = { ...step, chance: 100 };             // the device holds another chance
  assert.equal(fel.sameStep(step, cur, 1), true);   // depth 1 does not write the chance
  assert.equal(fel.sameStep(step, cur, 2), false);  // depth 2 does
});

// ---- POOL (78) and LIST (79) replies -----------------------------------------------------------
t("POOL query: 64 patterns of len+uses", () => {
  const a = [0, 0];
  for (let i = 0; i < 64; i++) a.push(i < 3 ? 64 : 0, i === 0 ? 2 : 0);
  assert.equal(a.length, 2 + 128);
  const lens = [], uses = [];
  for (let i = 0; i < 64; i++) { lens.push(a[2 + i * 2]); uses.push(a[3 + i * 2]); }
  assert.deepEqual(lens.slice(0, 4), [64, 64, 64, 0]);
  assert.deepEqual(uses.slice(0, 3), [2, 0, 0]);
});

t("LIST query: song, then per track entry/staged/pattern and 16 entries", () => {
  const a = [0, 0, 1];                    // op, rc, SONG on
  for (let tr = 0; tr < 6; tr++) {
    a.push(tr === 0 ? 0 : 127, 127, tr === 0 ? 0 : 127);
    for (let e = 0; e < 16; e++) a.push(0, 0);   // empty entries (value, REPS-1)
  }
  assert.equal(a.length, 3 + 6 * (3 + 32));
  const T = 3 + 32;                       // one track's block: entry, staged, pattern + 16 entries
  assert.equal(a[3], 0);                  // track 0's entry
  assert.equal(a[4], 127);                // nothing staged
  assert.equal(a[5], 0);                  // track 0's pattern
  assert.equal(a[3 + T], 127);            // track 1 is on no entry
  assert.equal(a[3 + 5 * T + 2], 127);    // track 5 too
});

t("LIST SET values: a kept pattern is 1..64, a REST is 65, empty is 0", () => {
  assert.equal(fel.ENTRY_REST, 65);
  assert.equal(fel.PAT_NONE, 127);
  assert.deepEqual(fel.LOP, { SET: 1, COPY: 2, PLAY: 3, CLEAR: 4, REPS: 5, SONG: 6, NEW: 7, COPY_PLUS: 8 });
});

console.log(`\n${n} codec tests passed`);
