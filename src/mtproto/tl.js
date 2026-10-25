// TL serialization for the constructors this plugin uses (MTProto layer 198), ported from the spike's W/R
// (telegram-mtproto-spike/mtproto.mjs) to Uint8Array. Readers of server answers never crash on a constructor they do
// not know: they answer { ctor, raw } (or mark what they read as `incomplete`) and leave the decision to the caller.
import { concat, utf8, fromUtf8, fromHex, readU32LE, readI32LE, writeU32LE, writeI64LE, readI64LE } from "./bytes.js";

export const LAYER = 198;

export const CTOR = Object.freeze({
  vector: 0x1cb5c415,
  boolTrue: 0x997275b5,
  boolFalse: 0xbc799737,
  // auth key exchange
  reqPqMulti: 0xbe7e8ef1,
  resPQ: 0x05162463,
  pqInnerDataDc: 0xa9f55f95,
  reqDHParams: 0xd712e4be,
  serverDHParamsOk: 0xd0e8075c,
  serverDHParamsFail: 0x79cb045d,
  serverDHInnerData: 0xb5890dba,
  clientDHInnerData: 0x6643b654,
  setClientDHParams: 0xf5045f1f,
  dhGenOk: 0x3bcbf734,
  dhGenRetry: 0x46dc1fb9,
  dhGenFail: 0xa69dae02,
  // service messages
  rpcResult: 0xf35c6d01,
  rpcError: 0x2144ca19,
  msgContainer: 0x73f1f8dc,
  gzipPacked: 0x3072cfa1,
  msgsAck: 0x62d6b459,
  badServerSalt: 0xedab447b,
  badMsgNotification: 0xa7eff811,
  newSessionCreated: 0x9ec20908,
  msgDetailedInfo: 0x276d3ec6,
  msgNewDetailedInfo: 0x809db6df,
  futureSalts: 0xae500895,
  pong: 0x347773c5,
  ping: 0x7abe77ec,
  // API
  invokeWithLayer: 0xda9b0d0d,
  initConnection: 0xc1cd5ea9,
  importBotAuthorization: 0x67a3ff2c,
  exportAuthorization: 0xe5bfffcd,
  exportedAuthorization: 0xb434e2b8,
  importAuthorization: 0xa57a7dad,
  authAuthorization: 0x2ea2c0d4,
  authAuthorizationSignUpRequired: 0x44747e9a,
  user: 0x4b46c37e,
  userEmpty: 0xd3bc4b7a,
  inputDocumentFileLocation: 0xbad07584,
  uploadGetFile: 0xbe5335be,
  uploadFile: 0x096a18d5,
  uploadFileCdnRedirect: 0xf18cda44,
  // messages and documents (for the library index)
  message: 0x96fdbbe9,
  messageEmpty: 0x90a6ca84,
  messageService: 0xd3d28540,
  messageMediaDocument: 0x52d8ccd9,
  messageFwdHeader: 0x4e4df4bb,
  messageReplyHeader: 0xafbc09db,
  messageReplyStoryHeader: 0x0e5af939,
  peerUser: 0x59511722,
  peerChat: 0x36c6019a,
  peerChannel: 0xa2a5371e,
  document: 0x8fd4c4d8,
  documentEmpty: 0x36f8c871,
  updateNewMessage: 0x1f2b0afd,
  updateNewChannelMessage: 0x62ba04d9,
  updateShort: 0x78d4dec1,
  updates: 0x74ae4240,
});

const TYPED_ERROR = (message) => Object.assign(new Error(message), { code: "protocol" });

export class Writer {
  constructor() { this.parts = []; }
  raw(u8) { this.parts.push(u8 instanceof Uint8Array ? u8 : Uint8Array.from(u8)); return this; }
  int(v) { const b = new Uint8Array(4); writeU32LE(b, 0, v >>> 0); this.parts.push(b); return this; }
  long(v) { const b = new Uint8Array(8); writeI64LE(b, 0, typeof v === "bigint" ? v : BigInt(v)); this.parts.push(b); return this; }
  int128(u8) { if (u8.length !== 16) throw new Error("int128 needs 16 bytes"); return this.raw(u8); }
  int256(u8) { if (u8.length !== 32) throw new Error("int256 needs 32 bytes"); return this.raw(u8); }
  double(v) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); this.parts.push(b); return this; }
  bool(v) { return this.int(v ? CTOR.boolTrue : CTOR.boolFalse); }
  bytes(u8) {
    const n = u8.length;
    if (n > 0xffffff) throw new Error("TL bytes too long");
    const headLen = n < 254 ? 1 : 4;
    const pad = (4 - ((headLen + n) % 4)) % 4;
    const out = new Uint8Array(headLen + n + pad);
    if (n < 254) out[0] = n;
    else { out[0] = 254; out[1] = n & 255; out[2] = (n >> 8) & 255; out[3] = (n >> 16) & 255; }
    out.set(u8, headLen);
    this.parts.push(out);
    return this;
  }
  string(s) { return this.bytes(utf8(s)); }
  vectorLong(list) { this.int(CTOR.vector).int(list.length); for (const v of list) this.long(v); return this; }
  vectorInt(list) { this.int(CTOR.vector).int(list.length); for (const v of list) this.int(v); return this; }
  done() { return concat(this.parts); }
}

