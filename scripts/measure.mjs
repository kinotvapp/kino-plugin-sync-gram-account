#!/usr/bin/env node
// Account mode's numbers (the Task 1 spike's, now on the plugin's own bundle), in the kit (Node + the kit's sandbox + the fake cluster) and in QuickJS (`qjs`, when installed):
//   node --expose-gc scripts/measure.mjs
// Kit numbers are a LOWER BOUND for a TV box: Node's JIT and the Mac's CPU, a fake DC on the same machine (no network,
// no RTT), kino.crypto in node:crypto. They say whether the shape is sane, not whether a KALLEY R3 copes.
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundles, cluster, device, signIn, blobOf, ROOT } from "../test/harness.mjs";

const gc = typeof globalThis.gc === "function" ? globalThis.gc : () => {};
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const mib = (n) => Math.round((n / 1048576) * 10) / 10;
const out = {};

// 1. Bundle size.
const { real } = bundles();
out.bundle = { bytes: Buffer.byteLength(real), gzipBytes: gzipSync(real).length };

// 2. Sandbox load (a fresh realm each time: what a plugin start costs in the kit).
const loads = [];
for (let i = 0; i < 15; i++) { const d = device(); loads.push((await d.runtime()).loadMs); d.close(); }
out.kitLoadMs = { median: Math.round(median(loads) * 10) / 10, min: Math.round(Math.min(...loads) * 10) / 10 };

// 3. Rounds.
async function round(bytes) {
  const c = cluster();
  const d = device();
  await signIn(d, c);
  const plugin = await d.runtime();
  const blob = blobOf(bytes, 9);
  const dc = c.tg.dc(2);
  // A copy is already pinned (the steady state): the measured push replaces it, so it deletes the old one too.
  const { version: previous } = await plugin.syncPush({ blob: blobOf(bytes, 3), expectedVersion: null, maxBlobBytes: 4194304 });
  const res = {};
  for (const phase of ["push", "pull"]) {
    gc();
    const heap0 = process.memoryUsage().heapUsed;
    c.saved.log.length = 0;
    const files0 = dc.stats.getFile;
    let peakHeap = heap0;
    const t0 = process.hrtime.bigint();
    const p = phase === "push" ? plugin.syncPush({ blob, expectedVersion: previous, maxBlobBytes: 4194304 }) : plugin.syncPull({ maxBlobBytes: 4194304 });
    const timer = setInterval(() => { peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed); }, 5);
    const answer = await p;
    clearInterval(timer);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    if (phase === "pull" && answer.blob !== blob) throw new Error("the pull did not give the blob back");
    const methods = {};
    for (const e of c.saved.log) methods[e.method] = (methods[e.method] || 0) + 1;
    const getFile = dc.stats.getFile - files0;
    if (getFile) methods.getFile = getFile;
    res[phase] = {
      ms: Math.round(ms), requests: Object.values(methods).reduce((a, b) => a + b, 0), methods,
      heapDeltaPeakMiB: mib(peakHeap - heap0),
    };
  }
  d.close(); c.close();
  return res;
}
out.rounds = { "100KB": await round(100000), "4MiB": await round(4194304) };

