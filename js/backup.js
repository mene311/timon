// backup.js — read the whole unit (BACKUP_LIST 65 / BACKUP_GET 66), byte for byte.
// Skiff models its memory as 29 objects (2.0): 0 the project playing, 1 settings, 2..5 the stored
// projects, 6/7 the user preset banks, 8 the FM6 bank, 9 the user presets, 16..31 the pattern bank
// (four patterns a chunk: the 64-pattern pool), 32..34 the user sample slots. Each has a size and a
// CRC-32; a read that does not match its CRC means the unit changed under us and the read is void.
//
// The wire encodings are Skiff's own (web/fm1ota.js, web/fm1backup.js): pack7 LSB first, u32 as five
// 7-bit bytes.
export const BACKUP = { LIST: 65, GET: 66, PUT: 67 };

export function pack7(data) {
  const out = []; let acc = 0, nb = 0;
  for (const b of data) {
    acc |= (b & 0xFF) << nb; nb += 8;
    while (nb >= 7) { out.push(acc & 0x7F); acc >>>= 7; nb -= 7; }
  }
  if (nb) out.push(acc & 0x7F);
  return out;
}

export function unpack7(s) {
  const out = []; let acc = 0, nb = 0;
  for (const b of s) {
    acc |= (b & 0x7F) << nb; nb += 7;
    while (nb >= 8) { out.push(acc & 0xFF); acc >>>= 8; nb -= 8; }
  }
  return out;
}

export const u32 = (v) => [v & 0x7F, (v >> 7) & 0x7F, (v >> 14) & 0x7F, (v >> 21) & 0x7F, (v >>> 28) & 0x0F];
export const r32 = (a, at = 0) => (a[at] | (a[at + 1] << 7) | (a[at + 2] << 14) | (a[at + 3] << 21) | (a[at + 4] << 28)) >>> 0;

// zlib's CRC-32
let crcTable = null;
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// One object's id, size, crc from a BACKUP_LIST reply (op, rc, count, then id, size, crc per object).
export function decodeList(args) {
  const rc = args?.[1] ?? 0, count = args?.[2] ?? 0, objects = [];
  let at = 3;
  for (let i = 0; i < count && at + 11 <= args.length; i++) {   // id + size u32 + crc u32 = 11 bytes
    objects.push({ id: args[at], size: r32(args, at + 1), crc: r32(args, at + 6) });
    at += 11;
  }
  return { rc, objects };
}

// Read one object, piece by piece, and check it against the list's CRC.
// dev.getObject(id, offset, count) answers { rc, offset, data } with at most 256 decoded bytes.
export async function readObject(dev, obj, { piece = 256, onProgress = () => {} } = {}) {
  if (!obj.size) return { ...obj, data: new Uint8Array(0) };
  const out = new Uint8Array(obj.size);
  let at = 0;
  while (at < obj.size) {
    const n = Math.min(piece, obj.size - at);
    const r = await dev.getObject(obj.id, at, n);
    if (!r || r.rc !== 0) throw new Error(`object ${obj.id}: the unit refused at byte ${at}${r?.rc === 3 ? " (it is playing)" : ""}`);
    if (r.offset !== at) throw new Error(`object ${obj.id}: the unit answered offset ${r.offset} where ${at} was asked`);
    if (r.data.length !== n) throw new Error(`object ${obj.id}: asked ${n} bytes at ${at}, got ${r.data.length}`);
    out.set(r.data, at);
    at += n;
    onProgress(obj.id, at, obj.size);
  }
  const got = crc32(out);
  if (obj.crc && got !== obj.crc) throw new Error(`object ${obj.id}: CRC ${got.toString(16)} but the unit listed ${obj.crc.toString(16)} - the unit changed while reading`);
  return { ...obj, data: out };
}

// Every object: the unit's backup, as bytes.
export async function readArchive(dev, opts = {}) {
  const list = decodeList(await dev.backupList());
  if (list.rc !== 0) throw new Error(`BACKUP_LIST refused (rc ${list.rc})`);
  const objects = [];
  for (const o of list.objects) objects.push(await readObject(dev, o, opts));
  return { objects, bytes: objects.reduce((n, o) => n + o.data.length, 0) };
}

// A short description of an archive, for the panel.
export function summariseArchive(a) {
  const n = a.objects.length;
  const bytes = a.objects.reduce((k, o) => k + o.data.length, 0);
  const named = a.objects.filter((o) => o.size > 0);
  return `${n} objects · ${(bytes / 1024).toFixed(1)} KB · ${named.length} with data`;
}
