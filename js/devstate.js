// devstate.js — read-only summary of what a unit says about itself (POOL 78 + LIST 79), in the shape
// the panel draws. Pure: the decoders feed it, the DOM comes after, so it can be tested without a unit.
//
//   pool: { patterns: [{ len, uses }] }       64 of them, from felucca.decodePool
//   list: { song, tracks: [{ entry, staged, pattern, entries: [{ value, reps, chained }] }] }
//   ->   { used, free, referenced, cells: [[{ value, reps, chained, used }]], songOn, playing }

export function summarise(pool, list, track = 0) {
  const pats = pool?.patterns ?? [];
  const used = pats.filter((p) => (p?.len ?? 0) > 0).length;
  const referenced = pats.filter((p) => (p?.uses ?? 0) > 0).length;
  const tracks = list?.tracks ?? [];
  const cells = tracks.map((t) =>
    (t.entries ?? []).map((e) => ({
      value: e.value,                                    // 1..64 a pattern, 65 a REST, 0 empty
      id: e.value >= 1 && e.value <= 64 ? e.value - 1 : null,
      reps: e.reps ?? 1,
      chained: !!e.chained,
    })));
  return {
    songOn: !!list?.song,
    used,
    free: 64 - used,
    referenced,
    patterns: pats.map((p, i) => ({ id: i, len: p?.len ?? 0, uses: p?.uses ?? 0 })),
    tracks: tracks.length,
    current: track,
    cells,
    on: tracks.map((t) => ({ entry: t.entry, staged: t.staged, pattern: t.pattern })),
  };
}

// One line for the header: the whole state in a sentence.
export function headline(s) {
  if (!s) return "no state read yet";
  const cur = s.on[s.current] ?? {};
  const on = cur.entry === 127 ? "on no entry" : `on entry ${cur.entry + 1}`;
  const playing = cur.pattern === 127 ? "no pattern" : `pattern ${cur.pattern + 1}`;
  return `pool ${s.referenced}/${s.used} used of 64 · T${s.current + 1} ${on}, ${playing} · song ${s.songOn ? "ON" : "off"}`;
}
