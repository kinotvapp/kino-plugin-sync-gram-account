// Sync-Gram Cuenta's rounds end to end: the built plugin (plugin.js, the bundle) in the kit's sandbox against the
// vendored fake cluster with Saved Messages. A device's session is stored the way the plugin's QR login stores it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cluster, device, signIn, blobOf, bundles, API, BUILT } from "./harness.mjs";
import { openSession } from "../testkit/session-open.mjs";

const CAP = 4194304;

/** A device signed in to the fake account, with one runtime loaded. */
async function rig({ lang = "es-CO", values } = {}) {
  const c = cluster();
  const d = device({ lang });
  await signIn(d, c);
  const p = await d.runtime(values);
  return { c, d, p, close: () => { d.close(); c.close(); } };
}
const methods = (c) => c.saved.log.map((e) => e.method);

test("plugin.js is the bundle of src/plugin.js (rebuild with: npm run build)", () => {
  assert.equal(readFileSync(BUILT, "utf8"), bundles().real);
});

test("push then pull: the blob goes to Saved Messages as a silent pinned kino-sync.bin in 128 KiB parts and comes back byte for byte", async () => {
  const { c, p, close } = await rig();
  try {
    assert.equal(await p.syncPull({ maxBlobBytes: CAP }), null);
    const blob = blobOf(300000, 7);
    const { version } = await p.syncPush({ blob, expectedVersion: null, maxBlobBytes: CAP });
    assert.deepEqual(c.saved.pinnedSnapshots(), [Number(version)]);
    const send = c.saved.log.filter((e) => e.method === "sendMedia");
    assert.deepEqual(send.map((s) => [s.silent, s.peer, s.forceFile, s.caption]), [[true, "self", true, ""]]);
    const pins = c.saved.log.filter((e) => e.method === "updatePinnedMessage");
    assert.deepEqual(pins.map((x) => [x.silent, x.unpin, x.peer]), [[true, false, "self"]]);
    assert.deepEqual(c.saved.log.filter((e) => e.method === "saveFilePart").map((x) => x.size), [131072, 131072, 300000 - 262144]);
    assert.equal(c.saved.snapshotData(Number(version)).toString("base64"), blob);
    assert.deepEqual(await p.syncPull({ maxBlobBytes: CAP }), { blob, version });
    assert.deepEqual(await p.syncStatus(null), { ready: true, message: "Conectado con tu cuenta: la copia está en tus Mensajes guardados, fijada y en silencio." });
  } finally { close(); }
});

test("a 4 MiB blob goes up in exactly 32 parts of 128 KiB; one byte more is refused before anything is sent", async () => {
  const { c, p, close } = await rig();
  try {
    const blob = blobOf(CAP, 3);
    const { version } = await p.syncPush({ blob, expectedVersion: null, maxBlobBytes: CAP });
    const parts = c.saved.log.filter((e) => e.method === "saveFilePart");
    assert.equal(parts.length, 32);
    assert.ok(parts.every((x) => x.size === 131072));
    assert.equal((await p.syncPull({ maxBlobBytes: CAP })).blob, blob);
    c.saved.log.length = 0;
    const tooBig = blobOf(CAP + 1, 4);
    await assert.rejects(p.syncPush({ blob: tooBig, expectedVersion: version, maxBlobBytes: CAP }), (e) => e.code === "unavailable");
    await assert.rejects(p.syncPush({ blob: blobOf(2000, 4), expectedVersion: version, maxBlobBytes: 1000 }), (e) => e.code === "unavailable");
    await assert.rejects(p.syncPush({ blob: "not base64!", expectedVersion: version }), (e) => e.code === "invalid_request");
    assert.deepEqual(methods(c), [], "nothing was sent");
  } finally { close(); }
});

