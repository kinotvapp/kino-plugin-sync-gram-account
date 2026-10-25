// An independent, test-side TL serializer for the server answers the discovery reads (layer 198). It shares no code
// with the production reader or the library's Writer: primitives are written with Buffer here, and every constructor
// layout below was transcribed by hand from the layer-198 TL lines (quoted above each builder), so a mistake in the
// generated schema or the reader cannot be mirrored by the fixtures.
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; };
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v | 0, 0); return b; };
const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt.asIntN(64, BigInt(v)), 0); return b; };
const f64 = (v) => { const b = Buffer.alloc(8); b.writeDoubleLE(v, 0); return b; };
function tlBytes(data) {
  const d = Buffer.from(data);
  const head = d.length < 254 ? Buffer.from([d.length]) : Buffer.from([254, d.length & 255, (d.length >> 8) & 255, (d.length >> 16) & 255]);
  const pad = (4 - ((head.length + d.length) % 4)) % 4;
  return Buffer.concat([head, d, Buffer.alloc(pad)]);
}
const str = (s) => tlBytes(Buffer.from(String(s), "utf8"));
const vec = (items) => Buffer.concat([u32(0x1cb5c415), i32(items.length), ...items]);
const vecInt = (list) => vec(list.map(i32));
const cat = (...parts) => Buffer.concat(parts.filter(Boolean));
const bit = (on, n) => (on ? 1 << n : 0) >>> 0;

export const raw = { u32, i32, i64, f64, tlBytes, str, vec };

// peerUser#59511722 user_id:long  peerChat#36c6019a chat_id:long  peerChannel#a2a5371e channel_id:long
export const peerUser = (id) => cat(u32(0x59511722), i64(id));
export const peerChat = (id) => cat(u32(0x36c6019a), i64(id));
export const peerChannel = (id) => cat(u32(0xa2a5371e), i64(id));

// updates.state#a56c2a3e pts:int qts:int date:int seq:int unread_count:int
export const state = ({ pts, qts = 0, date, seq = 0, unread = 0 }) => cat(u32(0xa56c2a3e), i32(pts), i32(qts), i32(date), i32(seq), i32(unread));

// documentAttributeVideo#43c57c48 flags:# round_message:flags.0?true supports_streaming:flags.1?true nosound:flags.3?true
//   duration:double w:int h:int preload_prefix_size:flags.2?int video_start_ts:flags.4?double video_codec:flags.5?string
export const attrVideo = ({ duration, w, h, streaming = true, round = false, codec }) =>
  cat(u32(0x43c57c48), u32(bit(round, 0) | bit(streaming, 1) | bit(codec !== undefined, 5)), f64(duration), i32(w), i32(h), codec !== undefined && str(codec));
// documentAttributeFilename#15590068 file_name:string
export const attrFilename = (name) => cat(u32(0x15590068), str(name));
// documentAttributeAnimated#11b58939
export const attrAnimated = () => u32(0x11b58939);

// document#8fd4c4d8 flags:# id:long access_hash:long file_reference:bytes date:int mime_type:string size:long
//   thumbs:flags.0?Vector<PhotoSize> video_thumbs:flags.1?Vector<VideoSize> dc_id:int attributes:Vector<DocumentAttribute>
// photoSizeEmpty#e17e23c type:string  (thumbs: true)
// photoSize#75c78e60 type:string w:int h:int size:int
// photoStrippedSize#e0b0bc2e type:string bytes:bytes
// photoSizeProgressive#fa3efb95 type:string w:int h:int sizes:Vector<int>
// photoCachedSize#21e1ad6 type:string w:int h:int bytes:bytes
// thumbs: false, true (one photoSizeEmpty "s"), or a list of { type, w, h, size } | { type, stripped: bytes } |
// { type, w, h, sizes: [...] } | { type, w, h, cached: bytes }.
function photoSize(t) {
  if (t.stripped) return cat(u32(0xe0b0bc2e), str(t.type), tlBytes(t.stripped));
  if (t.cached) return cat(u32(0x021e1ad6), str(t.type), i32(t.w), i32(t.h), tlBytes(t.cached));
  if (t.sizes) return cat(u32(0xfa3efb95), str(t.type), i32(t.w), i32(t.h), vecInt(t.sizes));
  return cat(u32(0x75c78e60), str(t.type), i32(t.w), i32(t.h), i32(t.size));
}
export const document = ({ id, accessHash, fileReference, date, mime, size, dcId = 2, attributes = [], thumbs = false }) =>
  cat(u32(0x8fd4c4d8), u32(bit(!!thumbs, 0)), i64(id), i64(accessHash), tlBytes(fileReference), i32(date), str(mime), i64(size),
    thumbs && vec(Array.isArray(thumbs) ? thumbs.map(photoSize) : [cat(u32(0x0e17e23c), str("s"))]), i32(dcId), vec(attributes));
