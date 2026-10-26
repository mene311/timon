// The archive layer (js/backup.js): Skiff's own encodings, its manifest checks, and a whole capture
// against a fake unit.   node tests/backup.test.mjs
import assert from "node:assert/strict";
import { bkPack, bkUnpack, bkCrc, bkU32, bkR32, bkManifest, captureBackup, readBackup, idsOf,
         BACKUP_IDS, summariseArchive } from "../js/backup.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("  ok  " + name); };
const ta = async (name, fn) => { await fn(); n++; console.log("  ok  " + name); };

t("bkPack/bkUnpack: seven bytes into eight septets, high bits in the mask", () => {
  assert.deepEqual(bkPack(Uint8Array.from([0, 0, 0, 0, 0, 0, 0])), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(bkPack(Uint8Array.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80])),
                   [0x7F, 0, 0, 0, 0, 0, 0, 0]);            // every mask bit set, every byte 0
  const src = Uint8Array.from({ length: 300 }, (_, i) => (i * 37 + 200) & 0xFF);
  assert.equal(bkPack(src).length, 343);                   // 42 full groups + a 6-byte group
  assert.deepEqual(Array.from(bkUnpack(bkPack(src), 300)), Array.from(src));
});

t("bkUnpack refuses a mask that claims bits it has no bytes for", () => {
  assert.throws(() => bkUnpack([0x02, 1], 1), /invalid archive bytes/);
  assert.throws(() => bkUnpack([0, 1, 2], 1), /trailing archive bytes/);
});

t("u32 is five 7-bit bytes and comes back exactly", () => {
  for (const v of [0, 1, 127, 128, 5000, 1 << 20, 0xFFFFFFFF]) assert.equal(bkR32(bkU32(v)), v >>> 0);
  assert.throws(() => bkR32([0, 0, 0, 0, 16]), /invalid archive number/);
});

t("crc32 matches zlib", () => {
  assert.equal(bkCrc(Uint8Array.from("123456789", (c) => c.charCodeAt(0))), 0xCBF43926);
});

t("the object list is chosen by count, and only those counts are valid", () => {
  assert.equal(BACKUP_IDS.length, 29);
  assert.equal(idsOf(29).length, 29);
  assert.equal(idsOf(13).length, 13);
  assert.equal(idsOf(12).length, 12);
  assert.equal(idsOf(11).length, 11);
  assert.equal(idsOf(99), null);
});

const manifestArgs = (objs) => {
  const a = [1, 0, objs.length];
  for (const o of objs) a.push(o.id, ...bkU32(o.size), ...bkU32(o.crc));
  return a;
};

t("a manifest with the wrong ids is refused", () => {
  const objs = idsOf(13).map((id, i) => ({ id, size: 0, crc: 0 }));
  objs[3].id = 99;
  assert.throws(() => bkManifest(manifestArgs(objs)), /unexpected archive object/);
});

t("a manifest object bigger than its kind allows is refused", () => {
  const objs = BACKUP_IDS.map((id) => ({ id, size: 0, crc: 0 }));
  objs[0] = { id: 0, size: 4000, crc: 0 };                 // 3840 is the limit for a non-sample object
  assert.throws(() => bkManifest(manifestArgs(objs)), /too large/);
});

t("a manifest that claims a crc with no size is refused", () => {
  const objs = BACKUP_IDS.map((id) => ({ id, size: 0, crc: 0 }));
  objs[2] = { id: 2, size: 0, crc: 1234 };
  assert.throws(() => bkManifest(manifestArgs(objs)), /too large/);
});

function fakeUnit({ mutateAt = -1 } = {}) {
  const store = new Map();
  store.set(0, Uint8Array.from({ length: 700 }, (_, i) => (i * 13) & 0xFF));
  store.set(1, Uint8Array.from({ length: 656 }, (_, i) => (i * 5 + 7) & 0xFF));
  for (const id of BACKUP_IDS) if (!store.has(id)) store.set(id, new Uint8Array(0));
  const sizes = () => BACKUP_IDS.map((id) => ({ id, size: store.get(id).length, crc: bkCrc(store.get(id)) }));
  return {
    store,
    ask: async (cmd) => (cmd === 65 ? (() => { const s = sizes(); const a = [1, 0, s.length];
      for (const o of s) a.push(o.id, ...bkU32(o.size), ...bkU32(o.crc)); return a; })() : null),
    async backupList() { return this.ask(65); },
    async getObject(id, offset, count) {
      const data = store.get(id);
      const piece = data.slice(offset, offset + count);
      if (offset === mutateAt) piece[0] ^= 0xFF;            // the unit changing mid-read
      return [id, 0, ...bkU32(offset), count & 127, count >>> 7, ...bkPack(piece)];
    },
  };
}

await ta("captureBackup writes a Felucca backup Skiff's reader accepts", async () => {
  const dev = fakeUnit();
  const file = await captureBackup(dev, "v2.0.1");
  assert.equal(file.format, "felucca-backup");
  assert.equal(file.version, 1);
  assert.equal(file.firmware, "v2.0.1");
  assert.equal(file.objects.length, 29);
  assert.deepEqual(file.objects.map((o) => o.id), BACKUP_IDS);
  const back = readBackup(JSON.stringify(file));            // validate the round trip
  assert.equal(back.objects[0].bytes.length, 700);
  assert.deepEqual(Array.from(back.objects[0].bytes.slice(0, 4)), [0, 13, 26, 39]);
  assert.match(summariseArchive(file), /29 objects/);
});

await ta("a unit that changes mid-capture is caught", async () => {
  const dev = fakeUnit({ mutateAt: 256 });
  await assert.rejects(() => captureBackup(dev, "v2.0.1"), /changed during the backup/);
});

await ta("readBackup rejects a file whose bytes do not match its crc", async () => {
  const dev = fakeUnit();
  const file = await captureBackup(dev, "v2.0.1");
  file.objects[0].data = file.objects[0].data.replace(/^./, (c) => (c === "A" ? "B" : "A"));
  assert.throws(() => readBackup(file), /checksum mismatch|invalid backup object/);
});

await ta("readBackup rejects a file that is not a Felucca backup", () => {
  assert.throws(() => readBackup({ format: "timon-backup", version: 1, objects: [] }), /not a complete Felucca backup/);
});

console.log(`\n${n} backup tests passed`);