// 4. QuickJS: load (parse + evaluate) of the bundle and the JS passes a 4 MiB push makes, when `qjs` exists.
function qjs(args) { return execFileSync("qjs", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
try {
  qjs(["-e", "1"]);
  const dir = mkdtempSync(join(tmpdir(), "sync-gram-qjs-"));
  writeFileSync(join(dir, "plugin.js"), real);
  writeFileSync(join(dir, "empty.js"), "export const x = 1;\n");
  const runner = (target) => `const t0 = Date.now(); await import(${JSON.stringify(target)}); print("LOADMS " + (Date.now() - t0));\n`;
  writeFileSync(join(dir, "load.mjs"), runner("./plugin.js"));
  writeFileSync(join(dir, "load-empty.mjs"), runner("./empty.js"));
  const mem = (file) => {
    const text = qjs(["--std", "-d", join(dir, file)]);
    const m = /memory used\s+\d+\s+(\d+)/i.exec(text);
    const ms = Number((/LOADMS (\d+)/.exec(text) || [])[1]);
    return { used: m ? Number(m[1]) : null, ms, text };
  };
  const loadsQ = [];
  let full = null, empty = null;
  for (let i = 0; i < 7; i++) { full = mem("load.mjs"); loadsQ.push(full.ms); }
  empty = mem("load-empty.mjs");
  out.qjs = {
    version: (() => { try { return qjs(["-h"]); } catch (e) { return String(e.stdout || ""); } })().split("\n")[0],
    loadMs: { median: median(loadsQ), min: Math.min(...loadsQ) },
    heapAfterLoadKiB: full.used && empty.used ? Math.round((full.used - empty.used) / 1024) : null,
  };
  // The JS passes of a 4 MiB push and pull with native convert (fromHex per part, the Writer copy, the session's toHex;
  // the pull's per-chunk fromHex of the 16-byte headers is negligible) and without it (the base64 <-> bytes passes too).
  const bytesUrl = join(ROOT, "src/mtproto/bytes.js"), reqUrl = join(ROOT, "src/mtproto/sync-requests.js");
  writeFileSync(join(dir, "passes.mjs"), `
import { toHex, fromHex, toBase64, fromBase64 } from ${JSON.stringify(bytesUrl)};
import { saveFilePart, PART_BYTES } from ${JSON.stringify(reqUrl)};
const n = 4194304, data = new Uint8Array(n);
for (let i = 0; i < n; i++) data[i] = (i * 2654435761) >>> 24;
const hex = toHex(data), b64 = toBase64(data);
let t = Date.now();
for (let i = 0; i < n / PART_BYTES; i++) {
  const body = saveFilePart({ fileId: 1n, part: i, bytes: fromHex(hex.slice(i * PART_BYTES * 2, (i + 1) * PART_BYTES * 2)) });
  const wire = toHex(body);
}
print("PUSHPASSES " + (Date.now() - t));
t = Date.now(); const h2 = toHex(fromBase64(b64)); print("B64TOHEX " + (Date.now() - t));
t = Date.now(); const b2 = toBase64(fromHex(hex)); print("HEXTOB64 " + (Date.now() - t));
`);
  const p = qjs(["--std", join(dir, "passes.mjs")]);
  const num = (k) => Number((new RegExp(k + " (\\d+)").exec(p) || [])[1]);
  out.qjs.jsPasses4MiB = { pushPartsMs: num("PUSHPASSES"), base64ToHexJsMs: num("B64TOHEX"), hexToBase64JsMs: num("HEXTOB64") };
  // Peak QuickJS heap of the JS side of a 4 MiB round: the smallest --memory-limit under which the strings a round holds
  // (the same sizes, made with the vendored bytes.js; base64 <-> hex done in JS, the fallback when kino.crypto.convert is
  // missing, so this is an upper bound for that step) still fit. Native work (AES, CTR, kino.ws frames in Kotlin) is not
  // in it; each in-flight packet's copies are modelled as two hex strings of its size.
  writeFileSync(join(dir, "heap.mjs"), `
import { toHex, fromHex, toBase64, fromBase64 } from ${JSON.stringify(bytesUrl)};
import { saveFilePart, PART_BYTES } from ${JSON.stringify(reqUrl)};
const which = scriptArgs[1], n = 4194304, CH = 1048576;
const rnd = (k, s) => { const u = new Uint8Array(k); let x = s; for (let i = 0; i < k; i++) { x = (x * 1103515245 + 12345) >>> 0; u[i] = x >>> 24; } return u; };
if (which === "pull") {
  const chunks = [];
  for (let o = 0; o < n; o += CH) {
    let frame = toHex(rnd(CH + 64, o + 1));        // the decrypted packet (hex)
    chunks.push(frame.slice(48, 48 + CH * 2));     // the chunk sliced out of it
    frame = null;
  }
  let hex = chunks.join(""); chunks.length = 0;
  const blob = toBase64(fromHex(hex)); hex = null;
  if (blob.length !== 5592408) throw new Error("size");
} else {
  const blob = toBase64(rnd(n, 7));                // what Kino hands the plugin
  let hex = toHex(fromBase64(blob));
  for (let i = 0; i < n / PART_BYTES; i++) {
    const body = saveFilePart({ fileId: 1n, part: i, bytes: fromHex(hex.slice(i * PART_BYTES * 2, (i + 1) * PART_BYTES * 2)) });
    const plain = toHex(body), wire = plain.slice(0);  // the session's hex and the encrypted copy
  }
}
print("OK");
`);
  const fits = (which, limit) => { try { return /OK/.test(qjs(["--std", "--memory-limit", String(limit), join(dir, "heap.mjs"), which])); } catch { return false; } };
  const peak = (which) => {
    let lo = 1 << 20, hi = 256 << 20;
    if (!fits(which, hi)) return null;
    while (hi - lo > (256 << 10)) { const mid = Math.floor((lo + hi) / 2); if (fits(which, mid)) hi = mid; else lo = mid; }
    return mib(hi);
  };
  out.qjs.peakHeapMiB4MiB = { pull: peak("pull"), push: peak("push") };
  rmSync(dir, { recursive: true, force: true });
} catch (e) {
  out.qjs = { skipped: String(e && e.message).slice(0, 120) };
}

console.log(JSON.stringify(out, null, 2));
