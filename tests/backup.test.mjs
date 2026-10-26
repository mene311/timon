// The archive reader (js/backup.js): pack7, u32, CRC-32, and a whole backup against a fake unit.
import assert from "node:assert/strict";
import { pack7, unpack7, u32, r32, crc32, decodeList, readArchive, summariseArchive } from "../js/backup.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("  ok  " + name); };
const ta = async (name, fn) => { await fn(); n++; console.log("  ok  " + name); };

t("pack7/unpack7 round-trip a whole range of bytes", () => {
  const src = Uint8Array.from({ length: 1024 }, (_, i) => (i * 37 + 11) & 0xFF);
  assert.deepEqual(Array.from(unpack7(pack7(src))), Array.from(src));
  assert.deepEqual(pack7([0]), [0, 0]);          // 8 bits in, 7 + 1 out (Skiff's own packer)
  assert.equal(pack7(new Array(7).fill(0x7F)).length, 8);
});

t("u32 is five 7-bit bytes, the last 4 bits", () => {
  assert.deepEqual(u32(0), [0, 0, 0, 0, 0]);
  assert.deepEqual(u32(1), [1, 0, 0, 0, 0]);
  assert.deepEqual(u32(127), [127, 0, 0, 0, 0]);
  assert.deepEqual(u32(128), [0, 1, 0, 0, 0]);
  for (const v of [0, 1, 5000, 1 << 20, 0xFFFFFFFF]) assert.equal(r32(u32(v)), v >>> 0);
});

t("crc32 matches zlib's value for '123456789'", () => {
  assert.equal(crc32(Uint8Array.from("123456789", (c) => c.charCodeAt(0))), 0xCBF43926);
});

t("BACKUP_LIST decodes id/size/crc per object", () => {
  const args = [1, 0, 2, 0, ...u32(3648), ...u32(0xDEADBEEF), 32, ...u32(512), ...u32(1)];
  const l = decodeList(args);
  assert.equal(l.objects.length, 2);
  assert.deepEqual(l.objects[0], { id: 0, size: 3648, crc: 0xDEADBEEF });
  assert.deepEqual(l.objects[1], { id: 32, size: 512, crc: 1 });
});

// a fake unit holding two objects
function fakeUnit() {
  const store = new Map();
  const a = Uint8Array.from({ length: 700 }, (_, i) => (i * 13) & 0xFF);
  const b = Uint8Array.from({ length: 300 }, (_, i) => (i * 7 + 3) & 0xFF);
  store.set(0, a); store.set(32, b);
  return {
    store,
    async backupList() {
      const args = [1, 0, store.size];
      for (const [id, data] of store) args.push(id, ...u32(data.length), ...u32(crc32(data)));
      return args;
    },
    async getObject(id, offset, count) {
      const data = store.get(id);
      if (!data) return { rc: 1 };
      return { rc: 0, offset, data: data.slice(offset, offset + count) };
    },
  };
}

await ta("readArchive reads every object and verifies its CRC", async () => {
  const dev = fakeUnit();
  const a = await readArchive(dev);
  assert.equal(a.objects.length, 2);
  assert.equal(a.objects[0].data.length, 700);
  assert.equal(a.objects[1].data.length, 300);
  assert.deepEqual(Array.from(a.objects[0].data.slice(0, 4)), [0, 13, 26, 39]);
  assert.match(summariseArchive(a), /2 objects/);
});

await ta("a unit that changes mid-read is caught by the CRC", async () => {
  const dev = fakeUnit();
  const real = dev.getObject;
  dev.getObject = async (id, o, c) => {
    const r = await real(id, o, c);
    if (o === 512) r.data = r.data.map((x, i) => (i === 0 ? x ^ 0xFF : x));
    return r;
  };
  await assert.rejects(() => readArchive(dev), /CRC .* the unit changed/);
});

await ta("a piece the unit refuses stops the read with the reason", async () => {
  const dev = fakeUnit();
  dev.getObject = async () => ({ rc: 3 });
  await assert.rejects(() => readArchive(dev), /the unit refused at byte 0 \(it is playing\)/);
});

await ta("a short piece is an error, not silent padding", async () => {
  const dev = fakeUnit();
  const real = dev.getObject;
  dev.getObject = async (id, o, c) => {
    const r = await real(id, o, c);
    r.data = r.data.slice(0, Math.max(0, c - 1));
    return r;
  };
  await assert.rejects(() => readArchive(dev), /asked 256 bytes at 0, got 255/);
});

console.log(`\n${n} backup tests passed`);
