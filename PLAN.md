# Timón — PLAN

The FM-1 phone companion (pulses lineage): generative patterns into Skiff/Lancha,
desk or handheld.

## Structure

- `web/` core — fork of fm1-pulses-felucca → Skiff target: 6 tracks, 2 drum
  tracks (GM), freeze-all-patterns, Skiff editor protocol (`js/skiff.js`).
- `android/` shell — WebView + native MIDI bridge (Kotlin): BLE MIDI for live
  notes/CC, USB-OTG for the full editor protocol. Per the BT research: BLE is
  notes-only; Freeze/write/read needs USB.

## Phases

- **P0** repo + rename (felucca.js → skiff.js) + codec: INFO (6 tracks, wide
  ids), STEP_GET/SET, TRACK_STEP, LIST, POOL, MOTION. Test suite + handshake
  against the real unit on Skiff.
- **P1** write pipeline: bank → pool patterns 1–16 + 6×16 layout grid
  (LIST SET/COPY/PLAY + TRACK_STEP). Freeze track (dest select, 6 tracks).
- **P2** freeze-all: all patterns + layout in one pass + read-back verify
  (STEP_GET spot-checks, POOL USED counts).
- **P3** drums: GM lane/note layer, 47-entry GM table (35–81), drum generator.
- **P4** android/ shell: WebView + Kotlin bridge (android.media.midi: BLE +
  USB-OTG), reconnect loop.
- **P5** phone UX: handheld layout, pairing flow with Lancha's BT, GitHub Pages
  for the web core.

## Facts already banked

- Skiff editor protocol: `F0 7D 46 4C cmd… F7`, 14-bit values; full spec in
  lancha/web/EDITOR_PROTOCOL.md (mirror kept in this repo's `notes/`).
- DRUM lanes = GM 36/38/39/42/46/45/37/56; GM 35–81 table lives in
  `lancha/firmware/src/eng_drum.c` (`DRUM_GM`).
- Xiaomi 14t: USB host + native MIDI stack confirmed (notes/android-capabilities.md).

## Pattern matrix — revised against Skiff 2.0.1 (2026-10-25)

Checked in the 2.0.1 source, not assumed: **`NPAT 64`** (`core.h`) — the pattern pool is 64
patterns, ids 0..63, **shared by every track**; `BK_POOL NPAT` (`bank.c`) — the bank's pool is the
whole 64; each track's song list has **16 entries** (A..P), and an entry stores a pattern id, a
REST, or a REPEAT.

So the thing Timón has to own is a **matrix of 6 tracks × 16 entries = 96 cells over a 64-pattern
pool**: 96 cells > 64 patterns, so reuse is normal and expected (the same pattern on several
tracks/entries is a feature, not a collision).

DECIDED (user, 2026-10-25): we are **restricted by the 64**. The generator makes 64 distinct
patterns; the 96 cells assign from those, repeating where it helps. Never assume 96 distinct.

What that changes from the first plan:

- The generator emits **64 patterns**, not 16, and they go into the pool by id (0..63).
- The grid is **6 rows (tracks) × 16 columns (entries A..P)**, each cell naming a pool id, REST or
  REPEAT — freezes write the pool (all 64) plus the 6×16 layout, then read back to verify.
- Everything that made pulses good stays: the sequencer/generator, drift, the bank-to-pool mapping
  (a pulses bank of 16 is now one *quarter* of the pool: four banks fill 64).
- "Freeze all" means: 64 pool patterns + 96 matrix cells, in one verified write.

### Drum tracks: no second knob set

The 6th track is almost always drums, so the melody half of the editor is dead weight there.
Rule: **when a track's engine is DRUM/DRUM-X, the melody section is disabled, not duplicated.**

- Notes are locked to lanes: kick / snare / closed hat / open hat (GM 36 / 38 / 42 / 46) first, the
  rest of the GM lanes available behind a "more lanes" reveal.
- The same knobs do the work: **EUCLIDEAN** (pulses / rotate / length) and **GRID SNAP** (quantise
  the lane pattern to the step grid), plus density and velocity accent — no new knob pages.
- A drum cell in the matrix shows lane hits as a compact row of marks (K S H O) instead of a note
  name, so the 6th row reads at a glance.
- Switching a track from a synth engine to DRUM re-labels the row; the pattern data for the synth
  stays in the pool untouched (nothing is destroyed by switching).


## CHORDS knob (user, 2026-10-25)

One knob per track, cycling a list of voicings: **0 = a single note**, then each step up through
the list applies a different voicing to whatever note the step already has.

Ladder (order chosen for musical usefulness, not theory completeness):

| value | voicing | notes |
| --- | --- | --- |
| 0 | SINGLE | the step's note, mono |
| 1 | POWER | root + 5th |
| 2 | TRIAD | the scale's triad on the step's degree |
| 3 | SEVENTH | triad + the scale's 7th |
| 4 | OPEN | triad with the middle voice up an octave (drop-2 feel) |
| 5 | SUS / QUARTAL | root + 4th + 5th |
| 6 | ADD9 / WIDE | root + triad + 9th up top |

Rules:

- Voicings are **diatonic to the pattern's key/scale** when there is one; where the source is not
  scale-bound, fixed intervals (the POWER / SUS sets) are used instead.
- Note **lengths follow the step** as 2.0 encodes them (1..16 steps, or a fraction of one), so a
  chord holds as long as its note does.
- Cycling is one-directional through the table (there is no "negative" voicing); the knob's value is
  stored per track and kept in the project.

### The polyphony wall — read this before shipping chords

Skiff's voice budget is **8 voices**, and a voicing costs 2 to 4 of them. So chords are cheap on a
solo track and ruinous on a full song: two 4-note tracks already eat the whole budget and the third
track starts stealing voices.

Therefore the knob ships with:

- a **voice meter** (notes now vs the 8-voice budget), visible whenever any track is above 0;
- a soft cap that warns rather than silently stealing — the user decides, the tool does not;
- drums unaffected: on a DRUM/DRUM-X track the melody section is off, so the CHORDS knob is hidden
  with it.