export class Reader {
  constructor(u8, offset = 0) { this.b = u8; this.o = offset; }
  need(n) { if (this.o + n > this.b.length) throw TYPED_ERROR("TL read past the end"); }
  int() { this.need(4); const v = readU32LE(this.b, this.o); this.o += 4; return v; }
  int32() { this.need(4); const v = readI32LE(this.b, this.o); this.o += 4; return v; }
  long() { this.need(8); const v = readI64LE(this.b, this.o); this.o += 8; return v; }
  double() { this.need(8); const v = new DataView(this.b.buffer, this.b.byteOffset + this.o, 8).getFloat64(0, true); this.o += 8; return v; }
  raw(n) { this.need(n); const v = this.b.subarray(this.o, this.o + n); this.o += n; return v; }
  int128() { return this.raw(16); }
  int256() { return this.raw(32); }
  bool() {
    const c = this.int();
    if (c === CTOR.boolTrue) return true;
    if (c === CTOR.boolFalse) return false;
    throw TYPED_ERROR("not a Bool: 0x" + c.toString(16));
  }
  bytes() {
    this.need(1);
    let len = this.b[this.o], head = 1;
    if (len === 254) { this.need(4); len = this.b[this.o + 1] | (this.b[this.o + 2] << 8) | (this.b[this.o + 3] << 16); head = 4; }
    else if (len === 255) throw TYPED_ERROR("bad TL bytes length");
    const pad = (4 - ((head + len) % 4)) % 4;
    this.need(head + len + pad);
    const v = this.b.subarray(this.o + head, this.o + head + len);
    this.o += head + len + pad;
    return v;
  }
  string() { return fromUtf8(this.bytes()); }
  vectorHeader() { const c = this.int(); if (c !== CTOR.vector) throw TYPED_ERROR("not a vector: 0x" + c.toString(16)); return this.int(); }
  vectorLong() { const n = this.vectorHeader(); const out = []; for (let i = 0; i < n; i++) out.push(this.long()); return out; }
  vectorInt() { const n = this.vectorHeader(); const out = []; for (let i = 0; i < n; i++) out.push(this.int()); return out; }
  rest() { const v = this.b.subarray(this.o); this.o = this.b.length; return v; }
  peekInt() { this.need(4); return readU32LE(this.b, this.o); }
  atEnd() { return this.o >= this.b.length; }
}

// ---- builders: auth key exchange ----

export const reqPqMulti = (nonce) => new Writer().int(CTOR.reqPqMulti).int128(nonce).done();

export const pqInnerDataDc = ({ pq, p, q, nonce, serverNonce, newNonce, dc }) =>
  new Writer().int(CTOR.pqInnerDataDc).bytes(pq).bytes(p).bytes(q).int128(nonce).int128(serverNonce).int256(newNonce).int(dc).done();

export const reqDHParams = ({ nonce, serverNonce, p, q, fingerprint, encryptedData }) =>
  new Writer().int(CTOR.reqDHParams).int128(nonce).int128(serverNonce).bytes(p).bytes(q).long(fingerprint).bytes(encryptedData).done();

export const clientDHInnerData = ({ nonce, serverNonce, retryId = 0n, gB }) =>
  new Writer().int(CTOR.clientDHInnerData).int128(nonce).int128(serverNonce).long(retryId).bytes(gB).done();

export const setClientDHParams = ({ nonce, serverNonce, encryptedData }) =>
  new Writer().int(CTOR.setClientDHParams).int128(nonce).int128(serverNonce).bytes(encryptedData).done();

// ---- builders: API ----

export const invokeWithLayer = (layer, query) => new Writer().int(CTOR.invokeWithLayer).int(layer).raw(query).done();

export function initConnection({ apiId, deviceModel, systemVersion, appVersion, systemLangCode, langPack = "", langCode }, query) {
  return new Writer().int(CTOR.initConnection).int(0).int(apiId)
    .string(deviceModel).string(systemVersion).string(appVersion).string(systemLangCode).string(langPack).string(langCode)
    .raw(query).done();
}

