// backup.js — read the whole unit as Skiff's own complete archive (BACKUP_LIST 65 / BACKUP_GET 66).
//
// The wire encodings and the file format follow Skiff's web/fm1backup.js (GPL-3.0, Leo Kuroshita /
// Hügelton Instruments) exactly, so a file Timón writes is a Felucca/Skiff backup its editor and
// installer can read and restore — not a private format of ours:
//   - values are packed seven bytes into eight septets with a leading mask byte (bkPack / bkUnpack);
//     this is NOT the generic pack7 of fm1ota.js, the two differ
//   - BACKUP_GET answers: id, rc, offset u32, size lo, size hi, then the packed bytes
//   - the archive is { format: "felucca-backup", version: 1, firmware, created, objects: [{id, size, crc, data}] }
//     with data base64 and crc the zlib CRC-32 of the bytes
// Objects: 0 the music playing, 1 settings, 2..5 stored projects, 6/7 user preset banks, 8 the FM6 bank,
// 9 the user presets, 16..31 Skiff's pattern bank (four patterns a chunk), 32..34 the sample slots.
export const BACKUP_CMD = { LIST: 65, GET: 66, PUT: 67 };
const BANK_IDS = Array.from({ length: 16 }, (_, i) => 16 + i);
export const BACKUP_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, ...BANK_IDS, 32, 33, 34];
const BACKUP_IDS_V3 = BACKUP_IDS.filter((id) => id < 16 || id >= 32);
const BACKUP_IDS_V2 = BACKUP_IDS_V3.filter((id) => id !== 9);
const BACKUP_IDS_V1 = BACKUP_IDS_V2.filter((id) => id !== 8);
export const idsOf = (n) => [BACKUP_IDS, BACKUP_IDS_V3, BACKUP_IDS_V2, BACKUP_IDS_V1].find((ids) => ids.length === n) || null;
export const CHUNK = 256;

export const bkU32 = (n) => Array.from({ length: 5 }, (_, i) => (n >>> (i * 7)) & (i === 4 ? 15 : 127));
export function bkR32(a, off = 0) {
  if (a.length < off + 5 || a[off + 4] > 15) throw new Error("invalid archive number");
  return (a[off] | a[off + 1] << 7 | a[off + 2] << 14 | a[off + 3] << 21 | a[off + 4] << 28) >>> 0;
}

// seven bytes -> eight septets: a mask byte carries the bytes' bit 7
export function bkPack(bytes) {
  const a = [];
  for (let off = 0; off < bytes.length; off += 7) {
    const chunk = bytes.subarray(off, off + 7);
    a.push(chunk.reduce((m, b, i) => m | (b >>> 7) << i, 0), ...chunk.map((b) => b & 127));
  }
  return a;
}
export function bkUnpack(a, size) {
  const out = new Uint8Array(size); let i = 0, j = 0;
  while (j < size) {
    const n = Math.min(7, size - j), mask = a[i++];
    if (mask == null || mask >>> n) throw new Error("invalid archive bytes");
    for (let k = 0; k < n; k++) {
      if (a[i] == null || a[i] > 127) throw new Error("short archive chunk");
      out[j++] = a[i++] | (mask >>> k & 1) << 7;
    }
  }
  if (i !== a.length) throw new Error("trailing archive bytes");
  return out;
}

export function bkCrc(bytes) {
  let c = 0xFFFFFFFF;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c >>> 1 ^ (c & 1 ? 0xEDB88320 : 0);
  }
  return (~c) >>> 0;
}

const rcText = { 1: "invalid archive object", 2: "the data failed validation", 3: "the unit is playing: stop it",
                 4: "flash write failed", 5: "start a fresh backup" };
export function bkCheck(rc) { if (rc) throw new Error(rcText[rc] ?? `archive error ${rc}`); }

// The manifest: the ids must be exactly the list the unit's count implies, with sane sizes.
export function bkManifest(a) {
  if (a?.[0] !== 1) throw new Error("unsupported archive protocol");
  bkCheck(a[1]);
  const ids = idsOf(a[2]);
  if (!ids || a.length !== 3 + a[2] * 11) throw new Error("incomplete archive manifest");
  return ids.map((id, i) => {
    const p = 3 + i * 11;
    if (a[p] !== id) throw new Error("unexpected archive object");
    const size = bkR32(a, p + 1), crc = bkR32(a, p + 6);
    if (size > (id >= 32 ? 81920 : 3840) || (!size && crc)) throw new Error("archive object too large");
    return { id, size, crc };
  });
}

const b64 = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };

// Read the whole unit into a Felucca backup file (the same object shape Skiff's editor writes).
export async function captureBackup(dev, firmware = "", onProgress = () => {}) {
  const manifest = bkManifest(await dev.backupList());
  const objects = [];
  const total = manifest.reduce((n, o) => n + o.size, 0);
  let done = 0;
  for (const o of manifest) {
    const bytes = new Uint8Array(o.size);
    for (let off = 0; off < o.size; off += CHUNK) {
      const size = Math.min(CHUNK, o.size - off);
      const a = await dev.getObject(o.id, off, size);
      bkCheck(a[1]);
      if (a[0] !== o.id || bkR32(a, 2) !== off || (a[7] | a[8] << 7) !== size)
        throw new Error(`object ${o.id}: unexpected reply at byte ${off}`);
      bytes.set(bkUnpack(a.slice(9), size), off);
      done += size;
      onProgress(done, total);
    }
    if (bkCrc(bytes) !== o.crc) throw new Error("the unit changed during the backup - try again while stopped");
    objects.push({ id: o.id, size: o.size, crc: o.crc, data: b64(bytes) });
  }
  const file = { format: "felucca-backup", version: 1, firmware, created: new Date().toISOString(), objects };
  readBackup(file);                                    // validate what we are about to hand out
  return file;
}

// Validate a backup file (ours or Skiff's) without touching the unit.
export function readBackup(file) {
  if (typeof file === "string") file = JSON.parse(file);
  const ids = file && Array.isArray(file.objects) ? idsOf(file.objects.length) : null;
  if (!file || file.format !== "felucca-backup" || file.version !== 1 || !ids)
    throw new Error("not a complete Felucca backup");
  const objects = file.objects.map((o, i) => {
    if (!o || o.id !== ids[i] || !Number.isInteger(o.size) || o.size < 0 || o.size > (o.id >= 32 ? 81920 : 3840) ||
        !Number.isInteger(o.crc) || o.crc < 0 || o.crc > 0xFFFFFFFF || typeof o.data !== "string" ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(o.data))
      throw new Error("invalid backup object");
    const bytes = Uint8Array.from(atob(o.data), (c) => c.charCodeAt(0));
    if (bytes.length !== o.size || bkCrc(bytes) !== o.crc) throw new Error("backup checksum mismatch");
    return { ...o, bytes };
  });
  if (!objects[0].size || !objects[1].size) throw new Error("the backup is missing the current music or the settings");
  return { ...file, objects };
}

export function summariseArchive(a) {
  const bytes = a.objects.reduce((k, o) => k + o.size, 0);
  const withData = a.objects.filter((o) => o.size > 0).length;
  return `${a.objects.length} objects · ${(bytes / 1024).toFixed(1)} KB · ${withData} with data`;
}
