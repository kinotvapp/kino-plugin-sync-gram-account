// One sync round of Sync-Gram Cuenta on a signed-in `sync` client: the snapshot is the newest pinned document
// named kino-sync.bin in Saved Messages, its message id is the version.
//
// Pull: messages.search(self, pinned) -> upload.getFile in 1 MiB chunks (hex all the way, one native hex->base64 at the
// end). Push: the same search for the conflict check, upload.saveFilePart in 128 KiB parts, messages.sendMedia (silent),
// messages.updatePinnedMessage (silent), the search again (two devices pushing at once: the loser deletes its own copy
// and answers "conflict"), then messages.deleteMessages of the older snapshots. Order is upload, send, pin, re-check,
// delete: a failure anywhere before the delete leaves the old copy pinned and in place.
//
// Errors come out as the library's typed errors (mtError codes) plus "conflict", "too_large" and "invalid_request";
// sync.js turns them into what Kino understands. Nothing here is ever retried, except one re-read of a stale file
// reference (that is not a server refusal but an expired handle).
import { decode } from "../mtproto/schema/reader.js";
import { CHUNK } from "../mtproto/client.js";
import { toHex, fromHex, toBase64, fromBase64 } from "../mtproto/bytes.js";
import { mtError } from "../mtproto/errors.js";
import {
  saveFilePart, sendSnapshot, pinSnapshot, deleteSnapshots, searchPinned, parseBool, parseAffectedMessages,
  PART_BYTES, MAX_FILE_BYTES, SNAPSHOT_NAME,
} from "../mtproto/sync-requests.js";

const native = (from, to) => typeof kino !== "undefined" && kino.crypto && typeof kino.crypto.convert === "function"
  ? (s) => kino.crypto.convert(s, from, to) : null;
const b64ToHex = (s) => { const f = native("base64", "hex"); return f ? f(s) : toHex(fromBase64(s)); };
const hexToB64 = (s) => { const f = native("hex", "base64"); return f ? f(s) : toBase64(fromHex(s)); };
const randomLong = () => BigInt.asIntN(64, BigInt("0x" + kino.crypto.randomBytes(8, "hex")));
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function blobBytes(blob) {
  return (blob.length / 4) * 3 - (blob.endsWith("==") ? 2 : blob.endsWith("=") ? 1 : 0);
}
const capOf = (maxBlobBytes) => Math.min(MAX_FILE_BYTES, Number(maxBlobBytes) > 0 ? Number(maxBlobBytes) : MAX_FILE_BYTES);

function snapshotOf(m) {
  if (!m || m._ !== "message" || !m.pinned || !m.media || m.media._ !== "messageMediaDocument") return null;
  const d = m.media.document;
  if (!d || d._ !== "document") return null;
  if (!(d.attributes || []).some((a) => a._ === "documentAttributeFilename" && a.file_name === SNAPSHOT_NAME)) return null;
  const size = Number(d.size);
  if (!Number.isSafeInteger(size) || size < 0) return null;
  // file_reference is a view into the answer: copied, so the answer can go.
  return { id: m.id, size, loc: { id: d.id, accessHash: d.access_hash, fileReference: d.file_reference.slice(), dcId: d.dc_id } };
}

/**
 * A round's view of Saved Messages. `own` holds the ids this round may delete: snapshots a self search answered and the
 * copy this round sent. deleteOwn refuses anything else before a byte goes out (messages.deleteMessages takes no peer,
 * and message ids are shared by every private chat, so an id from anywhere else could delete someone's message).
 */
export function roundOf(client, deadline) {
  const own = new Set();
  return {
    async snapshots() {
      const res = decode(await client.call(searchPinned({ limit: 100 }), { deadline }), { expect: "messages.Messages" });
      const list = (res.messages || []).map(snapshotOf).filter(Boolean).sort((a, b) => b.id - a.id);
      for (const s of list) own.add(s.id);
      return list;
    },
    claim(id) { own.add(id); },
    async deleteOwn(ids) {
      for (const id of ids) if (!own.has(id)) throw mtError("invalid_request", "refused: not a snapshot of this account's Saved Messages");
      return parseAffectedMessages(await client.call(deleteSnapshots(ids), { deadline }));
    },
  };
}