export const importBotAuthorization = ({ apiId, apiHash, botToken }) =>
  new Writer().int(CTOR.importBotAuthorization).int(0).int(apiId).string(apiHash).string(botToken).done();

export const exportAuthorization = (dcId) => new Writer().int(CTOR.exportAuthorization).int(dcId).done();

export const importAuthorization = ({ id, bytes }) => new Writer().int(CTOR.importAuthorization).long(id).bytes(bytes).done();

// account login (QR) and logout, layer 198:
// auth.exportLoginToken#b7e085fe api_id:int api_hash:string except_ids:Vector<long> = auth.LoginToken
// auth.importLoginToken#95ac5ce4 token:bytes = auth.LoginToken
// account.getPassword#548a30f5 = account.Password
// auth.checkPassword#d18b4d16 password:InputCheckPasswordSRP = auth.Authorization
// inputCheckPasswordSRP#d27ff082 srp_id:long A:bytes M1:bytes
// auth.logOut#3e72ba19 = auth.LoggedOut
export const exportLoginToken = ({ apiId, apiHash }) => new Writer().int(0xb7e085fe).int(apiId).string(apiHash).vectorLong([]).done();
export const importLoginToken = (token) => new Writer().int(0x95ac5ce4).bytes(token).done();
export const getPassword = () => new Writer().int(0x548a30f5).done();
export const checkPassword = ({ srpId, A, M1 }) => new Writer().int(0xd18b4d16).int(0xd27ff082).long(srpId).bytes(A).bytes(M1).done();
export const logOut = () => new Writer().int(0x3e72ba19).done();

export const msgsAck = (ids) => new Writer().int(CTOR.msgsAck).vectorLong(ids).done();

export const inputDocumentFileLocation = ({ id, accessHash, fileReference, thumbSize = "" }) =>
  new Writer().int(CTOR.inputDocumentFileLocation).long(id).long(accessHash).bytes(fileReference).string(thumbSize).done();

export const uploadGetFile = (location, offset, limit, { precise = false, cdnSupported = false } = {}) =>
  new Writer().int(CTOR.uploadGetFile).int((precise ? 1 : 0) | (cdnSupported ? 2 : 0)).raw(location).long(offset).int(limit).done();

// ---- readers ----

export function parseRpcError(r) {
  const c = r.int();
  if (c !== CTOR.rpcError) throw TYPED_ERROR("not an rpc_error");
  return { code: r.int32(), message: r.string() };
}

/** upload.file -> { ctor, fileType, mtime, bytes }; anything else -> { ctor, raw }. */
export function parseUploadFile(u8) {
  const r = new Reader(u8);
  const ctor = r.int();
  if (ctor !== CTOR.uploadFile) return { ctor, raw: u8 };
  const fileType = r.int();
  const mtime = r.int();
  return { ctor, fileType, mtime, bytes: r.bytes() };
}

// ---- the same reads on hex (the download path: only the few header bytes are decoded, the data is a native slice) ----

/** The uint32 (little endian) at byte `o` of a hex string. */
export function hexU32(hex, o) {
  if (hex.length < (o + 4) * 2) throw TYPED_ERROR("TL read past the end");
  return readU32LE(fromHex(hex.slice(o * 2, o * 2 + 8)), 0);
}

/** The TL `bytes` at byte `o` of a hex string: { hex, end } (`end` = the byte offset after its padding). */
export function hexBytesAt(hex, o) {
  const size = hex.length / 2;
  if (o + 1 > size) throw TYPED_ERROR("TL read past the end");
  let len = parseInt(hex.slice(o * 2, o * 2 + 2), 16), head = 1;
  if (len === 254) {
    if (o + 4 > size) throw TYPED_ERROR("TL read past the end");
    const h = fromHex(hex.slice(o * 2 + 2, o * 2 + 8));
    len = h[0] | (h[1] << 8) | (h[2] << 16);
    head = 4;
  } else if (len === 255) throw TYPED_ERROR("bad TL bytes length");
  const pad = (4 - ((head + len) % 4)) % 4;
  if (o + head + len + pad > size) throw TYPED_ERROR("TL read past the end");
  return { hex: hex.slice((o + head) * 2, (o + head + len) * 2), end: o + head + len + pad };
}

/** parseUploadFile over hex: { ctor, fileType, mtime, bytesHex } for upload.file, else { ctor }. */
export function parseUploadFileHex(hex) {
  const ctor = hexU32(hex, 0);
  if (ctor !== CTOR.uploadFile) return { ctor };
  return { ctor, fileType: hexU32(hex, 4), mtime: hexU32(hex, 8), bytesHex: hexBytesAt(hex, 12).hex };
}

