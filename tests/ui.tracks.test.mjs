// Drives the real rack module in jsdom: the per-track bank/roll model and the T1..T6 selector.
//   node tests/ui.tracks.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8")
  .replace(/<script[\s\S]*?<\/script>/g, "");            // jsdom runs no modules: we import them ourselves

const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, runScripts: "outside-only" });
const { window } = dom;
const ctx2d = new Proxy({}, { get: (t, k) => (k === "canvas" ? {} : () => undefined), set: () => true });
window.HTMLCanvasElement.prototype.getContext = () => ctx2d;
window.HTMLCanvasElement.prototype.toDataURL = () => "data:,";
const G = {
  window, document: window.document, navigator: window.navigator, location: window.location,
  localStorage: window.localStorage, HTMLElement: window.HTMLElement, HTMLCanvasElement: window.HTMLCanvasElement,
  Event: window.Event, CustomEvent: window.CustomEvent, requestAnimationFrame: (f) => setTimeout(f, 0),
  cancelAnimationFrame: clearTimeout, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  performance: window.performance,
  getComputedStyle: (el) => window.getComputedStyle(el),
  DOMParser: window.DOMParser, Node: window.Node, Element: window.Element,
  HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement,
  Option: window.Option, MutationObserver: window.MutationObserver, IntersectionObserver: window.IntersectionObserver,
  EventTarget: window.EventTarget, CustomElementRegistry: window.CustomElementRegistry, queueMicrotask: queueMicrotask,
  structuredClone: structuredClone, AbortController: window.AbortController, FileReader: window.FileReader, FormData: window.FormData,
  KeyboardEvent: window.KeyboardEvent, MouseEvent: window.MouseEvent, Blob: window.Blob, URL: window.URL,
};
for (const [k, v] of Object.entries(G))      // node 26 has some of these as getter-only globals
  Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true });
window.AudioContext = window.webkitAudioContext = class {
  constructor() { this.state = "running"; this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; }
  createGain() { return { gain: { value: 1, setValueAtTime() {} }, connect() {}, disconnect() {} }; }
  createOscillator() { return { frequency: { value: 0, setValueAtTime() {} }, connect() {}, start() {}, stop() {}, type: "sine" }; }
  createBiquadFilter() { return { frequency: { value: 0 }, Q: { value: 0 }, connect() {}, type: "lowpass" }; }
  resume() { return Promise.resolve(); } close() { return Promise.resolve(); }
};
window.navigator.requestMIDIAccess = () => Promise.reject(new Error("no MIDI in jsdom"));
window.navigator.wakeLock = undefined;
window.speechSynthesis = { speak() {}, cancel() {} };

const status = () => document.getElementById("status")?.textContent ?? "";
const label = () => document.querySelector("#presets .plabel")?.textContent ?? "";
const opts = () => [...document.querySelectorAll("#ftrack option")].map((o) => [o.value, o.textContent]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("  ok  " + name); };

await import("../js/rack.js");
await sleep(30);

t("the rack builds its UI into the page", () => {
  assert.ok(document.getElementById("roll"), "the piano roll canvas exists");
  assert.ok(document.getElementById("freeze"), "the freeze button exists");
  assert.ok(document.getElementById("presets"), "the preset bank exists");
});

t("the destination select offers six tracks, T1..T6", () => {
  const o = opts();
  assert.equal(o.length, 6, `got ${JSON.stringify(o)}`);
  assert.deepEqual(o.map(([v]) => v), ["0", "1", "2", "3", "4", "5"]);
  assert.deepEqual(o.map(([, l]) => l), ["T1", "T2", "T3", "T4", "T5", "T6"]);
});

await (async () => {
  const ft = document.getElementById("ftrack");
  const before = label();
  ft.value = "4";                                        // T5
  ft.dispatchEvent(new window.Event("change"));
  await sleep(10);                                       // (midi.js answers late when there is no MIDI)
  t("switching track moves the preset bank to that track", () => {
    assert.equal(label(), "T5", `the preset bank follows the track (was ${before})`);
  });
  t("the track we left remembers its cursor", () => {
    const cur = JSON.parse(localStorage.getItem("fm1p-felucca.trackcursor") || "{}");
    assert.ok("0" in cur, `cursor map was ${JSON.stringify(cur)}`);
  });
  t("the status line names the track it switched to", () => {
    assert.match(status(), /track 5|track 1/i, `status was ${JSON.stringify(status())}`);
  });
})();

await (async () => {
  const ft = document.getElementById("ftrack");
  ft.value = "0";
  ft.dispatchEvent(new window.Event("change"));
  await sleep(10);
  t("going back to T1 restores that track's state", () => {
    assert.equal(label(), "T1");
  });
})();


// ---- drum mode and the tempo link ---------------------------------------------------------
const sectByTitle = (title) => [...document.querySelectorAll("section.sect")]
  .find((s) => s.querySelector("h3")?.textContent === title);

await (async () => {
  const ft = document.getElementById("ftrack");
  ft.value = "5";                                        // T6: a drum track by default
  ft.dispatchEvent(new window.Event("change"));
  await sleep(10);

  t("T6 comes up as a drum track", () => {
    assert.equal(document.getElementById("drummode").textContent.trim(), "DRUM ✓");
  });
  t("a drum track hides the pitch section and shows the lanes", () => {
    assert.equal(sectByTitle("Pitch").style.display, "none", "Pitch must be off");
    assert.equal(sectByTitle("Shape").style.display, "none", "the pitch shaping knobs too");
    assert.notEqual(sectByTitle("Lanes").style.display, "none", "the lanes must be shown");
  });
  t("the lane knobs are the four lanes plus rotate and grid", () => {
    const labels = [...sectByTitle("Lanes").querySelectorAll(".k-lab")].map((e) => e.textContent.trim()).join(" ");
    for (const w of ["Kick", "Snare", "Hat", "Open hat", "Rotate", "Grid"])
      assert.ok(labels.includes(w), `missing ${w} in ${JSON.stringify(labels.slice(0, 120))}`);
  });

  // switching back to a melody track brings the pitch section back
  ft.value = "0";
  ft.dispatchEvent(new window.Event("change"));
  await sleep(10);
  t("a melody track gets Pitch and Shape back and loses the lanes", () => {
    assert.equal(sectByTitle("Pitch").style.display, "", "Pitch must be visible");
    assert.equal(sectByTitle("Lanes").style.display, "none", "the lanes must be hidden");
    assert.equal(document.getElementById("drummode").textContent.trim(), "DRUM");
  });
})();

t("the tempo link button exists, offers four states and remembers the choice", () => {
  const b = document.getElementById("tempolink");
  assert.ok(b, "no #tempolink");
  assert.match(b.textContent, /BPM/);
  const seen = new Set();
  for (let i = 0; i < 4; i++) { seen.add(b.textContent); b.dispatchEvent(new window.Event("click")); }
  assert.equal(seen.size, 4, `the four states: ${[...seen].join(" / ")}`);
  assert.ok(localStorage.getItem("fm1p-tempo-link"), "the choice is stored");
});

console.log(`\n${n} ui tests passed`);