// documentEmpty#36f8c871 id:long
export const documentEmpty = (id) => cat(u32(0x36f8c871), i64(id));

// messageMediaDocument#52d8ccd9 flags:# nopremium:flags.3?true spoiler:flags.4?true video:flags.6?true round:flags.7?true
//   voice:flags.8?true document:flags.0?Document alt_documents:flags.5?Vector<Document> video_cover:flags.9?Photo
//   video_timestamp:flags.10?int ttl_seconds:flags.2?int
export const mediaDocument = (doc, { video = false } = {}) => cat(u32(0x52d8ccd9), u32(bit(true, 0) | bit(video, 6)), doc);
// messageMediaEmpty#3ded6320
export const mediaEmpty = () => u32(0x3ded6320);

// message#96fdbbe9 flags:# out:flags.1?true ... post:flags.14?true ... flags2:# ... id:int from_id:flags.8?Peer
//   from_boosts_applied:flags.29?int peer_id:Peer saved_peer_id:flags.28?Peer fwd_from:flags.2?MessageFwdHeader
//   via_bot_id:flags.11?long via_business_bot_id:flags2.0?long reply_to:flags.3?MessageReplyHeader date:int message:string
//   media:flags.9?MessageMedia reply_markup:flags.6?ReplyMarkup entities:flags.7?Vector<MessageEntity> views:flags.10?int
//   forwards:flags.10?int replies:flags.23?MessageReplies edit_date:flags.15?int post_author:flags.16?string
//   grouped_id:flags.17?long ...
// messageEntityBold#bd610bc9 offset:int length:int
export function message({ id, peer, date, text = "", media, fromId, post = false, out = false, editDate, views, entities }) {
  const flags = bit(out, 1) | bit(post, 14) | bit(fromId !== undefined, 8) | bit(media !== undefined, 9) | bit(entities !== undefined, 7) |
    bit(views !== undefined, 10) | bit(editDate !== undefined, 15);
  return cat(u32(0x96fdbbe9), u32(flags), u32(0), i32(id), fromId !== undefined && fromId, peer, i32(date), str(text), media,
    entities !== undefined && vec(entities.map(([o, l]) => cat(u32(0xbd610bc9), i32(o), i32(l)))),
    views !== undefined && cat(i32(views), i32(0)), editDate !== undefined && i32(editDate));
}
// messageEmpty#90a6ca84 flags:# id:int peer_id:flags.0?Peer
export const messageEmpty = (id, peer) => cat(u32(0x90a6ca84), u32(bit(peer !== undefined, 0)), i32(id), peer);
// messageService#d3d28540 flags:# ... post:flags.14?true ... id:int from_id:flags.8?Peer peer_id:Peer
//   reply_to:flags.3?MessageReplyHeader date:int action:MessageAction reactions:flags.20?MessageReactions ttl_period:flags.25?int
// messageActionChannelCreate#95d2ac92 title:string
export const messageServiceChannelCreate = ({ id, peer, date, title }) =>
  cat(u32(0xd3d28540), u32(bit(true, 14)), i32(id), peer, i32(date), u32(0x95d2ac92), str(title));

// chatPhotoEmpty#37c1011c
// channel#e00998b7 flags:# creator:flags.0?true left:flags.2?true broadcast:flags.5?true ... min:flags.12?true ... flags2:#
//   ... id:long access_hash:flags.13?long title:string username:flags.6?string photo:ChatPhoto date:int
//   restriction_reason:flags.9?Vector<RestrictionReason> admin_rights:flags.14?ChatAdminRights ...
//   participants_count:flags.17?int ...
// chatAdminRights#5fb224d5 flags:# change_info:flags.0?true post_messages:flags.1?true ...
export const channel = ({ id, accessHash, title, date = 1700000000, min = false, broadcast = true, username, adminRights = false }) =>
  cat(u32(0xe00998b7), u32(bit(broadcast, 5) | bit(min, 12) | bit(accessHash !== undefined, 13) | bit(username !== undefined, 6) | bit(adminRights, 14)), u32(0),
    i64(id), accessHash !== undefined && i64(accessHash), str(title), username !== undefined && str(username), u32(0x37c1011c), i32(date),
    adminRights && cat(u32(0x5fb224d5), u32(0b11)));