export function parseExportedAuthorization(u8) {
  const r = new Reader(u8);
  const ctor = r.int();
  if (ctor !== CTOR.exportedAuthorization) return { ctor, raw: u8 };
  return { ctor, id: r.long(), bytes: r.bytes() };
}

/** auth.authorization -> { ctor, userId?, tmpSessions?, ... }; only the head of User is read (flags, flags2, id). */
export function parseAuthorization(u8) {
  const r = new Reader(u8);
  const ctor = r.int();
  if (ctor === CTOR.authAuthorizationSignUpRequired) return { ctor, signUpRequired: true };
  if (ctor !== CTOR.authAuthorization) return { ctor, raw: u8 };
  const out = { ctor };
  const flags = r.int();
  if (flags & 2) { out.setupPasswordRequired = true; out.otherwiseReloginDays = r.int(); }
  if (flags & 1) out.tmpSessions = r.int();
  if (flags & 4) out.futureAuthToken = r.bytes();
  try {
    const userCtor = r.int();
    if (userCtor === CTOR.userEmpty) out.userId = r.long();
    else if (userCtor === CTOR.user) { const uflags = r.int(); r.int(); out.userId = r.long(); out.bot = (uflags & (1 << 14)) !== 0; }
    else out.userCtor = userCtor;
  } catch { out.incomplete = true; }
  return out;
}

function parsePeer(r) {
  const c = r.int();
  if (c === CTOR.peerUser) return { kind: "user", id: r.long() };
  if (c === CTOR.peerChat) return { kind: "chat", id: r.long() };
  if (c === CTOR.peerChannel) return { kind: "channel", id: r.long() };
  throw TYPED_ERROR("unknown Peer 0x" + c.toString(16));
}

const PHOTO_SIZE = {
  0x0e17e23c: (r) => { r.string(); },
  0x75c78e60: (r) => { r.string(); r.int(); r.int(); r.int(); },
  0x021e1ad6: (r) => { r.string(); r.int(); r.int(); r.bytes(); },
  0xe0b0bc2e: (r) => { r.string(); r.bytes(); },
  0xfa3efb95: (r) => { r.string(); r.int(); r.int(); r.vectorInt(); },
  0xd8214d41: (r) => { r.string(); r.bytes(); },
};
const INPUT_STICKER_SET = {
  0xffb62b95: () => {},
  0x9de7a269: (r) => { r.long(); r.long(); },
  0x861cc8a0: (r) => { r.string(); },
};
const skipInputStickerSet = (r) => { const c = r.int(); const f = INPUT_STICKER_SET[c]; if (!f) throw TYPED_ERROR("unknown InputStickerSet"); f(r); };
const VIDEO_SIZE = {
  0xde33b094: (r) => { const fl = r.int(); r.string(); r.int(); r.int(); r.int(); if (fl & 1) r.double(); },
  0xf85c413c: (r) => { r.long(); r.vectorInt(); },
  0x0da082fe: (r) => { skipInputStickerSet(r); r.long(); r.vectorInt(); },
};

function skipVectorOf(r, table, what) {
  const n = r.vectorHeader();
  for (let i = 0; i < n; i++) {
    const c = r.int();
    const f = table[c];
    if (!f) throw TYPED_ERROR("unknown " + what + " 0x" + c.toString(16));
    f(r);
  }
}

/** A DocumentAttribute into `doc`; false for an unknown constructor (the reader is then unusable past it). */
function readAttribute(r, doc) {
  const c = r.int();
  switch (c) {
    case 0x6c37c15c: doc.imageSize = { w: r.int(), h: r.int() }; return true;
    case 0x11b58939: doc.animated = true; return true;
    case 0x6319d612: { const fl = r.int(); r.string(); skipInputStickerSet(r); if (fl & 1) { r.int(); r.double(); r.double(); r.double(); } doc.sticker = true; return true; }
    case 0x43c57c48: {
      const fl = r.int();
      const duration = r.double(), w = r.int(), h = r.int();
      if (fl & 4) r.int();
      if (fl & 16) r.double();
      if (fl & 32) r.string();
      doc.video = { duration, w, h, supportsStreaming: (fl & 2) !== 0, roundMessage: (fl & 1) !== 0 };
      return true;
    }
    case 0x9852f9c6: {
      const fl = r.int();
      const a = { duration: r.int(), voice: (fl & 1024) !== 0 };
      if (fl & 1) a.title = r.string();
      if (fl & 2) a.performer = r.string();
      if (fl & 4) r.bytes();
      doc.audio = a;
      return true;
    }
    case 0x15590068: doc.fileName = r.string(); return true;
    case 0x9801d2f7: return true;
    case 0xfd149899: { r.int(); r.string(); skipInputStickerSet(r); return true; }
    default: return false;
  }
}

