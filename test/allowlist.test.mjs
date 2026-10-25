// The `sync` client mode's closed allowlist and its serializers, byte by byte, in this realm (no sandbox, no network):
// every method id that is not on SYNC_CALLS is refused by TelegramClient.call before anything else happens, every
// serializer writes inputPeerSelf where a peer goes (none takes one), sendMedia and the pin are silent, parts are
// 128 KiB at most and a file 4 MiB at most.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TelegramClient } from "../src/mtproto/client.js";
import { BOT_CALLS, ACCOUNT_CALLS, ACCOUNT_AUTH_CALLS } from "../src/mtproto/requests.js";
import {
  SYNC_CALLS, SELF_PEER_OFFSET, INPUT_PEER_SELF, M, PART_BYTES, MAX_FILE_BYTES, MAX_PARTS, SNAPSHOT_NAME,
  saveFilePart, sendSnapshot, pinSnapshot, deleteSnapshots, searchPinned,
} from "../src/mtproto/sync-requests.js";
import { SCHEMA_CTORS } from "../src/mtproto/schema/generated.js";
import { installKino } from "../testkit/kino.mjs";

installKino();
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const body = (...words) => { const b = new Uint8Array(words.length * 4); words.forEach((w, i) => { b[i * 4] = w & 255; b[i * 4 + 1] = (w >>> 8) & 255; b[i * 4 + 2] = (w >>> 16) & 255; b[i * 4 + 3] = (w >>> 24) & 255; }); return b; };
const client = () => new TelegramClient({ store: false, mode: "sync" });

/** What `call` says about a body: "refused" (not on the allowlist or not self), "allowed" (it got as far as "connect first"). */
async function verdict(c, b) {
  try { await c.call(b); return "sent?"; } catch (e) {
    if (e.code === "invalid_request" && /connect first/.test(e.message)) return "allowed";
    if (e.code === "invalid_request") return "refused";
    return "other " + e.code;
  }
}

test("the allowlist is exactly the five Saved Messages methods (getFile goes through client.getFile)", () => {
  assert.deepEqual([...SYNC_CALLS].sort(), [M.saveFilePart, M.sendMedia, M.updatePinnedMessage, M.deleteMessages, M.search].sort());
  assert.equal(new Set(SYNC_CALLS).size, 5);
  assert.deepEqual(Object.keys(SELF_PEER_OFFSET).map(Number).sort(), [M.sendMedia, M.updatePinnedMessage, M.search].sort());
});

test("every method id not on the allowlist is refused before a byte goes out", async () => {
  const c = client();
  const listed = new Set(SYNC_CALLS);
  // Every other mode's methods, the wrappers and the login methods, every constructor id of the layer-198 schema the
  // reader carries (none of them is a method we send), and 4000 random ids.
  const ids = new Set([...BOT_CALLS, ...ACCOUNT_CALLS, ...ACCOUNT_AUTH_CALLS, 0xda9b0d0d, 0xc1cd5ea9, 0x3072cfa1, 0x73f1f8dc, 0xbe5335be, 0x4423e6c5, 0xa0f4cb4f]);
  for (const line of SCHEMA_CTORS.split("\n")) if (line) ids.add(parseInt(line.split(" ")[0], 16) >>> 0);
  let x = 0x9e3779b9;
  for (let i = 0; i < 4000; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; ids.add(x >>> 0); }
  let refused = 0;
  for (const id of ids) {
    if (listed.has(id)) continue;
    assert.equal(await verdict(c, body(id, 0, INPUT_PEER_SELF)), "refused", "0x" + id.toString(16));
    refused++;
  }
  assert.ok(refused > 4500, "checked " + refused + " ids");
  // The listed ones get past the allowlist (and stop at "connect first"); a delete needs an id seen in Saved Messages
  // first (test/account-guard.test.mjs).
  for (const b of [saveFilePart({ fileId: 1n, part: 0, bytes: new Uint8Array(8) }), sendSnapshot({ fileId: 1n, parts: 1, randomId: 2n }), pinSnapshot(5), searchPinned()]) {
    assert.equal(await verdict(c, b), "allowed");
  }
});

test("bot and account modes never send the write methods", async () => {
  for (const mode of ["bot", "account"]) {
    const c = new TelegramClient({ store: false, mode });
    for (const b of [saveFilePart({ fileId: 1n, part: 0, bytes: new Uint8Array(8) }), sendSnapshot({ fileId: 1n, parts: 1, randomId: 2n }), pinSnapshot(5), deleteSnapshots([5])]) {
      assert.equal(await verdict(c, b), "refused", mode);
    }
  }
  assert.throws(() => new TelegramClient({ store: false, mode: "write" }), /mode is bot, account or sync/);
});