test("a pinned copy over the cap is never downloaded", async () => {
  const { c, p, close } = await rig();
  try {
    c.saved.personPosts({ fileName: "kino-sync.bin", pinned: true, data: Buffer.alloc(5000) });
    c.saved.log.length = 0;
    const files = c.tg.dc(2).stats.getFile;
    await assert.rejects(p.syncPull({ maxBlobBytes: 4096 }), (e) => e.code === "unavailable");
    assert.equal(c.tg.dc(2).stats.getFile, files);
  } finally { close(); }
});

test("twelve pinned messages of the person, newer than the copy, do not hide it", async () => {
  const { c, p, close } = await rig();
  try {
    const v1 = (await p.syncPush({ blob: blobOf(800, 1), expectedVersion: null })).version;
    for (let i = 0; i < 12; i++) c.saved.personPosts({ text: "nota " + i, pinned: true });
    assert.deepEqual(await p.syncPull({}), { blob: blobOf(800, 1), version: v1 });
    assert.deepEqual(await p.syncStatus(null), { ready: true, message: "Conectado con tu cuenta: la copia está en tus Mensajes guardados, fijada y en silencio." });
    const v2 = (await p.syncPush({ blob: blobOf(800, 2), expectedVersion: v1 })).version;
    assert.deepEqual(c.saved.pinnedSnapshots(), [Number(v2)], "the old copy was found and deleted");
  } finally { close(); }
});

test("conflict: a stale expectedVersion (or a version when nothing is pinned) sends nothing but the search", async () => {
  const { c, p, close } = await rig();
  try {
    await assert.rejects(p.syncPush({ blob: blobOf(100, 1), expectedVersion: "999" }), (e) => e.code === "conflict");
    const v1 = (await p.syncPush({ blob: blobOf(100, 1), expectedVersion: null })).version;
    c.saved.log.length = 0;
    await assert.rejects(p.syncPush({ blob: blobOf(100, 2), expectedVersion: null }), (e) => e.code === "conflict");
    await assert.rejects(p.syncPush({ blob: blobOf(100, 2), expectedVersion: String(Number(v1) - 1) }), (e) => e.code === "conflict");
    assert.deepEqual(methods(c), ["search", "search"]);
    assert.deepEqual(c.saved.pinnedSnapshots(), [Number(v1)]);
  } finally { close(); }
});

test("a second push replaces the copy: the old one is deleted from Saved Messages only; the person's own pins stay", async () => {
  const { c, p, close } = await rig();
  try {
    const mine = c.saved.personPosts({ text: "my own pinned note", pinned: true });
    const theirs = c.saved.personPosts({ fileName: "notes.pdf", pinned: true });
    const v1 = (await p.syncPush({ blob: blobOf(1000, 1), expectedVersion: null })).version;
    const v2 = (await p.syncPush({ blob: blobOf(1000, 3), expectedVersion: v1 })).version;
    assert.deepEqual(c.saved.pinnedSnapshots(), [Number(v2)]);
    assert.deepEqual(c.saved.log.filter((e) => e.method === "deleteMessages").map((x) => [x.ids, x.chats]), [[[Number(v1)], ["saved"]]]);
    assert.ok(c.saved.saved.messages.get(mine).pinned && c.saved.saved.messages.get(theirs).pinned);
    assert.equal((await p.syncPull({})).blob, blobOf(1000, 3));
  } finally { close(); }
});

test("two devices pushing at once: the one whose copy is not the newest pin deletes only its own copy and answers conflict", async () => {
  const { c, p, close } = await rig();
  try {
    const v1 = (await p.syncPush({ blob: blobOf(500, 1), expectedVersion: null })).version;
    // Another device pins its copy between this push's pin and its re-check.
    let other = 0;
    const realPin = c.saved.updatePinnedMessage.bind(c.saved);
    c.saved.updatePinnedMessage = (r) => {
      const answer = realPin(r);
      c.saved.updatePinnedMessage = realPin;
      other = c.saved.personPosts({ fileName: "kino-sync.bin", pinned: true, data: Buffer.from("other device") });
      return answer;
    };
    c.saved.log.length = 0;
    await assert.rejects(p.syncPush({ blob: blobOf(500, 2), expectedVersion: v1 }), (e) => e.code === "conflict");
    const sent = c.saved.log.find((e) => e.method === "sendMedia").id;
    assert.deepEqual(c.saved.log.filter((e) => e.method === "deleteMessages").map((x) => x.ids), [[sent]]);
    assert.deepEqual(c.saved.pinnedSnapshots(), [other, Number(v1)], "the old copy is still there: the winner deletes it");
  } finally { close(); }
});

