// Serialized API methods for the discovery (layer 198), written field by field from their TL lines:
// updates.getState#edd4882a = updates.State
// updates.getDifference#19c2f763 flags:# pts:int pts_limit:flags.1?int pts_total_limit:flags.0?int date:int qts:int qts_limit:flags.2?int
// updates.getChannelDifference#3173d78 flags:# force:flags.0?true channel:InputChannel filter:ChannelMessagesFilter pts:int limit:int
// channels.getMessages#ad8c9a23 channel:InputChannel id:Vector<InputMessage>
// messages.getMessages#63c66506 id:Vector<InputMessage>
// inputChannel#f35aec28 channel_id:long access_hash:long   inputMessageID#a676a322 id:int   channelMessagesFilterEmpty#94d42ee7
import { Writer, CTOR } from "./tl.js";

/**
 * The ONLY methods TelegramClient.call sends: the five the discovery needs. A new method for the plugin shell is added
 * here, in this one list, never per call site. Anything else (auth methods, the invoke and initConnection wrappers, gzip_packed,
 * msg_container, destructive methods) is refused by the client before a byte goes out.
 */
export const BOT_CALLS = Object.freeze([
  0xedd4882a, // updates.getState
  0x19c2f763, // updates.getDifference
  0x03173d78, // updates.getChannelDifference
  0xad8c9a23, // channels.getMessages
  0x63c66506, // messages.getMessages
]);
/** Kept for the bot path's callers and tests: the bot's list. */
export const ALLOWED_CALLS = BOT_CALLS;

/**
 * Account mode (0.3.0, the person's own Telegram account) is READ ONLY: a closed list of reading methods, nothing that
 * sends, edits, deletes, forwards, marks read, joins, leaves or changes anything. updates.* are not needed (the account's
 * chats are read by search, not by the update boxes).
 */
export const ACCOUNT_CALLS = Object.freeze([
  0xa0f4cb4f, // messages.getDialogs: which chats there are
  0x29ee847a, // messages.search: a chat's videos (inputMessagesFilterVideo / inputMessagesFilterDocument, empty q)
  0x63c66506, // messages.getMessages: re-read a message (a fresh file_reference) in a basic group or Saved Messages
  0xad8c9a23, // channels.getMessages: the same in a channel or supergroup
]);
/** The account's login and logout methods: only through the client's own login calls, never through `call`. */
export const ACCOUNT_AUTH_CALLS = Object.freeze([
  0xb7e085fe, // auth.exportLoginToken
  0x95ac5ce4, // auth.importLoginToken
  0x548a30f5, // account.getPassword
  0xd18b4d16, // auth.checkPassword
  0x3e72ba19, // auth.logOut
]);

const big = (v) => (typeof v === "bigint" ? v : BigInt(v));
const inputChannel = (w, channelId, accessHash) => w.int(0xf35aec28).long(big(channelId)).long(big(accessHash));
const inputMessageIds = (w, ids) => { w.int(CTOR.vector).int(ids.length); for (const id of ids) w.int(0xa676a322).int(id); return w; };

export const getState = () => new Writer().int(0xedd4882a).done();

export const getDifference = ({ pts, date, qts }) => new Writer().int(0x19c2f763).int(0).int(pts).int(date).int(qts).done();

export const getChannelDifference = ({ channelId, accessHash, pts, limit = 100, force = false }) =>
  inputChannel(new Writer().int(0x03173d78).int(force ? 1 : 0), channelId, accessHash).int(0x94d42ee7).int(pts).int(limit).done();

export const channelsGetMessages = ({ channelId, accessHash, ids }) =>
  inputMessageIds(inputChannel(new Writer().int(0xad8c9a23), channelId, accessHash), ids).done();

export const messagesGetMessages = (ids) => inputMessageIds(new Writer().int(0x63c66506), ids).done();

// ---- account mode (read only) ----
// inputPeerSelf#7da07ec9  inputPeerChat#35a95cb9 chat_id:long  inputPeerChannel#27bcbbfc channel_id:long access_hash:long
// inputPeerUser#dde8a54c user_id:long access_hash:long
// inputPeerEmpty#7f3b18ea  inputMessagesFilterVideo#9fc00e65  inputMessagesFilterDocument#9eddf188
// messages.getDialogs#a0f4cb4f flags:# exclude_pinned:flags.0?true folder_id:flags.1?int offset_date:int offset_id:int
//   offset_peer:InputPeer limit:int hash:long
// messages.search#29ee847a flags:# peer:InputPeer q:string from_id:flags.0?InputPeer saved_peer_id:flags.2?InputPeer
//   saved_reaction:flags.3?Vector<Reaction> top_msg_id:flags.1?int filter:MessagesFilter min_date:int max_date:int
//   offset_id:int add_offset:int limit:int max_id:int min_id:int hash:long
export const FILTER = Object.freeze({ video: 0x9fc00e65, document: 0x9eddf188 });

/** An InputPeer: { kind: "self" } | { kind: "chat", id } | { kind: "channel" | "user", id, accessHash } | { kind: "empty" }. */
export function inputPeer(w, peer) {
  if (!peer || peer.kind === "empty") return w.int(0x7f3b18ea);
  if (peer.kind === "self") return w.int(0x7da07ec9);
  if (peer.kind === "chat") return w.int(0x35a95cb9).long(big(peer.id));
  if (peer.kind === "channel") return w.int(0x27bcbbfc).long(big(peer.id)).long(big(peer.accessHash));
  if (peer.kind === "user") return w.int(0xdde8a54c).long(big(peer.id)).long(big(peer.accessHash)); // a dialog cursor only
  throw new Error("unknown peer kind");
}

export const getDialogs = ({ offsetDate = 0, offsetId = 0, offsetPeer = null, limit = 100 } = {}) =>
  inputPeer(new Writer().int(0xa0f4cb4f).int(0).int(offsetDate).int(offsetId), offsetPeer).int(limit).long(0n).done();

export const searchMessages = ({ peer, filter, offsetId = 0, minId = 0, limit = 100 }) =>
  inputPeer(new Writer().int(0x29ee847a).int(0), peer).string("").int(filter).int(0).int(0).int(offsetId).int(0).int(limit).int(0).int(minId).long(0n).done();