// channelForbidden#17d493d5 flags:# broadcast:flags.5?true megagroup:flags.8?true id:long access_hash:long title:string until_date:flags.16?int
export const channelForbidden = ({ id, accessHash, title }) => cat(u32(0x17d493d5), u32(bit(true, 5)), i64(id), i64(accessHash), str(title));
// user#4b46c37e flags:# ... bot:flags.14?true ... flags2:# ... id:long access_hash:flags.0?long first_name:flags.1?string
//   last_name:flags.2?string username:flags.3?string phone:flags.4?string photo:flags.5?UserProfilePhoto status:flags.6?UserStatus
//   bot_info_version:flags.14?int ...
// userStatusEmpty#9d05049
export const user = ({ id, accessHash, firstName, lastName, bot = false, status = false }) =>
  cat(u32(0x4b46c37e), u32(bit(accessHash !== undefined, 0) | bit(firstName !== undefined, 1) | bit(lastName !== undefined, 2) | bit(bot, 14) | bit(status, 6)), u32(0),
    i64(id), accessHash !== undefined && i64(accessHash), firstName !== undefined && str(firstName), lastName !== undefined && str(lastName),
    status && u32(0x09d05049), bot && i32(1));

// updateNewMessage#1f2b0afd message:Message pts:int pts_count:int
export const updateNewMessage = (msg, pts, ptsCount = 1) => cat(u32(0x1f2b0afd), msg, i32(pts), i32(ptsCount));
// updateNewChannelMessage#62ba04d9 message:Message pts:int pts_count:int
export const updateNewChannelMessage = (msg, pts, ptsCount = 1) => cat(u32(0x62ba04d9), msg, i32(pts), i32(ptsCount));
// updateEditChannelMessage#1b3f4df7 message:Message pts:int pts_count:int
export const updateEditChannelMessage = (msg, pts, ptsCount = 1) => cat(u32(0x1b3f4df7), msg, i32(pts), i32(ptsCount));
// updateEditMessage#e40370a3 message:Message pts:int pts_count:int
export const updateEditMessage = (msg, pts, ptsCount = 1) => cat(u32(0xe40370a3), msg, i32(pts), i32(ptsCount));
// updateDeleteChannelMessages#c32d5b12 channel_id:long messages:Vector<int> pts:int pts_count:int
export const updateDeleteChannelMessages = (channelId, ids, pts, ptsCount = ids.length) => cat(u32(0xc32d5b12), i64(channelId), vecInt(ids), i32(pts), i32(ptsCount));
// updateDeleteMessages#a20db0e5 messages:Vector<int> pts:int pts_count:int
export const updateDeleteMessages = (ids, pts, ptsCount = ids.length) => cat(u32(0xa20db0e5), vecInt(ids), i32(pts), i32(ptsCount));
// updateChannel#635b4c09 channel_id:long
export const updateChannel = (channelId) => cat(u32(0x635b4c09), i64(channelId));
// updateChannelTooLong#108d941f flags:# channel_id:long pts:flags.0?int
export const updateChannelTooLong = (channelId, pts) => cat(u32(0x108d941f), u32(bit(pts !== undefined, 0)), i64(channelId), pts !== undefined && i32(pts));
// updateUserStatus#e5bdf8de user_id:long status:UserStatus   (an update the discovery does not care about)
export const updateUserStatus = (userId) => cat(u32(0xe5bdf8de), i64(userId), u32(0x09d05049));

// updates.differenceEmpty#5d75a138 date:int seq:int
export const differenceEmpty = ({ date, seq = 0 }) => cat(u32(0x5d75a138), i32(date), i32(seq));
// updates.difference#f49ca0 new_messages:Vector<Message> new_encrypted_messages:Vector<EncryptedMessage>
//   other_updates:Vector<Update> chats:Vector<Chat> users:Vector<User> state:updates.State
export const difference = ({ newMessages = [], otherUpdates = [], chats = [], users = [], state: st }) =>
  cat(u32(0x00f49ca0), vec(newMessages), vec([]), vec(otherUpdates), vec(chats), vec(users), st);
// updates.differenceSlice#a8fb1981 (same fields) intermediate_state:updates.State
export const differenceSlice = ({ newMessages = [], otherUpdates = [], chats = [], users = [], state: st }) =>
  cat(u32(0xa8fb1981), vec(newMessages), vec([]), vec(otherUpdates), vec(chats), vec(users), st);
// updates.differenceTooLong#4afe8f6d pts:int
export const differenceTooLong = (pts) => cat(u32(0x4afe8f6d), i32(pts));

