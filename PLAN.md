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