/**
 * Document -> { id, accessHash, fileReference, date, mimeType, size, dcId, fileName?, video?, audio?, ... }.
 * documentEmpty -> { empty: true, id }; another constructor -> { ctor, unknown: true }. An unknown attribute stops the
 * read with `incomplete: true` and the fields read so far (the reader cannot continue past it).
 */
export function parseDocument(r) {
  const ctor = r.int();
  if (ctor === CTOR.documentEmpty) return { ctor, empty: true, id: r.long() };
  if (ctor !== CTOR.document) return { ctor, unknown: true };
  const flags = r.int();
  const doc = { ctor, id: r.long(), accessHash: r.long(), fileReference: r.bytes(), date: r.int(), mimeType: r.string(), size: Number(r.long()) };
  if (flags & 1) skipVectorOf(r, PHOTO_SIZE, "PhotoSize");
  if (flags & 2) skipVectorOf(r, VIDEO_SIZE, "VideoSize");
  doc.dcId = r.int();
  const n = r.vectorHeader();
  for (let i = 0; i < n; i++) {
    if (!readAttribute(r, doc)) { doc.incomplete = true; break; }
  }
  return doc;
}

/** MessageMedia: messageMediaDocument -> { ctor, document, video, round, voice }; others -> { ctor, unknown: true }. */
export function parseMessageMedia(r) {
  const ctor = r.int();
  if (ctor !== CTOR.messageMediaDocument) return { ctor, unknown: true };
  const flags = r.int();
  const out = { ctor, video: (flags & 64) !== 0, round: (flags & 128) !== 0, voice: (flags & 256) !== 0 };
  if (flags & 1) out.document = parseDocument(r);
  return out;
}

function skipFwdHeader(r) {
  if (r.int() !== CTOR.messageFwdHeader) throw TYPED_ERROR("unknown MessageFwdHeader");
  const f = r.int();
  if (f & 1) parsePeer(r);
  if (f & 32) r.string();
  r.int();
  if (f & 4) r.int();
  if (f & 8) r.string();
  if (f & 16) { parsePeer(r); r.int(); }
  if (f & 256) parsePeer(r);
  if (f & 512) r.string();
  if (f & 1024) r.int();
  if (f & 64) r.string();
}

function skipReplyHeader(r) {
  const c = r.int();
  if (c === CTOR.messageReplyStoryHeader) { parsePeer(r); r.int(); return; }
  if (c !== CTOR.messageReplyHeader) throw TYPED_ERROR("unknown MessageReplyHeader");
  const f = r.int();
  if (f & 16) r.int();
  if (f & 1) parsePeer(r);
  if (f & 32) skipFwdHeader(r);
  if (f & 256) throw TYPED_ERROR("reply_media is not supported"); // an arbitrary MessageMedia: no way to skip it
  if (f & 2) r.int();
  if (f & 64) r.string();
  if (f & 128) throw TYPED_ERROR("quote_entities is not supported");
  if (f & 1024) r.int();
}

/**
 * The head of a Message, up to and including its media (what the library index needs): { ctor, id, peer, fromId?,
 * date, text, media? }. The fields after `media` are not read, so the reader is left inside the message: use this on
 * a message you hold on its own, not to walk a vector. Unsupported shapes give { ctor, id?, unsupported: reason }.
 */
export function parseMessage(r) {
  const ctor = r.int();
  if (ctor !== CTOR.message) return { ctor, unknown: true };
  const out = { ctor };
  try {
    const flags = r.int();
    const flags2 = r.int();
    out.id = r.int();
    if (flags & (1 << 8)) out.fromId = parsePeer(r);
    if (flags & (1 << 29)) r.int();
    out.peer = parsePeer(r);
    if (flags & (1 << 28)) parsePeer(r);
    if (flags & (1 << 2)) { out.forwarded = true; skipFwdHeader(r); }
    if (flags & (1 << 11)) r.long();
    if (flags2 & 1) r.long();
    if (flags & (1 << 3)) skipReplyHeader(r);
    out.date = r.int();
    out.text = r.string();
    if (flags & (1 << 9)) out.media = parseMessageMedia(r);
  } catch (e) {
    out.unsupported = String(e && e.message);
  }
  return out;
}