for (const [step, method] of [["a part", "saveFilePart"], ["the send", "sendMedia"], ["the pin", "updatePinnedMessage"], ["the re-check", "search2"]]) {
  test(`a failure at ${step} never deletes or unpins the old copy`, async () => {
    const { c, p, close } = await rig();
    try {
      const v1 = (await p.syncPush({ blob: blobOf(200000, 1), expectedVersion: null })).version;
      c.saved.log.length = 0;
      if (method === "search2") {
        const realSearch = c.saved.search.bind(c.saved);
        let n = 0;
        c.saved.search = (r) => { if (++n === 2) { c.saved.search = realSearch; c.saved.log.push({ method: "search", failed: true }); throw { rpc: [500, "INTERNAL"] }; } return realSearch(r); };
      } else {
        c.saved.failNext(method, 500, "INTERNAL");
      }
      await assert.rejects(p.syncPush({ blob: blobOf(200000, 2), expectedVersion: v1 }), (e) => e.code === "unavailable");
      assert.ok(c.saved.pinnedSnapshots().includes(Number(v1)), "the old copy is still pinned");
      assert.equal(c.saved.snapshotData(Number(v1)).toString("base64"), blobOf(200000, 1));
      const deleted = c.saved.log.filter((e) => e.method === "deleteMessages").flatMap((x) => x.ids);
      assert.ok(!deleted.includes(Number(v1)), "never the old copy");
      const sent = c.saved.log.find((e) => e.method === "sendMedia" && e.id);
      if (method === "updatePinnedMessage") assert.deepEqual(deleted, [sent.id], "only the unpinned copy this push sent");
      if (method === "saveFilePart" || method === "sendMedia") assert.deepEqual(deleted, []);
      // Before the pin the old copy is still the newest; after it (the re-check failed) the new copy is pinned too and is
      // the newest, so the next pull hands it over and the old one waits for the next push to delete it.
      assert.equal((await p.syncPull({})).blob, blobOf(200000, method === "search2" ? 2 : 1));
    } finally { close(); }
  });
}

test("FLOOD_WAIT is never retried inside the call: rate_limited at once, rounds wait quietly until it is over", async () => {
  const { c, d, p, close } = await rig();
  try {
    const v1 = (await p.syncPush({ blob: blobOf(300000, 1), expectedVersion: null })).version;
    c.saved.log.length = 0;
    c.saved.failNext("saveFilePart", 420, "FLOOD_WAIT_30");
    await assert.rejects(p.syncPush({ blob: blobOf(300000, 2), expectedVersion: v1 }), (e) => e.code === "rate_limited" && /30 s/.test(e.message));
    assert.deepEqual(methods(c), ["search", "saveFilePart"], "one attempt, no retry");
    assert.ok(c.saved.pinnedSnapshots().includes(Number(v1)));
    c.saved.log.length = 0;
    // While the wait runs: nothing goes out, from this runtime or a new one.
    await assert.rejects(p.syncPull({}), (e) => e.code === "rate_limited");
    const p2 = await d.runtime();
    await assert.rejects(p2.syncPush({ blob: blobOf(10, 3), expectedVersion: v1 }), (e) => e.code === "rate_limited");
    const st = await p2.syncStatus(null);
    assert.equal(st.ready, false);
    assert.match(st.message, /esperar \d+ s/);
    assert.deepEqual(methods(c), []);
    // Once it is over, rounds run again.
    d.base.storage.set("tg.wait", JSON.stringify({ until: Date.now() - 1 }));
    assert.equal((await p2.syncPull({})).blob, blobOf(300000, 1));
  } finally { close(); }
});

