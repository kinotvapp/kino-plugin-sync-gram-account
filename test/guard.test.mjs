// The delete and read guards of the `sync` client mode (review findings 1 and 2), against the fake cluster in this realm:
// messages.deleteMessages takes no peer and message ids are shared by every private chat and basic group, so the client
// itself accepts a delete only of ids it saw in an answer about Saved Messages (a self search, or the sendMedia that made
// the copy), without `revoke`; messages.getMessages is not on the list at all (a self search bounded by min_id/max_id
// re-reads a snapshot). round.js keeps its own, narrower guard (only this round's ids), tested with a stub client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cluster, API } from "./harness.mjs";
import { installKino } from "../testkit/kino.mjs";
import { fakeRsa } from "../testkit/fake-dc.mjs";
import { TelegramClient } from "../src/mtproto/client.js";
import { SYNC_CALLS, M, deleteSnapshots, searchPinned, saveFilePart, sendSnapshot } from "../src/mtproto/sync-requests.js";
import { roundOf } from "../src/account/round.js";

installKino();

async function signedClient(c) {
  const client = new TelegramClient({ mode: "sync", apiId: Number(API.api_id), publicKeys: fakeRsa().publicKeys, store: false });
  await client.connect(2);
  await client.qrLoginStep({ apiHash: API.api_hash });
  c.account.scan();
  await client.qrLoginStep({ apiHash: API.api_hash });
  return client;
}
const sent = (c) => (c.tg.methodIds || []).length;

test("getMessages is off the sync list; deleteMessages carries no revoke", () => {
  assert.ok(!SYNC_CALLS.includes(0x63c66506));
  const del = deleteSnapshots([5]);
  assert.equal(del[4] | (del[5] << 8) | (del[6] << 16) | (del[7] << 24), 0, "flags 0: no revoke");
});

test("the client refuses a delete of an id it never saw in Saved Messages, before a byte goes out", async () => {
  const c = cluster();
  try {
    const client = await signedClient(c);
    const other = c.account.addGroup({ id: 4001n, title: "Familia" });
    const theirs = c.account.post(other, { text: "a message of the family" });
    const before = sent(c);
    await assert.rejects(client.call(deleteSnapshots([theirs])), (e) => e.code === "invalid_request" && /saw in Saved Messages/.test(e.message));
    assert.equal(sent(c), before, "zero calls");
    assert.ok(c.account.chats.get(other).messages.has(theirs));
    // A body with revoke, or with extra bytes, is refused even for a seen id.
    const mine = c.saved.personPosts({ fileName: "kino-sync.bin", pinned: true });
    await client.call(searchPinned());
    const revoke = deleteSnapshots([mine]); revoke[4] = 1;
    await assert.rejects(client.call(revoke), (e) => e.code === "invalid_request");
    await assert.rejects(client.call(new Uint8Array([...deleteSnapshots([mine]), 0, 0, 0, 0])), (e) => e.code === "invalid_request");
    assert.equal(sent(c), before + 1, "only the search went out");
    await client.close();
  } finally { c.close(); }
});

test("only ids a self search answered, or the sendMedia that made the copy, may be deleted (once)", async () => {
  const c = cluster();
  try {
    const client = await signedClient(c);
    const pinned = c.saved.personPosts({ fileName: "kino-sync.bin", pinned: true });
    const unpinned = c.saved.personPosts({ fileName: "kino-sync.bin", pinned: false });
    await client.call(searchPinned());
    await client.call(deleteSnapshots([pinned]));
    assert.ok(!c.saved.saved.messages.has(pinned));
    await assert.rejects(client.call(deleteSnapshots([pinned])), (e) => e.code === "invalid_request", "a deleted id is forgotten");
    await assert.rejects(client.call(deleteSnapshots([unpinned])), (e) => e.code === "invalid_request", "not answered by a search: refused");
    // The copy a sendMedia made.
    const fileId = 77n;
    await client.call(saveFilePart({ fileId, part: 0, bytes: new Uint8Array([1, 2, 3]) }));
    await client.call(sendSnapshot({ fileId, parts: 1, randomId: 99n }));
    const id = c.saved.log.find((e) => e.method === "sendMedia").id;
    await client.call(deleteSnapshots([id]));
    assert.ok(!c.saved.saved.messages.has(id));
    await client.close();
  } finally { c.close(); }
});

test("round.js: deleteOwn refuses an id before any search with zero calls; after it, only the ids that came back and the claimed one", async () => {
  const calls = [];
  const searchAnswer = () => {
    // messages.messages with two pinned kino-sync.bin documents (ids 10 and 12), built by the test serializer.
    return answers.shift();
  };
  const answers = [];
  const idOf = (body) => (body[0] | (body[1] << 8) | (body[2] << 16) | (body[3] << 24)) >>> 0;
  const stub = { call: async (body) => { calls.push(idOf(body)); return idOf(body) === M.search ? searchAnswer() : new Uint8Array([0x85, 0x91, 0xd1, 0x84, 1, 0, 0, 0, 1, 0, 0, 0]); } };
  const S = await import("../testkit/tl-serializer.mjs");
  const doc = (id) => S.messageWithDocument({ id, peer: S.peerUser(1n), date: 1, doc: { id: BigInt(id), accessHash: 1n, fileReference: Buffer.from([1]), mime: "application/octet-stream", size: 1, fileName: "kino-sync.bin" } });
  // messageWithDocument has no pinned flag: set bit 24 of the message's flags.
  const pinned = (b) => { const x = Buffer.from(b); x.writeUInt32LE((x.readUInt32LE(4) | (1 << 24)) >>> 0, 4); return x; };
  answers.push(new Uint8Array(S.messagesMessages({ messages: [pinned(doc(10)), pinned(doc(12))] })));
  const r = roundOf(stub, undefined);
  await assert.rejects(r.deleteOwn([10]), (e) => e.code === "invalid_request");
  assert.equal(calls.length, 0, "zero calls");
  assert.deepEqual((await r.snapshots()).map((s) => s.id), [12, 10]);
  await r.deleteOwn([10, 12]);
  await assert.rejects(r.deleteOwn([11]), (e) => e.code === "invalid_request");
  r.claim(11);
  await r.deleteOwn([11]);
  assert.deepEqual(calls, [M.search, M.deleteMessages, M.deleteMessages]);
});