// updates.channelDifferenceEmpty#3e11affb flags:# final:flags.0?true pts:int timeout:flags.1?int
export const channelDifferenceEmpty = ({ final = true, pts, timeout }) => cat(u32(0x3e11affb), u32(bit(final, 0) | bit(timeout !== undefined, 1)), i32(pts), timeout !== undefined && i32(timeout));
// updates.channelDifference#2064674e flags:# final:flags.0?true pts:int timeout:flags.1?int new_messages:Vector<Message>
//   other_updates:Vector<Update> chats:Vector<Chat> users:Vector<User>
export const channelDifference = ({ final = true, pts, timeout, newMessages = [], otherUpdates = [], chats = [], users = [] }) =>
  cat(u32(0x2064674e), u32(bit(final, 0) | bit(timeout !== undefined, 1)), i32(pts), timeout !== undefined && i32(timeout), vec(newMessages), vec(otherUpdates), vec(chats), vec(users));
// peerNotifySettings#99622c0c flags:# ...   (all flags off)
// dialog#d58a08c6 flags:# pinned:flags.2?true unread_mark:flags.3?true view_forum_as_messages:flags.6?true peer:Peer
//   top_message:int read_inbox_max_id:int read_outbox_max_id:int unread_count:int unread_mentions_count:int
//   unread_reactions_count:int notify_settings:PeerNotifySettings pts:flags.0?int draft:flags.1?DraftMessage
//   folder_id:flags.4?int ttl_period:flags.5?int
export const dialog = ({ peer, topMessage, pts }) =>
  cat(u32(0xd58a08c6), u32(bit(pts !== undefined, 0)), peer, i32(topMessage), i32(0), i32(0), i32(0), i32(0), i32(0), u32(0x99622c0c), u32(0), pts !== undefined && i32(pts));
// updates.channelDifferenceTooLong#a4bcc6fe flags:# final:flags.0?true timeout:flags.1?int dialog:Dialog
//   messages:Vector<Message> chats:Vector<Chat> users:Vector<User>
export const channelDifferenceTooLong = ({ final = true, timeout, dialog: d, messages = [], chats = [], users = [] }) =>
  cat(u32(0xa4bcc6fe), u32(bit(final, 0) | bit(timeout !== undefined, 1)), timeout !== undefined && i32(timeout), d, vec(messages), vec(chats), vec(users));

// messages.messages#8c718e87 messages:Vector<Message> chats:Vector<Chat> users:Vector<User>
export const messagesMessages = ({ messages = [], chats = [], users = [] }) => cat(u32(0x8c718e87), vec(messages), vec(chats), vec(users));
// messages.messagesSlice#3a54685e flags:# inexact:flags.1?true count:int next_rate:flags.0?int offset_id_offset:flags.2?int
//   messages:Vector<Message> chats:Vector<Chat> users:Vector<User>
export const messagesSlice = ({ count, messages = [], chats = [], users = [] }) => cat(u32(0x3a54685e), u32(0), i32(count), vec(messages), vec(chats), vec(users));
// messages.channelMessages#c776ba4e flags:# inexact:flags.1?true pts:int count:int offset_id_offset:flags.2?int
//   messages:Vector<Message> topics:Vector<ForumTopic> chats:Vector<Chat> users:Vector<User>
export const channelMessages = ({ pts, count, messages = [], chats = [], users = [] }) =>
  cat(u32(0xc776ba4e), u32(0), i32(pts), i32(count), vec(messages), vec([]), vec(chats), vec(users));
// messages.messagesNotModified#74535f21 count:int
export const messagesNotModified = (count) => cat(u32(0x74535f21), i32(count));

// rpc_error#2144ca19 error_code:int error_message:string
export const rpcError = (code, message) => cat(u32(0x2144ca19), i32(code), str(message));

/** A message carrying a document, from a plain description (what the fake world stores). */
export function messageWithDocument({ id, peer, date, text = "", post = true, doc }) {
  const attrs = [];
  if (doc.video) attrs.push(attrVideo(doc.video));
  if (doc.animated) attrs.push(attrAnimated());
  if (doc.fileName !== undefined) attrs.push(attrFilename(doc.fileName));
  const d = document({ id: doc.id, accessHash: doc.accessHash, fileReference: doc.fileReference, date, mime: doc.mime, size: doc.size, dcId: doc.dcId || 2, attributes: attrs, thumbs: Array.isArray(doc.thumbs) ? doc.thumbs : !!doc.thumbs });
  return message({ id, peer, date, text, post, media: mediaDocument(d, { video: !!doc.video }) });
}