async function download(client, snap, { deadline, maxBlobBytes }) {
  if (snap.size > capOf(maxBlobBytes)) throw mtError("too_large", "the pinned copy is over the size limit");
  const parts = [];
  for (let offset = 0; offset < snap.size; offset += CHUNK) {
    const next = offset + CHUNK < snap.size ? [{ offset: offset + CHUNK, limit: CHUNK }] : [];
    parts.push(await client.getFile(snap.loc, offset, CHUNK, { hex: true, deadline, ahead: next }));
  }
  let hex = parts.length === 1 ? parts[0] : parts.join("");
  parts.length = 0;
  if (hex.length !== snap.size * 2) throw mtError("protocol", "the copy came back with another size");
  const blob = snap.size ? hexToB64(hex) : "";
  hex = null;
  return blob;
}

/** { blob, version }, or null when nothing is pinned yet. */
export async function pull(client, { maxBlobBytes, deadline } = {}) {
  const r = roundOf(client, deadline);
  const [snap] = await r.snapshots();
  if (!snap) return null;
  let blob;
  try {
    blob = await download(client, snap, { deadline, maxBlobBytes });
  } catch (e) {
    if (!(e && e.code === "file_reference_expired")) throw e;
    // A self search bounded to this id re-reads it (a fresh file reference) without leaving Saved Messages.
    const res = decode(await client.call(searchPinned({ limit: 3, minId: snap.id - 1, maxId: snap.id + 1 }), { deadline }), { expect: "messages.Messages" });
    const fresh = (res.messages || []).map(snapshotOf).find((s) => s && s.id === snap.id);
    // The copy went between the two searches (another device replaced it): not an empty remote, a round to retry.
    if (!fresh) throw mtError("protocol", "the pinned copy vanished while it was read");
    blob = await download(client, fresh, { deadline, maxBlobBytes });
  }
  return { blob, version: String(snap.id) };
}

/** Checks a blob before anything is sent: standard base64, at most the cap. Answers its size in bytes. */
export function checkBlob(blob, maxBlobBytes) {
  if (typeof blob !== "string" || blob.length < 4 || blob.length % 4 !== 0 || !BASE64.test(blob)) throw mtError("invalid_request", "no blob");
  const size = blobBytes(blob);
  if (size > capOf(maxBlobBytes)) throw mtError("too_large", "blob over maxBlobBytes");
  return size;
}

/** { version } of the new copy; "conflict" when the pinned copy is not `expectedVersion`. */
export async function push(client, { blob, expectedVersion, maxBlobBytes, deadline } = {}) {
  const size = checkBlob(blob, maxBlobBytes);
  const r = roundOf(client, deadline);
  const [before] = await r.snapshots();
  const expected = expectedVersion == null ? "" : String(expectedVersion);
  if ((before ? String(before.id) : "") !== expected) throw mtError("conflict", "the pinned copy is " + (before ? before.id : "none") + ", not " + (expected || "none"));

  let hex = b64ToHex(blob);
  const fileId = randomLong();
  const parts = Math.ceil(size / PART_BYTES);
  for (let i = 0; i < parts; i++) {
    const body = saveFilePart({ fileId, part: i, bytes: fromHex(hex.slice(i * PART_BYTES * 2, (i + 1) * PART_BYTES * 2)) });
    if (!parseBool(await client.call(body, { deadline }))) throw mtError("protocol", "a part was refused");
  }
  hex = null;

  const randomId = randomLong();
  const sent = decode(await client.call(sendSnapshot({ fileId, parts, randomId }), { deadline }), { expect: "Updates" });
  let id = 0;
  for (const u of sent.updates || []) if (u._ === "updateMessageID" && BigInt(u.random_id) === randomId) id = u.id;
  if (!id) throw mtError("protocol", "the sent copy has no message id");
  r.claim(id);
  const dropMine = async () => { try { await r.deleteOwn([id]); } catch { /* an unpinned copy left behind is harmless */ } };
  try {
    decode(await client.call(pinSnapshot(id), { deadline }), { expect: "Updates" });
  } catch (e) {
    // Only the copy this round sent, and never after a FLOOD_WAIT (another request would only lengthen the wait): an
    // unpinned copy is harmless, the pinned search never sees it. The old one stays pinned either way.
    if (!(e && e.code === "flood_wait")) await dropMine();
    throw e;
  }
  const after = await r.snapshots();
  if (!after.length || after[0].id !== id) {
    await dropMine();
    throw mtError("conflict", "another copy was pinned meanwhile");
  }
  const older = after.slice(1).map((s) => s.id);
  if (older.length) await r.deleteOwn(older);
  return { version: String(id) };
}

/** The pinned snapshot's version and size: the search only, never a download. */
export async function peek(client, { deadline } = {}) {
  const [snap] = await roundOf(client, deadline).snapshots();
  return snap ? { version: String(snap.id), bytes: snap.size } : null;
}