test("a peer-bearing method naming anything but Saved Messages is refused, whatever follows", async () => {
  const c = client();
  const peers = { user: [0xdde8a54c, 1, 0, 2, 0], chat: [0x35a95cb9, 1, 0], channel: [0x27bcbbfc, 1, 0, 2, 0], empty: [0x7f3b18ea], none: [] };
  for (const m of [M.sendMedia, M.updatePinnedMessage, M.search]) {
    for (const [name, words] of Object.entries(peers)) assert.equal(await verdict(c, body(m, 0, ...words)), "refused", name);
    // A self peer one word too late (flags shifted) is not self.
    assert.equal(await verdict(c, body(m, 0, 0, INPUT_PEER_SELF)), "refused");
  }
});

test("every serializer writes inputPeerSelf where its peer goes, and none takes a peer", () => {
  const evil = { peer: { kind: "user", id: 1n, accessHash: 2n }, peerId: 1, chatId: 1 };
  const send = sendSnapshot({ fileId: 1n, parts: 1, randomId: 2n, ...evil });
  const pin = pinSnapshot(7, evil);
  const search = searchPinned({ limit: 3, ...evil });
  for (const [b, id] of [[send, M.sendMedia], [pin, M.updatePinnedMessage], [search, M.search]]) {
    assert.equal(u32(b, 0), id);
    assert.equal(u32(b, SELF_PEER_OFFSET[id]), INPUT_PEER_SELF);
  }
  for (const fn of [sendSnapshot, pinSnapshot, searchPinned, deleteSnapshots, saveFilePart]) {
    assert.doesNotMatch(fn.toString().split(")")[0], /peer/i, fn.name + " takes no peer");
  }
  // search: q is empty and the filter is inputMessagesFilterPinned.
  assert.equal(u32(search, 12), 0); // q: empty TL string (one zero length byte + 3 padding)
  assert.equal(u32(search, 16), 0x1bb00451);
});

test("sendMedia is silent, a document (force_file) named kino-sync.bin; the pin is silent and never an unpin", () => {
  const send = sendSnapshot({ fileId: 9n, parts: 3, randomId: 10n });
  assert.equal(u32(send, 4), 1 << 5, "flags: silent only");
  assert.equal(u32(send, 12), 0x037c9330, "inputMediaUploadedDocument");
  assert.equal(u32(send, 16), 1 << 4, "force_file only");
  assert.ok(Buffer.from(send).includes(Buffer.from(SNAPSHOT_NAME)));
  const pin = pinSnapshot(7);
  assert.equal(u32(pin, 4), 1, "flags: silent only (no unpin, no pm_oneside)");
  assert.equal(u32(pin, 12), 7);
  const del = deleteSnapshots([7, 8]);
  assert.equal(u32(del, 4), 0, "no revoke");
});

test("parts are at most 128 KiB, a file at most 4 MiB (32 parts), ids are positive ints", () => {
  assert.equal(PART_BYTES, 131072);
  assert.equal(MAX_FILE_BYTES, 4194304);
  assert.equal(MAX_PARTS, 32);
  assert.ok(saveFilePart({ fileId: 1n, part: 31, bytes: new Uint8Array(PART_BYTES) }));
  assert.throws(() => saveFilePart({ fileId: 1n, part: 0, bytes: new Uint8Array(PART_BYTES + 1) }), /a part is 1 to 131072 bytes/);
  assert.throws(() => saveFilePart({ fileId: 1n, part: 0, bytes: new Uint8Array(0) }));
  assert.throws(() => saveFilePart({ fileId: 1n, part: 32, bytes: new Uint8Array(1) }), /part out of range/);
  assert.throws(() => saveFilePart({ fileId: 1, part: 0, bytes: new Uint8Array(1) }));
  assert.throws(() => sendSnapshot({ fileId: 1n, parts: 33, randomId: 1n }), /parts out of range/);
  assert.throws(() => sendSnapshot({ fileId: 1n, parts: 0, randomId: 1n }));
  for (const bad of [[], [0], [-1], [1.5], [2 ** 31], new Array(101).fill(1)]) {
    assert.throws(() => deleteSnapshots(bad));
  }
  assert.throws(() => pinSnapshot(0));
  assert.throws(() => searchPinned({ limit: 0 }));
  assert.throws(() => searchPinned({ limit: 101 }));
});

// ---- the phone sign-in (1.1.0): auth.sendCode and auth.signIn, on the LOGIN list of the sync mode only ----

