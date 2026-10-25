// Sync-Gram Cuenta (the "sync" client mode): the closed list of methods it may send through TelegramClient.call and
// their serializers. Every method here acts on Saved Messages only: the peer is NOT a parameter of any serializer, it is
// inputPeerSelf written by the serializer itself, and the client checks those bytes again before sending (client.js).
// Not vendored: Sync-Gram Cuenta's own code, kept next to requests.js because that is where it would go upstream.
//
// Layer 198 TL lines:
// upload.saveFilePart#b304a621 file_id:long file_part:int bytes:bytes = Bool
// messages.sendMedia#7852834e flags:# silent:flags.5?true background:flags.6?true clear_draft:flags.7?true
//   noforwards:flags.14?true update_stickersets_order:flags.15?true invert_media:flags.16?true
//   allow_paid_floodskip:flags.19?true peer:InputPeer reply_to:flags.0?InputReplyTo media:InputMedia message:string
//   random_id:long reply_markup:flags.2?ReplyMarkup entities:flags.3?Vector<MessageEntity> schedule_date:flags.10?int
//   send_as:flags.13?InputPeer quick_reply_shortcut:flags.17?InputQuickReplyShortcut effect:flags.18?long = Updates
// inputMediaUploadedDocument#37c9330 flags:# nosound_video:flags.3?true force_file:flags.4?true spoiler:flags.5?true
//   file:InputFile thumb:flags.2?InputFile mime_type:string attributes:Vector<DocumentAttribute>
//   stickers:flags.0?Vector<InputDocument> video_cover:flags.6?InputPhoto video_timestamp:flags.7?int ttl_seconds:flags.1?int
// inputFile#f52ff27f id:long parts:int name:string md5_checksum:string = InputFile
// documentAttributeFilename#15590068 file_name:string = DocumentAttribute
// messages.updatePinnedMessage#d2aaf7ec flags:# silent:flags.0?true unpin:flags.1?true pm_oneside:flags.2?true
//   peer:InputPeer id:int = Updates
// messages.deleteMessages#e58e95d2 flags:# revoke:flags.0?true id:Vector<int> = messages.AffectedMessages
// messages.search#29ee847a (as requests.js) with filter inputMessagesFilterPinned#1bb00451
// messages.affectedMessages#84d19185 pts:int pts_count:int
import { Writer, CTOR, Reader } from "./tl.js";
import { mtError } from "./errors.js";
import { utf8 } from "./bytes.js";

export const M = Object.freeze({
  saveFilePart: 0xb304a621,
  sendMedia: 0x7852834e,
  updatePinnedMessage: 0xd2aaf7ec,
  deleteMessages: 0xe58e95d2,
  search: 0x29ee847a,
});
export const INPUT_PEER_SELF = 0x7da07ec9;
const FILTER_PINNED = 0x1bb00451;
const INPUT_MEDIA_UPLOADED_DOCUMENT = 0x037c9330;
const INPUT_FILE = 0xf52ff27f;
const ATTR_FILENAME = 0x15590068;
const AFFECTED_MESSAGES = 0x84d19185;

/**
 * The ONLY methods TelegramClient.call sends in `sync` mode. Login and logout go through the client's own login calls
 * (ACCOUNT_AUTH_CALLS), never through `call`; upload.getFile goes through client.getFile. messages.getMessages is not
 * here: it takes no peer and reads any private chat's message by id; a snapshot is re-read with a self search bounded
 * by min_id/max_id (searchPinned). messages.deleteMessages takes no peer either: the client accepts it only for ids it
 * saw in an answer about Saved Messages (client.js).
 */
export const SYNC_CALLS = Object.freeze([M.saveFilePart, M.sendMedia, M.updatePinnedMessage, M.deleteMessages, M.search]);
/**
 * Where the InputPeer sits in the body of each method that names one: always right after the method id and its flags
 * word. The client refuses such a body unless the 4 bytes there are inputPeerSelf.
 */
export const SELF_PEER_OFFSET = Object.freeze({ [M.sendMedia]: 8, [M.updatePinnedMessage]: 8, [M.search]: 8 });