test("sendMedia is never sent twice inside a call: a connection that drops after the send fails the push, the old copy stays", async () => {
  const { c, p, close } = await rig();
  try {
    const v1 = (await p.syncPush({ blob: blobOf(1000, 1), expectedVersion: null })).version;
    c.saved.log.length = 0;
    c.saved.closeAfter("sendMedia");
    await assert.rejects(p.syncPush({ blob: blobOf(1000, 2), expectedVersion: v1 }), (e) => e.code === "unavailable");
    assert.equal(c.saved.log.filter((e) => e.method === "sendMedia").length, 1, "one send, no retry");
    assert.deepEqual(c.saved.pinnedSnapshots(), [Number(v1)]);
    assert.equal((await p.syncPull({})).blob, blobOf(1000, 1));
  } finally { close(); }
});

for (const method of ["sendMedia", "updatePinnedMessage"]) {
  test(`FLOOD_WAIT on ${method}: rate_limited at once, nothing else is sent after it (no delete), the old copy stays`, async () => {
    const { c, p, close } = await rig();
    try {
      const v1 = (await p.syncPush({ blob: blobOf(1000, 1), expectedVersion: null })).version;
      c.saved.log.length = 0;
      c.saved.failNext(method, 420, "FLOOD_WAIT_45");
      await assert.rejects(p.syncPush({ blob: blobOf(1000, 2), expectedVersion: v1 }), (e) => e.code === "rate_limited" && /45 s/.test(e.message));
      const after = methods(c);
      assert.equal(after[after.length - 1], method, "the flooded call is the last one sent: " + after.join(","));
      assert.equal(after.filter((m) => m === method).length, 1, "not retried");
      assert.ok(!after.includes("deleteMessages"));
      assert.ok(c.saved.pinnedSnapshots().includes(Number(v1)));
    } finally { close(); }
  });
}

test("FLOOD_WAIT on a download is mapped the same way", async () => {
  const { c, p, close } = await rig();
  try {
    await p.syncPush({ blob: blobOf(1000, 1), expectedVersion: null });
    c.tg.dc(2).once("getFile", () => ({ error: [420, "FLOOD_WAIT_7"] }));
    const files = c.tg.dc(2).stats.getFile;
    await assert.rejects(p.syncPull({}), (e) => e.code === "rate_limited" && /7 s/.test(e.message));
    assert.ok(c.tg.dc(2).stats.getFile - files <= 1, "not retried");
  } finally { close(); }
});

test("no session on this device: every round fails at once with auth_required (reason signin), no network, no key exchange", async () => {
  const c = cluster();
  const d = device();
  try {
    const p = await d.runtime();
    for (const call of [() => p.syncPull({}), () => p.syncPush({ blob: blobOf(10, 1), expectedVersion: null })]) {
      await assert.rejects(call(), (e) => e.code === "auth_required" && /not signed in: signin/.test(e.message));
    }
    assert.deepEqual(await p.syncStatus(null), { ready: false, message: "Falta iniciar sesión en este aparato: escribe tu número con el código de país y toca Enviar código." });
    assert.equal(c.tg.dc(2).stats.connections + c.tg.dc(1).stats.connections, 0);
    const missing = await d.runtime({});
    await assert.rejects(missing.syncPull({}), (e) => e.code === "auth_required" && /api_missing/.test(e.message));
    const en = await d.runtime(undefined, { lang: "en" });
    assert.deepEqual(await en.syncStatus(null), { ready: false, message: "You still need to sign in on this device: enter your number with its country code and tap Send the code." });
  } finally { d.close(); c.close(); }
});