test("the phone sign-in methods: layer-198 ids and field order, on the sync mode's login list only, never through call", async () => {
  const P = await import("../src/mtproto/phone-requests.js");
  assert.deepEqual([...P.PHONE_AUTH_CALLS].sort(), [0xa677244f, 0x8d52a951].sort(), "auth.sendCode, auth.signIn (no resendCode)");
  // auth.sendCode#a677244f phone_number:string api_id:int api_hash:string settings:CodeSettings; codeSettings#ad253d78 flags:#
  const send = P.sendCode({ phone: "573001234567", apiId: 123456, apiHash: "0123456789abcdef0123456789abcdef" });
  assert.equal(u32(send, 0), 0xa677244f);
  assert.equal(send[4], 12, "the number as a TL string");
  assert.equal(Buffer.from(send.subarray(5, 17)).toString(), "573001234567");
  assert.equal(u32(send, 20), 123456, "api_id after the padded number");
  assert.equal(u32(send, send.length - 8), 0xad253d78, "codeSettings last");
  assert.equal(u32(send, send.length - 4), 0, "no code setting flag: plain delivery");
  // auth.signIn#8d52a951 flags:# phone_number:string phone_code_hash:string phone_code:flags.0?string
  const sign = P.signIn({ phone: "573001234567", hash: "abcdef0123456789", code: "12345" });
  assert.equal(u32(sign, 0), 0x8d52a951);
  assert.equal(u32(sign, 4), 1, "flags: phone_code present, no email verification");
  for (const bad of [{ phone: "", apiId: 1, apiHash: "x" }, { phone: "+57 300", apiId: 1, apiHash: "x" }]) assert.throws(() => P.sendCode(bad));
  assert.throws(() => P.signIn({ phone: "573001234567", hash: "h", code: "12a45" }), /digits only/);
  // Never through call, in any mode.
  for (const mode of ["sync", "account", "bot"]) {
    const c = new TelegramClient({ store: false, mode });
    assert.equal(await verdict(c, send), "refused", mode);
    assert.equal(await verdict(c, sign), "refused", mode);
  }
  for (const id of P.PHONE_AUTH_CALLS) assert.ok(!SYNC_CALLS.includes(id) && !ACCOUNT_AUTH_CALLS.includes(id) && !ACCOUNT_CALLS.includes(id) && !BOT_CALLS.includes(id));
  // The account mode (Video-Gram's) keeps its login list: no phone sign-in there.
  const acc = new TelegramClient({ store: false, mode: "account" });
  await assert.rejects(acc.phoneSendCode({ phone: "573001234567", apiHash: "x" }), (e) => e.code === "invalid_request");
  await assert.rejects(acc.phoneSignIn({ phone: "573001234567", hash: "h", code: "1" }), (e) => e.code === "invalid_request");
});

test("parseSentCode reads every code type of layer 198 and refuses the email ones and unknown answers", async () => {
  const P = await import("../src/mtproto/phone-requests.js");
  const S = await import("../testkit/tl-serializer.mjs");
  const { u32: w, i32, str, tlBytes, i64 } = S.raw;
  const sent = (type) => new Uint8Array(Buffer.concat([w(0x5e002502), w(0), type, str("hash-123")]));
  assert.deepEqual(P.parseSentCode(sent(Buffer.concat([w(0x3dbb5986), i32(5)]))), { kind: "code", hash: "hash-123", via: "app" });
  assert.equal(P.parseSentCode(sent(Buffer.concat([w(0xc000bba2), i32(5)]))).via, "sms");
  assert.equal(P.parseSentCode(sent(Buffer.concat([w(0x5353e5a7), i32(5)]))).via, "call");
  assert.equal(P.parseSentCode(sent(Buffer.concat([w(0xab03c6d9), str("pat")]))).via, "call");
  assert.equal(P.parseSentCode(sent(Buffer.concat([w(0x82006484), str("+57"), i32(4)]))).via, "call");
  assert.equal(P.parseSentCode(sent(Buffer.concat([w(0xd9565c39), str("https://fragment.com"), i32(5)]))).via, "other");
  assert.equal(P.parseSentCode(sent(Buffer.concat([w(0x009fd736), w(1 | 2 | 4), tlBytes(Buffer.from([1])), i64(7), tlBytes(Buffer.from([2])), str("r"), i32(3), i32(6)]))).via, "sms");
  assert.equal(P.parseSentCode(sent(Buffer.concat([w(0xa416ac81), w(1), str("ab")]))).via, "sms");
  assert.equal(P.parseSentCode(sent(Buffer.concat([w(0xb37794af), w(0)]))).via, "sms");
  assert.throws(() => P.parseSentCode(sent(Buffer.concat([w(0xf450f59b), w(0), str("a*@b"), i32(6)]))), (e) => e.code === "email_required");
  assert.throws(() => P.parseSentCode(sent(Buffer.concat([w(0xa5491dea), w(0)]))), (e) => e.code === "email_required");
  assert.throws(() => P.parseSentCode(sent(Buffer.concat([w(0x12345678)]))), (e) => e.code === "protocol");
  const success = P.parseSentCode(new Uint8Array(Buffer.concat([w(0x2390fe44), w(0x2ea2c0d4), w(0)])));
  assert.equal(success.kind, "authorization");
});