/** Telegram's part rules for upload.saveFilePart (files under 10 MB): 128 KiB divides 512 KiB and is a multiple of 1 KiB. */
export const PART_BYTES = 131072;
export const MAX_FILE_BYTES = 4194304;
export const MAX_PARTS = MAX_FILE_BYTES / PART_BYTES;
export const SNAPSHOT_NAME = "kino-sync.bin";
const MIME = "application/octet-stream";

const ids = (list) => {
  if (!Array.isArray(list) || !list.length || list.length > 100) throw mtError("invalid_request", "1 to 100 message ids");
  for (const id of list) if (!Number.isInteger(id) || id <= 0 || id > 0x7fffffff) throw mtError("invalid_request", "a message id is a positive int");
  return list;
};

/** One part of the file being uploaded: `bytes` (a Uint8Array) is exactly PART_BYTES long, except for the last part. */
export function saveFilePart({ fileId, part, bytes }) {
  if (typeof fileId !== "bigint") throw mtError("invalid_request", "fileId is a BigInt");
  if (!Number.isInteger(part) || part < 0 || part >= MAX_PARTS) throw mtError("invalid_request", "part out of range");
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > PART_BYTES) throw mtError("invalid_request", "a part is 1 to " + PART_BYTES + " bytes");
  return new Writer().int(M.saveFilePart).long(fileId).int(part).bytes(bytes).done();
}

/**
 * Sends the uploaded file to Saved Messages as a document named SNAPSHOT_NAME, silently (flag 5), with no caption
 * unless `caption` is given. `randomId` is a BigInt the caller keeps to find the new message id in the answer.
 */
export function sendSnapshot({ fileId, parts, randomId, caption = "" }) {
  if (typeof fileId !== "bigint" || typeof randomId !== "bigint") throw mtError("invalid_request", "fileId and randomId are BigInts");
  if (!Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS) throw mtError("invalid_request", "parts out of range");
  if (typeof caption !== "string" || utf8(caption).length > 200) throw mtError("invalid_request", "caption is a short string");
  const w = new Writer().int(M.sendMedia).int(1 << 5).int(INPUT_PEER_SELF);
  w.int(INPUT_MEDIA_UPLOADED_DOCUMENT).int(1 << 4) // force_file: a document, never a preview
    .int(INPUT_FILE).long(fileId).int(parts).string(SNAPSHOT_NAME).string("")
    .string(MIME)
    .int(CTOR.vector).int(1).int(ATTR_FILENAME).string(SNAPSHOT_NAME);
  return w.string(caption).long(randomId).done();
}

/** Pins message `id` in Saved Messages, silently (flag 0). */
export function pinSnapshot(id) {
  ids([id]);
  return new Writer().int(M.updatePinnedMessage).int(1).int(INPUT_PEER_SELF).int(id).done();
}

/**
 * Deletes messages by id, without revoke (Saved Messages has no other side, and a wrong id could only ever go on the
 * person's side). The client accepts it only for ids it saw in an answer about Saved Messages.
 */
export function deleteSnapshots(list) {
  return new Writer().int(M.deleteMessages).int(0).vectorInt(ids(list)).done();
}

/**
 * The pinned messages of Saved Messages, newest first, at most `limit`. `minId`/`maxId` bound the ids (0: no bound):
 * minId = id - 1, maxId = id + 1 re-reads one message (a fresh file_reference) without leaving Saved Messages.
 */
export function searchPinned({ limit = 100, minId = 0, maxId = 0 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw mtError("invalid_request", "limit 1 to 100");
  for (const v of [minId, maxId]) if (!Number.isInteger(v) || v < 0 || v > 0x7fffffff) throw mtError("invalid_request", "an id bound is a non-negative int");
  return new Writer().int(M.search).int(0).int(INPUT_PEER_SELF).string("").int(FILTER_PINNED)
    .int(0).int(0).int(0).int(0).int(limit).int(maxId).int(minId).long(0n).done();
}

/** Bool -> true/false; anything else is a protocol error. */
export function parseBool(u8) { return new Reader(u8).bool(); }

/** messages.affectedMessages -> { pts, ptsCount }. */
export function parseAffectedMessages(u8) {
  const r = new Reader(u8);
  if (r.int() !== AFFECTED_MESSAGES) throw mtError("protocol", "unexpected answer to messages.deleteMessages");
  return { pts: r.int32(), ptsCount: r.int32() };
}