test("a stored session is reused by every new runtime: no key exchange, no login", async () => {
  const { c, d, p, close } = await rig();
  try {
    await p.syncPush({ blob: blobOf(100, 1), expectedVersion: null });
    const keys = c.tg.dc(2).stats.keyExchanges;
    const p2 = await d.runtime();
    assert.equal((await p2.syncPull({})).blob, blobOf(100, 1));
    assert.equal(c.tg.dc(2).stats.keyExchanges, keys);
    assert.equal(c.account.stats.exportLoginToken, 2, "only the first device login (one token, one success)");
  } finally { close(); }
});

test("two rounds starting together on a cold runtime share one connection (one client per auth key)", async () => {
  const { c, d, p, close } = await rig();
  try {
    await p.syncPush({ blob: blobOf(100, 1), expectedVersion: null });
    const before = c.tg.dc(2).stats.connections;
    const cold = await d.runtime();
    const [pulled, status] = await Promise.all([cold.syncPull({}), cold.syncStatus(null)]);
    assert.equal(pulled.blob, blobOf(100, 1));
    assert.equal(status.ready, true);
    assert.equal(c.tg.dc(2).stats.connections, before + 1);
  } finally { close(); }
});

test("the stored session stays sealed: it opens only with the api_hash, holds no key in clear, and the api_hash is never stored or logged", async () => {
  const { d, p, close } = await rig();
  try {
    await p.syncPush({ blob: blobOf(100, 1), expectedVersion: null });
    const stored = d.base.storage.get("tg.usession");
    const state = openSession(stored, { api_hash: API.api_hash, api_id: API.api_id, account: true });
    assert.ok(state.dcs["2"].loggedIn);
    const key = state.dcs["2"].authKey;
    const dump = d.storageDump() + d.logs.join("\n");
    assert.ok(!dump.includes(key), "auth key never in clear");
    assert.ok(!dump.includes(API.api_hash), "api_hash never stored or logged");
    assert.throws(() => openSession(stored, { api_hash: "f".repeat(32), api_id: API.api_id, account: true }));
  } finally { close(); }
});

test("Telegram ended the session (Settings > Devices): auth_required reason closed, the session is dropped, the status says so", async () => {
  const { c, d, p, close } = await rig();
  try {
    await p.syncPush({ blob: blobOf(100, 1), expectedVersion: null });
    c.account.revoke();
    await assert.rejects(p.syncPull({}), (e) => e.code === "auth_required" && /closed/.test(e.message));
    assert.equal(d.base.storage.get("tg.usession"), null);
    const p2 = await d.runtime();
    await assert.rejects(p2.syncPull({}), (e) => e.code === "auth_required" && /closed/.test(e.message));
    assert.match((await p2.syncStatus(null)).message, /Telegram cerró la sesión de este aparato \(Ajustes ▸ Dispositivos\)\. Vuelve a iniciar sesión con tu número/);
  } finally { close(); }
});

test("a stale file reference is refreshed once with a self search bounded to the copy's id", async () => {
  const { c, p, close } = await rig();
  try {
    const { version } = await p.syncPush({ blob: blobOf(5000, 4), expectedVersion: null });
    c.tg.dc(2).once("getFile", () => ({ error: [400, "FILE_REFERENCE_EXPIRED"] }));
    c.saved.log.length = 0;
    assert.equal((await p.syncPull({})).blob, blobOf(5000, 4));
    assert.deepEqual(c.saved.log.map((e) => [e.method, e.minId, e.maxId]), [["search", 0, 0], ["search", Number(version) - 1, Number(version) + 1]]);
  } finally { close(); }
});

test("a stale file reference whose copy vanished meanwhile is an error, never an empty remote", async () => {
  const { c, p, close } = await rig();
  try {
    const { version } = await p.syncPush({ blob: blobOf(5000, 4), expectedVersion: null });
    // Another device deletes the copy while this one finds its reference stale.
    c.tg.dc(2).once("getFile", () => { c.saved.saved.messages.delete(Number(version)); return { error: [400, "FILE_REFERENCE_EXPIRED"] }; });
    await assert.rejects(p.syncPull({}), (e) => e.code === "unavailable");
  } finally { close(); }
});
