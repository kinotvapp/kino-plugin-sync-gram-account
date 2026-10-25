// Built by scripts/build.mjs from src/plugin.js -- do not edit; edit src/ and rebuild.

// ---- src/mtproto/bytes.js ----
const __mod_src_mtproto_bytes = (() => {
// Uint8Array helpers for a runtime without Buffer (Kino's QuickJS). kino.crypto takes and returns strings, so the hot
// conversions (hex and base64 of a 1 MiB chunk) are written as single passes over typed arrays: each output character
// is a table lookup into a Uint8Array of char codes, turned into a string 8192 characters at a time with
// String.fromCharCode.apply (native), never by appending one character at a time.

const HEX_CHARS = "0123456789abcdef";
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const STR_CHUNK = 8192; // characters per String.fromCharCode.apply call (a multiple of 4 and of 2)

const HEX_CODE = new Uint8Array(16);
for (let i = 0; i < 16; i++) HEX_CODE[i] = HEX_CHARS.charCodeAt(i);
const HEX_VALUE = new Int8Array(256).fill(-1);
for (let i = 0; i < 16; i++) {
  HEX_VALUE[HEX_CHARS.charCodeAt(i)] = i;
  HEX_VALUE[HEX_CHARS.toUpperCase().charCodeAt(i)] = i;
}
const B64_CODE = new Uint8Array(64);
for (let i = 0; i < 64; i++) B64_CODE[i] = B64_CHARS.charCodeAt(i);
const B64_VALUE = new Int8Array(256).fill(-1);
for (let i = 0; i < 64; i++) B64_VALUE[B64_CHARS.charCodeAt(i)] = i;
B64_VALUE[45] = 62; // '-' (base64url)
B64_VALUE[95] = 63; // '_'

/** Char codes (all < 128) to a string, in native chunks. */
function codesToString(codes, length) {
  const parts = [];
  for (let i = 0; i < length; i += STR_CHUNK) {
    parts.push(String.fromCharCode.apply(null, codes.subarray(i, Math.min(i + STR_CHUNK, length))));
  }
  return parts.length === 1 ? parts[0] : parts.join("");
}

function toHex(u8) {
  const n = u8.length;
  const codes = new Uint8Array(n * 2);
  for (let i = 0, j = 0; i < n; i++, j += 2) {
    const b = u8[i];
    codes[j] = HEX_CODE[b >> 4];
    codes[j + 1] = HEX_CODE[b & 15];
  }
  return codesToString(codes, codes.length);
}

function fromHex(hex) {
  const s = String(hex);
  if (s.length % 2 !== 0) throw new Error("invalid hex: odd length");
  const n = s.length >> 1;
  const out = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 2) {
    const hi = HEX_VALUE[s.charCodeAt(j) & 255], lo = HEX_VALUE[s.charCodeAt(j + 1) & 255];
    if (hi < 0 || lo < 0 || s.charCodeAt(j) > 255 || s.charCodeAt(j + 1) > 255) throw new Error("invalid hex character");
    out[i] = (hi << 4) | lo;
  }
  return out;
}

function toBase64(u8) {
  const n = u8.length;
  const codes = new Uint8Array(((n + 2) / 3 | 0) * 4);
  let i = 0, j = 0;
  for (; i + 2 < n; i += 3, j += 4) {
    const v = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
    codes[j] = B64_CODE[v >> 18];
    codes[j + 1] = B64_CODE[(v >> 12) & 63];
    codes[j + 2] = B64_CODE[(v >> 6) & 63];
    codes[j + 3] = B64_CODE[v & 63];
  }
  if (i < n) {
    const two = i + 1 < n;
    const v = (u8[i] << 16) | (two ? u8[i + 1] << 8 : 0);
    codes[j] = B64_CODE[v >> 18];
    codes[j + 1] = B64_CODE[(v >> 12) & 63];
    codes[j + 2] = two ? B64_CODE[(v >> 6) & 63] : 61;
    codes[j + 3] = 61;
  }
  return codesToString(codes, codes.length);
}

function fromBase64(b64) {
  const s = String(b64);
  let len = s.length;
  while (len > 0 && s.charCodeAt(len - 1) === 61) len--; // '='
  if (s.length - len > 2 || len % 4 === 1) throw new Error("invalid base64 length");
  const out = new Uint8Array((len * 3) >> 2);
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    const v = c < 256 ? B64_VALUE[c] : -1;
    if (v < 0) throw new Error("invalid base64 character");
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  return out;
}

/** Hex straight to base64 (the read() export answers base64; a downloaded chunk may arrive as hex). */
function hexToBase64(hex) {
  return toBase64(fromHex(hex));
}

function concat(...parts) {
  const list = parts.length === 1 && Array.isArray(parts[0]) ? parts[0] : parts;
  let n = 0;
  for (const p of list) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of list) { out.set(p, o); o += p.length; }
  return out;
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

function xor(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

function reversed(u8) {
  const out = new Uint8Array(u8.length);
  for (let i = 0, n = u8.length; i < n; i++) out[i] = u8[n - 1 - i];
  return out;
}

function readU32LE(u8, o) {
  return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
}
function readI32LE(u8, o) {
  return u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24);
}
function writeU32LE(u8, o, v) {
  u8[o] = v & 255; u8[o + 1] = (v >>> 8) & 255; u8[o + 2] = (v >>> 16) & 255; u8[o + 3] = (v >>> 24) & 255;
}
function readI64LE(u8, o) {
  const lo = BigInt(readU32LE(u8, o)), hi = BigInt(readU32LE(u8, o + 4));
  return BigInt.asIntN(64, (hi << 32n) | lo);
}
function writeI64LE(u8, o, v) {
  const x = BigInt.asUintN(64, BigInt(v));
  writeU32LE(u8, o, Number(x & 0xffffffffn));
  writeU32LE(u8, o + 4, Number(x >> 32n));
}

/** Big-endian unsigned bytes to BigInt. */
function bigFromBytes(u8) {
  return u8.length ? BigInt("0x" + toHex(u8)) : 0n;
}

/** BigInt to big-endian unsigned bytes, left-padded to `len` when given. */
function bigToBytes(n, len) {
  if (n < 0n) throw new Error("negative BigInt");
  let h = n.toString(16);
  if (h.length % 2) h = "0" + h;
  if (n === 0n) h = len ? "" : "00";
  const raw = fromHex(h);
  if (!len) return raw;
  if (raw.length > len) throw new Error("BigInt does not fit in " + len + " bytes");
  const out = new Uint8Array(len);
  out.set(raw, len - raw.length);
  return out;
}

/** BigInt to fixed-width big-endian hex (kino.crypto.modPow speaks hex). */
function bigToHex(n, len) {
  return toHex(bigToBytes(n, len));
}

/** `n` random bytes from kino.crypto (at most 1024 per call there). */
function random(n) {
  const out = new Uint8Array(n);
  for (let o = 0; o < n; o += 1024) {
    const k = Math.min(1024, n - o);
    out.set(fromHex(kino.crypto.randomBytes(k, "hex")), o);
  }
  return out;
}

const utf8 = (s) => new TextEncoder().encode(String(s));
const fromUtf8 = (u8) => new TextDecoder().decode(u8);
return { toHex, fromHex, toBase64, fromBase64, hexToBase64, concat, equal, xor, reversed, readU32LE, readI32LE, writeU32LE, readI64LE, writeI64LE, bigFromBytes, bigToBytes, bigToHex, random, utf8, fromUtf8 };
})();

// ---- src/mtproto/tl.js ----
const __mod_src_mtproto_tl = (() => {
// TL serialization for the constructors this plugin uses (MTProto layer 198), ported from the spike's W/R
// (telegram-mtproto-spike/mtproto.mjs) to Uint8Array. Readers of server answers never crash on a constructor they do
// not know: they answer { ctor, raw } (or mark what they read as `incomplete`) and leave the decision to the caller.
const { concat, utf8, fromUtf8, fromHex, readU32LE, readI32LE, writeU32LE, writeI64LE, readI64LE } = __mod_src_mtproto_bytes;

const LAYER = 198;

const CTOR = Object.freeze({
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

class Writer {
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

class Reader {
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

const reqPqMulti = (nonce) => new Writer().int(CTOR.reqPqMulti).int128(nonce).done();

const pqInnerDataDc = ({ pq, p, q, nonce, serverNonce, newNonce, dc }) =>
  new Writer().int(CTOR.pqInnerDataDc).bytes(pq).bytes(p).bytes(q).int128(nonce).int128(serverNonce).int256(newNonce).int(dc).done();

const reqDHParams = ({ nonce, serverNonce, p, q, fingerprint, encryptedData }) =>
  new Writer().int(CTOR.reqDHParams).int128(nonce).int128(serverNonce).bytes(p).bytes(q).long(fingerprint).bytes(encryptedData).done();

const clientDHInnerData = ({ nonce, serverNonce, retryId = 0n, gB }) =>
  new Writer().int(CTOR.clientDHInnerData).int128(nonce).int128(serverNonce).long(retryId).bytes(gB).done();

const setClientDHParams = ({ nonce, serverNonce, encryptedData }) =>
  new Writer().int(CTOR.setClientDHParams).int128(nonce).int128(serverNonce).bytes(encryptedData).done();

// ---- builders: API ----

const invokeWithLayer = (layer, query) => new Writer().int(CTOR.invokeWithLayer).int(layer).raw(query).done();

function initConnection({ apiId, deviceModel, systemVersion, appVersion, systemLangCode, langPack = "", langCode }, query) {
  return new Writer().int(CTOR.initConnection).int(0).int(apiId)
    .string(deviceModel).string(systemVersion).string(appVersion).string(systemLangCode).string(langPack).string(langCode)
    .raw(query).done();
}

const importBotAuthorization = ({ apiId, apiHash, botToken }) =>
  new Writer().int(CTOR.importBotAuthorization).int(0).int(apiId).string(apiHash).string(botToken).done();

const exportAuthorization = (dcId) => new Writer().int(CTOR.exportAuthorization).int(dcId).done();

const importAuthorization = ({ id, bytes }) => new Writer().int(CTOR.importAuthorization).long(id).bytes(bytes).done();

// account login (QR) and logout, layer 198:
// auth.exportLoginToken#b7e085fe api_id:int api_hash:string except_ids:Vector<long> = auth.LoginToken
// auth.importLoginToken#95ac5ce4 token:bytes = auth.LoginToken
// account.getPassword#548a30f5 = account.Password
// auth.checkPassword#d18b4d16 password:InputCheckPasswordSRP = auth.Authorization
// inputCheckPasswordSRP#d27ff082 srp_id:long A:bytes M1:bytes
// auth.logOut#3e72ba19 = auth.LoggedOut
const exportLoginToken = ({ apiId, apiHash }) => new Writer().int(0xb7e085fe).int(apiId).string(apiHash).vectorLong([]).done();
const importLoginToken = (token) => new Writer().int(0x95ac5ce4).bytes(token).done();
const getPassword = () => new Writer().int(0x548a30f5).done();
const checkPassword = ({ srpId, A, M1 }) => new Writer().int(0xd18b4d16).int(0xd27ff082).long(srpId).bytes(A).bytes(M1).done();
const logOut = () => new Writer().int(0x3e72ba19).done();

const msgsAck = (ids) => new Writer().int(CTOR.msgsAck).vectorLong(ids).done();

const inputDocumentFileLocation = ({ id, accessHash, fileReference, thumbSize = "" }) =>
  new Writer().int(CTOR.inputDocumentFileLocation).long(id).long(accessHash).bytes(fileReference).string(thumbSize).done();

const uploadGetFile = (location, offset, limit, { precise = false, cdnSupported = false } = {}) =>
  new Writer().int(CTOR.uploadGetFile).int((precise ? 1 : 0) | (cdnSupported ? 2 : 0)).raw(location).long(offset).int(limit).done();

// ---- readers ----

function parseRpcError(r) {
  const c = r.int();
  if (c !== CTOR.rpcError) throw TYPED_ERROR("not an rpc_error");
  return { code: r.int32(), message: r.string() };
}

/** upload.file -> { ctor, fileType, mtime, bytes }; anything else -> { ctor, raw }. */
function parseUploadFile(u8) {
  const r = new Reader(u8);
  const ctor = r.int();
  if (ctor !== CTOR.uploadFile) return { ctor, raw: u8 };
  const fileType = r.int();
  const mtime = r.int();
  return { ctor, fileType, mtime, bytes: r.bytes() };
}

// ---- the same reads on hex (the download path: only the few header bytes are decoded, the data is a native slice) ----

/** The uint32 (little endian) at byte `o` of a hex string. */
function hexU32(hex, o) {
  if (hex.length < (o + 4) * 2) throw TYPED_ERROR("TL read past the end");
  return readU32LE(fromHex(hex.slice(o * 2, o * 2 + 8)), 0);
}

/** The TL `bytes` at byte `o` of a hex string: { hex, end } (`end` = the byte offset after its padding). */
function hexBytesAt(hex, o) {
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
function parseUploadFileHex(hex) {
  const ctor = hexU32(hex, 0);
  if (ctor !== CTOR.uploadFile) return { ctor };
  return { ctor, fileType: hexU32(hex, 4), mtime: hexU32(hex, 8), bytesHex: hexBytesAt(hex, 12).hex };
}

function parseExportedAuthorization(u8) {
  const r = new Reader(u8);
  const ctor = r.int();
  if (ctor !== CTOR.exportedAuthorization) return { ctor, raw: u8 };
  return { ctor, id: r.long(), bytes: r.bytes() };
}

/** auth.authorization -> { ctor, userId?, tmpSessions?, ... }; only the head of User is read (flags, flags2, id). */
function parseAuthorization(u8) {
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
function parseDocument(r) {
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
function parseMessageMedia(r) {
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
function parseMessage(r) {
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
return { LAYER, CTOR, Writer, Reader, reqPqMulti, pqInnerDataDc, reqDHParams, clientDHInnerData, setClientDHParams, invokeWithLayer, initConnection, importBotAuthorization, exportAuthorization, importAuthorization, exportLoginToken, importLoginToken, getPassword, checkPassword, logOut, msgsAck, inputDocumentFileLocation, uploadGetFile, parseRpcError, parseUploadFile, hexU32, hexBytesAt, parseUploadFileHex, parseExportedAuthorization, parseAuthorization, parseDocument, parseMessageMedia, parseMessage };
})();

// ---- src/mtproto/crypto.js ----
const __mod_src_mtproto_crypto = (() => {
// The kino.crypto calls MTProto needs, with hex on both sides (hex can be sliced and joined at any byte, base64 only
// at multiples of 3). Every primitive runs natively in the app: hashes, AES-IGE, AES-CTR, modPow and gunzip.
const { toHex, fromHex, concat } = __mod_src_mtproto_bytes;

const HEX = { inputEncoding: "hex", outputEncoding: "hex" };

const sha1Hex = (hex) => kino.crypto.hash("sha1", hex, HEX);
const sha256Hex = (hex) => kino.crypto.hash("sha256", hex, HEX);
const sha1 = (...parts) => fromHex(sha1Hex(toHex(concat(parts))));
const sha256 = (...parts) => fromHex(sha256Hex(toHex(concat(parts))));

/** AES-256-IGE over hex. */
const igeEncryptHex = (dataHex, keyHex, ivHex) =>
  kino.crypto.aesIge("encrypt", keyHex, ivHex, dataHex, { keyEncoding: "hex", ivEncoding: "hex", ...HEX });
const igeDecryptHex = (dataHex, keyHex, ivHex) =>
  kino.crypto.aesIge("decrypt", keyHex, ivHex, dataHex, { keyEncoding: "hex", ivEncoding: "hex", ...HEX });
const igeEncrypt = (data, key, iv) => fromHex(igeEncryptHex(toHex(data), toHex(key), toHex(iv)));
const igeDecrypt = (data, key, iv) => fromHex(igeDecryptHex(toHex(data), toHex(key), toHex(iv)));

/** One-shot AES-256-CTR over hex, counter block = `ivHex` (CTR encryption and decryption are the same operation). */
const ctrHex = (dataHex, keyHex, ivHex) =>
  kino.crypto.encrypt("aes-256-ctr", { key: keyHex, iv: ivHex, data: dataHex, keyEncoding: "hex", ivEncoding: "hex", ...HEX });

/** base^exp mod mod over big-endian hex; the answer is padded to the modulus' byte width. */
const modPowHex = (baseHex, expHex, modHex) => kino.crypto.modPow(baseHex, expHex, modHex);

const gunzipHex = (hex) => kino.crypto.gunzip(hex, HEX);
return { sha1Hex, sha256Hex, sha1, sha256, igeEncryptHex, igeDecryptHex, igeEncrypt, igeDecrypt, ctrHex, modPowHex, gunzipHex };
})();

// ---- src/mtproto/errors.js ----
const __mod_src_mtproto_errors = (() => {
// Typed errors: every failure the library throws is an Error with a string `code` from CODES, plus the extra fields
// the code needs (`seconds` for flood_wait/login_budget, `dc` for the migrations, `rpc`/`status` for server errors).

const CODES = Object.freeze([
  "flood_wait",             // { seconds } Telegram asked to wait (FLOOD_WAIT_n, or a transport flood -429)
  "file_migrate",           // { dc } the file lives on another DC (FILE_MIGRATE_n)
  "user_migrate",           // { dc } the account lives on another DC (USER_/PHONE_/NETWORK_MIGRATE_n)
  "file_reference_expired", // the document's file_reference must be refreshed from its message
  "auth_key_unregistered",  // the server does not know this key or session (401s, transport -404)
  "bad_msg",                // { badMsgCode } the server refused our message and resending did not help
  "closed",                 // the socket closed
  "timeout",                // no answer in time
  "protocol",               // malformed or unexpected data from the server
  "rpc_error",              // { status, rpc } any other server error
  "invalid_request",        // bad arguments from the caller (offset/limit rules, missing fields)
  "login_budget",           // { seconds } too many bot logins on this device in the last hour
  "channel_invalid",        // the channel is unknown, its access hash is wrong, or the bot lost access (CHANNEL_INVALID/PRIVATE)
  "bot_method_invalid",     // a method bots may not call (BOT_METHOD_INVALID)
  "token_invalid",          // the bot token was refused at login (ACCESS_TOKEN_INVALID / ACCESS_TOKEN_EXPIRED)
  "api_id_invalid",         // the api_id/api_hash pair was refused (API_ID_INVALID, API_ID_PUBLISHED_FLOOD)
  "password_needed",        // the account has a 2FA password: auth.checkPassword next (SESSION_PASSWORD_NEEDED)
  "password_invalid",       // the 2FA password was wrong (PASSWORD_HASH_INVALID), or its SRP round went stale (SRP_ID_INVALID)
  "login_token_invalid",    // a QR login token expired, was already used or is unknown (AUTH_TOKEN_*)
]);

function mtError(code, message, extra) {
  const e = new Error(message);
  e.name = "MtprotoError";
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}

/** An rpc_error { code, message } as a typed error. */
function fromRpcError({ code, message }) {
  const m = String(message);
  const tail = (re) => { const x = re.exec(m); return x ? Number(x[1]) : null; };
  let n;
  if ((n = tail(/^FLOOD_(?:PREMIUM_)?WAIT_(\d+)$/)) !== null) return mtError("flood_wait", m, { seconds: n, status: code, rpc: m });
  if ((n = tail(/^FILE_MIGRATE_(\d+)$/)) !== null) return mtError("file_migrate", m, { dc: n, status: code, rpc: m });
  if ((n = tail(/^(?:USER|PHONE|NETWORK)_MIGRATE_(\d+)$/)) !== null) return mtError("user_migrate", m, { dc: n, status: code, rpc: m });
  if (/^FILE_REFERENCE_/.test(m)) return mtError("file_reference_expired", m, { status: code, rpc: m });
  if (m === "CHANNEL_INVALID" || m === "CHANNEL_PRIVATE") return mtError("channel_invalid", m, { status: code, rpc: m });
  if (/^ACCESS_TOKEN_(INVALID|EXPIRED)$/.test(m)) return mtError("token_invalid", m, { status: code, rpc: m });
  if (/^API_ID_(INVALID|PUBLISHED_FLOOD)$/.test(m)) return mtError("api_id_invalid", m, { status: code, rpc: m });
  if (m === "BOT_METHOD_INVALID") return mtError("bot_method_invalid", m, { status: code, rpc: m });
  // Before the 401 rule: SESSION_PASSWORD_NEEDED is a 401 that keeps the key (the login goes on with the password).
  if (m === "SESSION_PASSWORD_NEEDED") return mtError("password_needed", m, { status: code, rpc: m });
  if (m === "PASSWORD_HASH_INVALID" || m === "SRP_ID_INVALID" || m === "SRP_PASSWORD_CHANGED") return mtError("password_invalid", m, { status: code, rpc: m });
  if (/^AUTH_TOKEN_(INVALID|EXPIRED|ALREADY_ACCEPTED|INVALIDX)$/.test(m)) return mtError("login_token_invalid", m, { status: code, rpc: m });
  if (code === 401 || /^AUTH_KEY_(UNREGISTERED|INVALID|DUPLICATED)$/.test(m) || m === "SESSION_REVOKED") return mtError("auth_key_unregistered", m, { status: code, rpc: m });
  return mtError("rpc_error", code + " " + m, { status: code, rpc: m });
}

/** A 4-byte transport packet (a negative int32 error code) as a typed error. */
function fromTransportError(status) {
  if (status === -404) return mtError("auth_key_unregistered", "transport error -404", { status, transport: true });
  if (status === -429) return mtError("flood_wait", "transport error -429", { status, seconds: 5, transport: true });
  return mtError("protocol", "transport error " + status, { status, transport: true });
}

const scrubText = (s) => String(s).replace(/[0-9a-fA-F]{16,}/g, "<hex>").replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, "<b64>").replace(/["\\]/g, "'").replace(/\s+/g, " ").slice(0, 160);

/**
 * One line of detail for any thrown value, for the logs: a typed error as `code=<code> rpc=<RPC> seconds= dc=`, anything
 * else as `code=- name=<constructor or typeof> message="<text>" at=<first stack frame>`. Long hex or base64 runs are cut
 * out (no data, no keys), and nothing is ever `undefined`.
 */
function describeError(e) {
  if (e && typeof e === "object" && typeof e.code === "string" && /^[a-z_]{1,40}$/.test(e.code)) {
    const parts = ["code=" + e.code];
    if (typeof e.rpc === "string" && /^[A-Z0-9_]{1,60}$/.test(e.rpc)) parts.push("rpc=" + e.rpc);
    if (Number.isFinite(e.seconds)) parts.push("seconds=" + Math.round(e.seconds));
    if (Number.isFinite(e.dc)) parts.push("dc=" + Math.round(e.dc));
    if (e.deadline === true) parts.push("deadline=1");
    return parts.join(" ");
  }
  if (e instanceof Error || (e && typeof e === "object" && typeof e.message === "string")) {
    const name = typeof e.name === "string" && e.name ? e.name : "Error";
    const frame = typeof e.stack === "string" ? (e.stack.split("\n").map((l) => l.trim()).find((l) => l.startsWith("at ")) || "") : "";
    return 'code=- name=' + scrubText(name).replace(/\s/g, "") + ' message="' + scrubText(e.message) + '"' + (frame ? " at=" + scrubText(frame.slice(3)).replace(/\s/g, "") : "");
  }
  if (e === null) return 'code=- name=null message=""';
  if (e === undefined) return 'code=- name=nothing message=""'; // `throw undefined`: said so, never the word undefined
  if (typeof e === "object") return 'code=- name=object message="[object]"';
  return "code=- name=" + typeof e + ' message="' + scrubText(e) + '"';
}

/** Whether `e` leaves the connection it came from in a known state (a server's own answer): else it must be dropped. */
const isServerAnswer = (e) => !!(e && typeof e === "object" && ["flood_wait", "file_migrate", "user_migrate", "file_reference_expired", "rpc_error", "channel_invalid", "bot_method_invalid", "token_invalid", "api_id_invalid", "auth_key_unregistered", "login_budget", "invalid_request", "password_needed", "password_invalid", "login_token_invalid"].includes(e.code) && !e.transport);
return { CODES, mtError, fromRpcError, fromTransportError, describeError, isServerAnswer };
})();

// ---- src/mtproto/schema/generated.js ----
const __mod_src_mtproto_schema_generated = (() => {
// Generated by scripts/gen-schema.mjs from the layer-198 TL schema -- do not edit.
// Roots: updates.State, updates.Difference, updates.ChannelDifference, messages.Messages, Message, MessageMedia, Document, DocumentAttribute, Chat, User, Peer, Update, Updates, messages.Dialogs, auth.LoginToken, auth.Authorization, account.Password, auth.LoggedOut. 689 of 1396 constructors, 158 types.
const SCHEMA_LAYER = 198;
const SCHEMA_TYPES = ["InputPeer","InputUser","InputFile","InputMedia","InputGeoPoint","InputPhoto","Peer","User","UserProfilePhoto","UserStatus","Chat","ChatParticipant","ChatParticipants","ChatPhoto","Message","MessageMedia","MessageAction","Dialog","Photo","PhotoSize","GeoPoint","auth.Authorization","PeerNotifySettings","PeerSettings","WallPaper","messages.Dialogs","messages.Messages","Update","updates.State","updates.Difference","Updates","DcOption","EncryptedChat","EncryptedFile","EncryptedMessage","InputDocument","Document","NotifyPeer","SendMessageAction","PrivacyKey","PrivacyRule","DocumentAttribute","StickerPack","WebPage","account.Password","ExportedChatInvite","InputStickerSet","StickerSet","messages.StickerSet","BotCommand","KeyboardButton","KeyboardButtonRow","ReplyMarkup","MessageEntity","InputChannel","updates.ChannelDifference","ChannelParticipant","help.TermsOfService","MessageFwdHeader","InputBotInlineMessageID","DraftMessage","MaskCoords","Game","InputGame","RichText","PageBlock","PhoneCallDiscardReason","DataJSON","LabeledPrice","Invoice","PaymentCharge","PostAddress","PaymentRequestedInfo","WebDocument","InputWebDocument","PhoneCall","PhoneConnection","PhoneCallProtocol","LangPackString","LangPackDifference","DialogPeer","SecureFile","SecureData","SecurePlainData","SecureValueType","SecureValue","SecureCredentialsEncrypted","PasswordKdfAlgo","SecurePasswordKdfAlgo","PageTableCell","PageTableRow","PageCaption","PageListItem","PageListOrderedItem","PageRelatedArticle","Page","PollAnswer","Poll","PollAnswerVoters","PollResults","ChatAdminRights","ChatBannedRights","WallPaperSettings","Folder","FolderPeer","PeerLocated","RestrictionReason","Theme","auth.LoginToken","BaseTheme","ThemeSettings","WebPageAttribute","DialogFilter","VideoSize","MessageReplyHeader","MessageReplies","GroupCall","InputGroupCall","GroupCallParticipant","InlineQueryPeerType","GroupCallParticipantVideoSourceGroup","GroupCallParticipantVideo","auth.LoggedOut","ReactionCount","MessageReactions","MessagePeerReaction","BotMenuButton","NotificationSound","EmojiStatus","Reaction","MessageExtendedMedia","StickerKeyword","Username","ForumTopic","RequestPeerType","TextWithEntities","BotApp","StoryViews","StoryItem","InputReplyTo","StoriesStealthMode","MediaAreaCoordinates","MediaArea","Boost","StoryFwdHeader","PeerColor","QuickReply","BotBusinessConnection","RequestedPeer","BroadcastRevenueBalances","FactCheck","GeoPointAddress","StarsRevenueStatus","StarsSubscriptionPricing","MessageReactor","StarGift","StarsAmount","StarGiftAttribute"];
const SCHEMA_CTORS = "7f3b18ea inputPeerEmpty 0\n7da07ec9 inputPeerSelf 0\n35a95cb9 inputPeerChat 0 chat_id:l\ndde8a54c inputPeerUser 0 user_id:l access_hash:l\n27bcbbfc inputPeerChannel 0 channel_id:l access_hash:l\na87b0a1c inputPeerUserFromMessage 0 peer:0 msg_id:i user_id:l\nbd2a0840 inputPeerChannelFromMessage 0 peer:0 msg_id:i channel_id:l\nb98886cf inputUserEmpty 1\nf7c1b13f inputUserSelf 1\nf21158c6 inputUser 1 user_id:l access_hash:l\n1da448e2 inputUserFromMessage 1 peer:0 msg_id:i user_id:l\nf52ff27f inputFile 2 id:l parts:i name:s md5_checksum:s\nfa4f0bb5 inputFileBig 2 id:l parts:i name:s\n62dc8b48 inputFileStoryDocument 2 id:35\n9664f57f inputMediaEmpty 3\n1e287d04 inputMediaUploadedPhoto 3 flags:# spoiler:flags.2?t file:2 stickers:flags.0?V35 ttl_seconds:flags.1?i\nb3ba0635 inputMediaPhoto 3 flags:# spoiler:flags.1?t id:5 ttl_seconds:flags.0?i\nf9c44144 inputMediaGeoPoint 3 geo_point:4\nf8ab7dfb inputMediaContact 3 phone_number:s first_name:s last_name:s vcard:s\n37c9330 inputMediaUploadedDocument 3 flags:# nosound_video:flags.3?t force_file:flags.4?t spoiler:flags.5?t file:2 thumb:flags.2?2 mime_type:s attributes:V41 stickers:flags.0?V35 video_cover:flags.6?5 video_timestamp:flags.7?i ttl_seconds:flags.1?i\na8763ab5 inputMediaDocument 3 flags:# spoiler:flags.2?t id:35 video_cover:flags.3?5 video_timestamp:flags.4?i ttl_seconds:flags.0?i query:flags.1?s\nc13d1c11 inputMediaVenue 3 geo_point:4 title:s address:s provider:s venue_id:s venue_type:s\ne5bbfe1a inputMediaPhotoExternal 3 flags:# spoiler:flags.1?t url:s ttl_seconds:flags.0?i\n779600f9 inputMediaDocumentExternal 3 flags:# spoiler:flags.1?t url:s ttl_seconds:flags.0?i video_cover:flags.2?5 video_timestamp:flags.3?i\nd33f43f3 inputMediaGame 3 id:63\n405fef0d inputMediaInvoice 3 flags:# title:s description:s photo:flags.0?74 invoice:69 payload:b provider:flags.3?s provider_data:67 start_param:flags.1?s extended_media:flags.2?3\n971fa843 inputMediaGeoLive 3 flags:# stopped:flags.0?t geo_point:4 heading:flags.2?i period:flags.1?i proximity_notification_radius:flags.3?i\nf94e5f1 inputMediaPoll 3 flags:# poll:97 correct_answers:flags.0?Vb solution:flags.1?s solution_entities:flags.1?V53\ne66fbf7b inputMediaDice 3 emoticon:s\n89fdd778 inputMediaStory 3 peer:0 id:i\nc21b8849 inputMediaWebPage 3 flags:# force_large_media:flags.0?t force_small_media:flags.1?t optional:flags.2?t url:s\nc4103386 inputMediaPaidMedia 3 flags:# stars_amount:l extended_media:V3 payload:flags.0?s\ne4c123d6 inputGeoPointEmpty 4\n48222faf inputGeoPoint 4 flags:# lat:d long:d accuracy_radius:flags.0?i\n1cd7bf0d inputPhotoEmpty 5\n3bb3b94a inputPhoto 5 id:l access_hash:l file_reference:b\n59511722 peerUser 6 user_id:l\n36c6019a peerChat 6 chat_id:l\na2a5371e peerChannel 6 channel_id:l\nd3bc4b7a userEmpty 7 id:l\n4b46c37e user 7 flags:# self:flags.10?t contact:flags.11?t mutual_contact:flags.12?t deleted:flags.13?t bot:flags.14?t bot_chat_history:flags.15?t bot_nochats:flags.16?t verified:flags.17?t restricted:flags.18?t min:flags.20?t bot_inline_geo:flags.21?t support:flags.23?t scam:flags.24?t apply_min_photo:flags.25?t fake:flags.26?t bot_attach_menu:flags.27?t premium:flags.28?t attach_menu_enabled:flags.29?t flags2:# bot_can_edit:flags2.1?t close_friend:flags2.2?t stories_hidden:flags2.3?t stories_unavailable:flags2.4?t contact_require_premium:flags2.10?t bot_business:flags2.11?t bot_has_main_app:flags2.13?t id:l access_hash:flags.0?l first_name:flags.1?s last_name:flags.2?s username:flags.3?s phone:flags.4?s photo:flags.5?8 status:flags.6?9 bot_info_version:flags.14?i restriction_reason:flags.18?V106 bot_inline_placeholder:flags.19?s lang_code:flags.22?s emoji_status:flags.30?128 usernames:flags2.0?V132 stories_max_id:flags2.5?i color:flags2.8?145 profile_color:flags2.9?145 bot_active_users:flags2.12?i bot_verification_icon:flags2.14?l\n4f11bae1 userProfilePhotoEmpty 8\n82d1f706 userProfilePhoto 8 flags:# has_video:flags.0?t personal:flags.2?t photo_id:l stripped_thumb:flags.1?b dc_id:i\n9d05049 userStatusEmpty 9\nedb93949 userStatusOnline 9 expires:i\n8c703f userStatusOffline 9 was_online:i\n7b197dc8 userStatusRecently 9 flags:# by_me:flags.0?t\n541a1d1a userStatusLastWeek 9 flags:# by_me:flags.0?t\n65899777 userStatusLastMonth 9 flags:# by_me:flags.0?t\n29562865 chatEmpty 10 id:l\n41cbf256 chat 10 flags:# creator:flags.0?t left:flags.2?t deactivated:flags.5?t call_active:flags.23?t call_not_empty:flags.24?t noforwards:flags.25?t id:l title:s photo:13 participants_count:i date:i version:i migrated_to:flags.6?54 admin_rights:flags.14?100 default_banned_rights:flags.18?101\n6592a1a7 chatForbidden 10 id:l title:s\ne00998b7 channel 10 flags:# creator:flags.0?t left:flags.2?t broadcast:flags.5?t verified:flags.7?t megagroup:flags.8?t restricted:flags.9?t signatures:flags.11?t min:flags.12?t scam:flags.19?t has_link:flags.20?t has_geo:flags.21?t slowmode_enabled:flags.22?t call_active:flags.23?t call_not_empty:flags.24?t fake:flags.25?t gigagroup:flags.26?t noforwards:flags.27?t join_to_send:flags.28?t join_request:flags.29?t forum:flags.30?t flags2:# stories_hidden:flags2.1?t stories_hidden_min:flags2.2?t stories_unavailable:flags2.3?t signature_profiles:flags2.12?t id:l access_hash:flags.13?l title:s username:flags.6?s photo:13 date:i restriction_reason:flags.9?V106 admin_rights:flags.14?100 banned_rights:flags.15?101 default_banned_rights:flags.18?101 participants_count:flags.17?i usernames:flags2.0?V132 stories_max_id:flags2.4?i color:flags2.7?145 profile_color:flags2.8?145 emoji_status:flags2.9?128 level:flags2.10?i subscription_until_date:flags2.11?i bot_verification_icon:flags2.13?l\n17d493d5 channelForbidden 10 flags:# broadcast:flags.5?t megagroup:flags.8?t id:l access_hash:l title:s until_date:flags.16?i\nc02d4007 chatParticipant 11 user_id:l inviter_id:l date:i\ne46bcee4 chatParticipantCreator 11 user_id:l\na0933f5b chatParticipantAdmin 11 user_id:l inviter_id:l date:i\n8763d3e1 chatParticipantsForbidden 12 flags:# chat_id:l self_participant:flags.0?11\n3cbc93f8 chatParticipants 12 chat_id:l participants:V11 version:i\n37c1011c chatPhotoEmpty 13\n1c6e1c11 chatPhoto 13 flags:# has_video:flags.0?t photo_id:l stripped_thumb:flags.1?b dc_id:i\n90a6ca84 messageEmpty 14 flags:# id:i peer_id:flags.0?6\n96fdbbe9 message 14 flags:# out:flags.1?t mentioned:flags.4?t media_unread:flags.5?t silent:flags.13?t post:flags.14?t from_scheduled:flags.18?t legacy:flags.19?t edit_hide:flags.21?t pinned:flags.24?t noforwards:flags.26?t invert_media:flags.27?t flags2:# offline:flags2.1?t video_processing_pending:flags2.4?t id:i from_id:flags.8?6 from_boosts_applied:flags.29?i peer_id:6 saved_peer_id:flags.28?6 fwd_from:flags.2?58 via_bot_id:flags.11?l via_business_bot_id:flags2.0?l reply_to:flags.3?114 date:i message:s media:flags.9?15 reply_markup:flags.6?52 entities:flags.7?V53 views:flags.10?i forwards:flags.10?i replies:flags.23?115 edit_date:flags.15?i post_author:flags.16?s grouped_id:flags.17?l reactions:flags.20?124 restriction_reason:flags.22?V106 ttl_period:flags.25?i quick_reply_shortcut_id:flags.30?i effect:flags2.2?l factcheck:flags2.3?150 report_delivery_until_date:flags2.5?i\nd3d28540 messageService 14 flags:# out:flags.1?t mentioned:flags.4?t media_unread:flags.5?t reactions_are_possible:flags.9?t silent:flags.13?t post:flags.14?t legacy:flags.19?t id:i from_id:flags.8?6 peer_id:6 reply_to:flags.3?114 date:i action:16 reactions:flags.20?124 ttl_period:flags.25?i\n3ded6320 messageMediaEmpty 15\n695150d7 messageMediaPhoto 15 flags:# spoiler:flags.3?t photo:flags.0?18 ttl_seconds:flags.2?i\n56e0d474 messageMediaGeo 15 geo:20\n70322949 messageMediaContact 15 phone_number:s first_name:s last_name:s vcard:s user_id:l\n9f84f49e messageMediaUnsupported 15\n52d8ccd9 messageMediaDocument 15 flags:# nopremium:flags.3?t spoiler:flags.4?t video:flags.6?t round:flags.7?t voice:flags.8?t document:flags.0?36 alt_documents:flags.5?V36 video_cover:flags.9?18 video_timestamp:flags.10?i ttl_seconds:flags.2?i\nddf10c3b messageMediaWebPage 15 flags:# force_large_media:flags.0?t force_small_media:flags.1?t manual:flags.3?t safe:flags.4?t webpage:43\n2ec0533f messageMediaVenue 15 geo:20 title:s address:s provider:s venue_id:s venue_type:s\nfdb19008 messageMediaGame 15 game:62\nf6a548d3 messageMediaInvoice 15 flags:# shipping_address_requested:flags.1?t test:flags.3?t title:s description:s photo:flags.0?73 receipt_msg_id:flags.2?i currency:s total_amount:l start_param:s extended_media:flags.4?130\nb940c666 messageMediaGeoLive 15 flags:# geo:20 heading:flags.0?i period:i proximity_notification_radius:flags.1?i\n4bd6e798 messageMediaPoll 15 poll:97 results:99\n3f7ee58b messageMediaDice 15 value:i emoticon:s\n68cb6283 messageMediaStory 15 flags:# via_mention:flags.1?t peer:6 id:i story:flags.0?138\naa073beb messageMediaGiveaway 15 flags:# only_new_subscribers:flags.0?t winners_are_visible:flags.2?t channels:Vl countries_iso2:flags.1?Vs prize_description:flags.3?s quantity:i months:flags.4?i stars:flags.5?l until_date:i\nceaa3ea1 messageMediaGiveawayResults 15 flags:# only_new_subscribers:flags.0?t refunded:flags.2?t channel_id:l additional_peers_count:flags.3?i launch_msg_id:i winners_count:i unclaimed_count:i winners:Vl months:flags.4?i stars:flags.5?l prize_description:flags.1?s until_date:i\na8852491 messageMediaPaidMedia 15 stars_amount:l extended_media:V130\nb6aef7b0 messageActionEmpty 16\nbd47cbad messageActionChatCreate 16 title:s users:Vl\nb5a1ce5a messageActionChatEditTitle 16 title:s\n7fcb13a8 messageActionChatEditPhoto 16 photo:18\n95e3fbef messageActionChatDeletePhoto 16\n15cefd00 messageActionChatAddUser 16 users:Vl\na43f30cc messageActionChatDeleteUser 16 user_id:l\n31224c3 messageActionChatJoinedByLink 16 inviter_id:l\n95d2ac92 messageActionChannelCreate 16 title:s\ne1037f92 messageActionChatMigrateTo 16 channel_id:l\nea3948e9 messageActionChannelMigrateFrom 16 title:s chat_id:l\n94bd38ed messageActionPinMessage 16\n9fbab604 messageActionHistoryClear 16\n92a72876 messageActionGameScore 16 game_id:l score:i\nffa00ccc messageActionPaymentSentMe 16 flags:# recurring_init:flags.2?t recurring_used:flags.3?t currency:s total_amount:l payload:b info:flags.0?72 shipping_option_id:flags.1?s charge:70 subscription_until_date:flags.4?i\nc624b16e messageActionPaymentSent 16 flags:# recurring_init:flags.2?t recurring_used:flags.3?t currency:s total_amount:l invoice_slug:flags.0?s subscription_until_date:flags.4?i\n80e11a7f messageActionPhoneCall 16 flags:# video:flags.2?t call_id:l reason:flags.0?66 duration:flags.1?i\n4792929b messageActionScreenshotTaken 16\nfae69f56 messageActionCustomAction 16 message:s\nc516d679 messageActionBotAllowed 16 flags:# attach_menu:flags.1?t from_request:flags.3?t domain:flags.0?s app:flags.2?136\n1b287353 messageActionSecureValuesSentMe 16 values:V85 credentials:86\nd95c6154 messageActionSecureValuesSent 16 types:V84\nf3f25f76 messageActionContactSignUp 16\n98e0d697 messageActionGeoProximityReached 16 from_id:6 to_id:6 distance:i\n7a0d7f42 messageActionGroupCall 16 flags:# call:117 duration:flags.0?i\n502f92f7 messageActionInviteToGroupCall 16 call:117 users:Vl\n3c134d7b messageActionSetMessagesTTL 16 flags:# period:i auto_setting_from:flags.0?l\nb3a07661 messageActionGroupCallScheduled 16 call:117 schedule_date:i\naa786345 messageActionSetChatTheme 16 emoticon:s\nebbca3cb messageActionChatJoinedByRequest 16\n47dd8079 messageActionWebViewDataSentMe 16 text:s data:s\nb4c38cb5 messageActionWebViewDataSent 16 text:s\n6c6274fa messageActionGiftPremium 16 flags:# currency:s amount:l months:i crypto_currency:flags.0?s crypto_amount:flags.0?l message:flags.1?135\nd999256 messageActionTopicCreate 16 flags:# title:s icon_color:i icon_emoji_id:flags.0?l\nc0944820 messageActionTopicEdit 16 flags:# title:flags.0?s icon_emoji_id:flags.1?l closed:flags.2?B hidden:flags.3?B\n57de635e messageActionSuggestProfilePhoto 16 photo:18\n31518e9b messageActionRequestedPeer 16 button_id:i peers:V6\n5060a3f4 messageActionSetChatWallPaper 16 flags:# same:flags.0?t for_both:flags.1?t wallpaper:24\n56d03994 messageActionGiftCode 16 flags:# via_giveaway:flags.0?t unclaimed:flags.2?t boost_peer:flags.1?6 months:i slug:s currency:flags.2?s amount:flags.2?l crypto_currency:flags.3?s crypto_amount:flags.3?l message:flags.4?135\na80f51e4 messageActionGiveawayLaunch 16 flags:# stars:flags.0?l\n87e2f155 messageActionGiveawayResults 16 flags:# stars:flags.0?t winners_count:i unclaimed_count:i\ncc02aa6d messageActionBoostApply 16 boosts:i\n93b31848 messageActionRequestedPeerSentMe 16 button_id:i peers:V148\n41b3e202 messageActionPaymentRefunded 16 flags:# peer:6 currency:s total_amount:l payload:flags.0?b charge:70\n45d5b021 messageActionGiftStars 16 flags:# currency:s amount:l stars:l crypto_currency:flags.0?s crypto_amount:flags.0?l transaction_id:flags.1?s\nb00c47a2 messageActionPrizeStars 16 flags:# unclaimed:flags.0?t stars:l transaction_id:s boost_peer:6 giveaway_msg_id:i\n4717e8a4 messageActionStarGift 16 flags:# name_hidden:flags.0?t saved:flags.2?t converted:flags.3?t upgraded:flags.5?t refunded:flags.9?t can_upgrade:flags.10?t gift:155 message:flags.1?135 convert_stars:flags.4?l upgrade_msg_id:flags.5?i upgrade_stars:flags.8?l from_id:flags.11?6 peer:flags.12?6 saved_id:flags.12?l\nacdfcb81 messageActionStarGiftUnique 16 flags:# upgrade:flags.0?t transferred:flags.1?t saved:flags.2?t refunded:flags.5?t gift:155 can_export_at:flags.3?i transfer_stars:flags.4?l from_id:flags.6?6 peer:flags.7?6 saved_id:flags.7?l\nd58a08c6 dialog 17 flags:# pinned:flags.2?t unread_mark:flags.3?t view_forum_as_messages:flags.6?t peer:6 top_message:i read_inbox_max_id:i read_outbox_max_id:i unread_count:i unread_mentions_count:i unread_reactions_count:i notify_settings:22 pts:flags.0?i draft:flags.1?60 folder_id:flags.4?i ttl_period:flags.5?i\n71bd134c dialogFolder 17 flags:# pinned:flags.2?t folder:103 peer:6 top_message:i unread_muted_peers_count:i unread_unmuted_peers_count:i unread_muted_messages_count:i unread_unmuted_messages_count:i\n2331b22d photoEmpty 18 id:l\nfb197a65 photo 18 flags:# has_stickers:flags.0?t id:l access_hash:l file_reference:b date:i sizes:V19 video_sizes:flags.1?V113 dc_id:i\ne17e23c photoSizeEmpty 19 type:s\n75c78e60 photoSize 19 type:s w:i h:i size:i\n21e1ad6 photoCachedSize 19 type:s w:i h:i bytes:b\ne0b0bc2e photoStrippedSize 19 type:s bytes:b\nfa3efb95 photoSizeProgressive 19 type:s w:i h:i sizes:Vi\nd8214d41 photoPathSize 19 type:s bytes:b\n1117dd5f geoPointEmpty 20\nb2a2f663 geoPoint 20 flags:# long:d lat:d access_hash:l accuracy_radius:flags.0?i\n2ea2c0d4 auth.authorization 21 flags:# setup_password_required:flags.1?t otherwise_relogin_days:flags.1?i tmp_sessions:flags.0?i future_auth_token:flags.2?b user:7\n44747e9a auth.authorizationSignUpRequired 21 flags:# terms_of_service:flags.0?57\n99622c0c peerNotifySettings 22 flags:# show_previews:flags.0?B silent:flags.1?B mute_until:flags.2?i ios_sound:flags.3?127 android_sound:flags.4?127 other_sound:flags.5?127 stories_muted:flags.6?B stories_hide_sender:flags.7?B stories_ios_sound:flags.8?127 stories_android_sound:flags.9?127 stories_other_sound:flags.10?127\nacd66c5e peerSettings 23 flags:# report_spam:flags.0?t add_contact:flags.1?t block_contact:flags.2?t share_contact:flags.3?t need_contacts_exception:flags.4?t report_geo:flags.5?t autoarchived:flags.7?t invite_members:flags.8?t request_chat_broadcast:flags.10?t business_bot_paused:flags.11?t business_bot_can_reply:flags.12?t geo_distance:flags.6?i request_chat_title:flags.9?s request_chat_date:flags.9?i business_bot_id:flags.13?l business_bot_manage_url:flags.13?s\na437c3ed wallPaper 24 id:l flags:# creator:flags.0?t default:flags.1?t pattern:flags.3?t dark:flags.4?t access_hash:l slug:s document:36 settings:flags.2?102\ne0804116 wallPaperNoFile 24 id:l flags:# default:flags.1?t dark:flags.4?t settings:flags.2?102\n15ba6c40 messages.dialogs 25 dialogs:V17 messages:V14 chats:V10 users:V7\n71e094f3 messages.dialogsSlice 25 count:i dialogs:V17 messages:V14 chats:V10 users:V7\nf0e3e596 messages.dialogsNotModified 25 count:i\n8c718e87 messages.messages 26 messages:V14 chats:V10 users:V7\n3a54685e messages.messagesSlice 26 flags:# inexact:flags.1?t count:i next_rate:flags.0?i offset_id_offset:flags.2?i messages:V14 chats:V10 users:V7\nc776ba4e messages.channelMessages 26 flags:# inexact:flags.1?t pts:i count:i offset_id_offset:flags.2?i messages:V14 topics:V133 chats:V10 users:V7\n74535f21 messages.messagesNotModified 26 count:i\n1f2b0afd updateNewMessage 27 message:14 pts:i pts_count:i\n4e90bfd6 updateMessageID 27 id:i random_id:l\na20db0e5 updateDeleteMessages 27 messages:Vi pts:i pts_count:i\nc01e857f updateUserTyping 27 user_id:l action:38\n83487af0 updateChatUserTyping 27 chat_id:l from_id:6 action:38\n7761198 updateChatParticipants 27 participants:12\ne5bdf8de updateUserStatus 27 user_id:l status:9\na7848924 updateUserName 27 user_id:l first_name:s last_name:s usernames:V132\n8951abef updateNewAuthorization 27 flags:# unconfirmed:flags.0?t hash:l date:flags.0?i device:flags.0?s location:flags.0?s\n12bcbd9a updateNewEncryptedMessage 27 message:34 qts:i\n1710f156 updateEncryptedChatTyping 27 chat_id:i\nb4a2e88d updateEncryption 27 chat:32 date:i\n38fe25b7 updateEncryptedMessagesRead 27 chat_id:i max_date:i date:i\n3dda5451 updateChatParticipantAdd 27 chat_id:l user_id:l inviter_id:l date:i version:i\ne32f3d77 updateChatParticipantDelete 27 chat_id:l user_id:l version:i\n8e5e9873 updateDcOptions 27 dc_options:V31\nbec268ef updateNotifySettings 27 peer:37 notify_settings:22\nebe46819 updateServiceNotification 27 flags:# popup:flags.0?t invert_media:flags.2?t inbox_date:flags.1?i type:s message:s media:15 entities:V53\nee3b272a updatePrivacy 27 key:39 rules:V40\n5492a13 updateUserPhone 27 user_id:l phone:s\n9c974fdf updateReadHistoryInbox 27 flags:# folder_id:flags.0?i peer:6 max_id:i still_unread_count:i pts:i pts_count:i\n2f2f21bf updateReadHistoryOutbox 27 peer:6 max_id:i pts:i pts_count:i\n7f891213 updateWebPage 27 webpage:43 pts:i pts_count:i\nf8227181 updateReadMessagesContents 27 flags:# messages:Vi pts:i pts_count:i date:flags.0?i\n108d941f updateChannelTooLong 27 flags:# channel_id:l pts:flags.0?i\n635b4c09 updateChannel 27 channel_id:l\n62ba04d9 updateNewChannelMessage 27 message:14 pts:i pts_count:i\n922e6e10 updateReadChannelInbox 27 flags:# folder_id:flags.0?i channel_id:l max_id:i still_unread_count:i pts:i\nc32d5b12 updateDeleteChannelMessages 27 channel_id:l messages:Vi pts:i pts_count:i\nf226ac08 updateChannelMessageViews 27 channel_id:l id:i views:i\nd7ca61a2 updateChatParticipantAdmin 27 chat_id:l user_id:l is_admin:B version:i\n688a30aa updateNewStickerSet 27 stickerset:48\nbb2d201 updateStickerSetsOrder 27 flags:# masks:flags.0?t emojis:flags.1?t order:Vl\n31c24808 updateStickerSets 27 flags:# masks:flags.0?t emojis:flags.1?t\n9375341e updateSavedGifs 27\n496f379c updateBotInlineQuery 27 flags:# query_id:l user_id:l query:s geo:flags.0?20 peer_type:flags.1?119 offset:s\n12f12a07 updateBotInlineSend 27 flags:# user_id:l query:s geo:flags.0?20 id:s msg_id:flags.1?59\n1b3f4df7 updateEditChannelMessage 27 message:14 pts:i pts_count:i\nb9cfc48d updateBotCallbackQuery 27 flags:# query_id:l user_id:l peer:6 msg_id:i chat_instance:l data:flags.0?b game_short_name:flags.1?s\ne40370a3 updateEditMessage 27 message:14 pts:i pts_count:i\n691e9052 updateInlineBotCallbackQuery 27 flags:# query_id:l user_id:l msg_id:59 chat_instance:l data:flags.0?b game_short_name:flags.1?s\nb75f99a9 updateReadChannelOutbox 27 channel_id:l max_id:i\n1b49ec6d updateDraftMessage 27 flags:# peer:6 top_msg_id:flags.0?i draft:60\n571d2742 updateReadFeaturedStickers 27\n9a422c20 updateRecentStickers 27\na229dd06 updateConfig 27\n3354678f updatePtsChanged 27\n2f2ba99f updateChannelWebPage 27 channel_id:l webpage:43 pts:i pts_count:i\n6e6fe51c updateDialogPinned 27 flags:# pinned:flags.0?t folder_id:flags.1?i peer:80\nfa0f3ca2 updatePinnedDialogs 27 flags:# folder_id:flags.1?i order:flags.0?V80\n8317c0c3 updateBotWebhookJSON 27 data:67\n9b9240a6 updateBotWebhookJSONQuery 27 query_id:l data:67 timeout:i\nb5aefd7d updateBotShippingQuery 27 query_id:l user_id:l payload:b shipping_address:71\n8caa9a96 updateBotPrecheckoutQuery 27 flags:# query_id:l user_id:l payload:b info:flags.0?72 shipping_option_id:flags.1?s currency:s total_amount:l\nab0f6b1e updatePhoneCall 27 phone_call:75\n46560264 updateLangPackTooLong 27 lang_code:s\n56022f4d updateLangPack 27 difference:79\ne511996d updateFavedStickers 27\nea29055d updateChannelReadMessagesContents 27 flags:# channel_id:l top_msg_id:flags.0?i messages:Vi\n7084a7be updateContactsReset 27\nb23fc698 updateChannelAvailableMessages 27 channel_id:l available_min_id:i\ne16459c3 updateDialogUnreadMark 27 flags:# unread:flags.0?t peer:80\naca1657b updateMessagePoll 27 flags:# poll_id:l poll:flags.0?97 results:99\n54c01850 updateChatDefaultBannedRights 27 peer:6 default_banned_rights:101 version:i\n19360dc0 updateFolderPeers 27 folder_peers:V104 pts:i pts_count:i\n6a7e7366 updatePeerSettings 27 peer:6 settings:23\nb4afcfb0 updatePeerLocated 27 peers:V105\n39a51dfb updateNewScheduledMessage 27 message:14\nf2a71983 updateDeleteScheduledMessages 27 flags:# peer:6 messages:Vi sent_messages:flags.0?Vi\n8216fba3 updateTheme 27 theme:107\n871fb939 updateGeoLiveViewed 27 peer:6 msg_id:i\n564fe691 updateLoginToken 27\n24f40e77 updateMessagePollVote 27 poll_id:l peer:6 options:Vb qts:i\n26ffde7d updateDialogFilter 27 flags:# id:i filter:flags.0?112\na5d72105 updateDialogFilterOrder 27 order:Vi\n3504914f updateDialogFilters 27\n2661bf09 updatePhoneCallSignalingData 27 phone_call_id:l data:b\nd29a27f4 updateChannelMessageForwards 27 channel_id:l id:i forwards:i\nd6b19546 updateReadChannelDiscussionInbox 27 flags:# channel_id:l top_msg_id:i read_max_id:i broadcast_id:flags.0?l broadcast_post:flags.0?i\n695c9e7c updateReadChannelDiscussionOutbox 27 channel_id:l top_msg_id:i read_max_id:i\nebe07752 updatePeerBlocked 27 flags:# blocked:flags.0?t blocked_my_stories_from:flags.1?t peer_id:6\n8c88c923 updateChannelUserTyping 27 flags:# channel_id:l top_msg_id:flags.0?i from_id:6 action:38\ned85eab5 updatePinnedMessages 27 flags:# pinned:flags.0?t peer:6 messages:Vi pts:i pts_count:i\n5bb98608 updatePinnedChannelMessages 27 flags:# pinned:flags.0?t channel_id:l messages:Vi pts:i pts_count:i\nf89a6a4e updateChat 27 chat_id:l\nf2ebdb4e updateGroupCallParticipants 27 call:117 participants:V118 version:i\n97d64341 updateGroupCall 27 flags:# chat_id:flags.0?l call:116\nbb9bb9a5 updatePeerHistoryTTL 27 flags:# peer:6 ttl_period:flags.0?i\nd087663a updateChatParticipant 27 flags:# chat_id:l date:i actor_id:l user_id:l prev_participant:flags.0?11 new_participant:flags.1?11 invite:flags.2?45 qts:i\n985d3abb updateChannelParticipant 27 flags:# via_chatlist:flags.3?t channel_id:l date:i actor_id:l user_id:l prev_participant:flags.0?56 new_participant:flags.1?56 invite:flags.2?45 qts:i\nc4870a49 updateBotStopped 27 user_id:l date:i stopped:B qts:i\nb783982 updateGroupCallConnection 27 flags:# presentation:flags.0?t params:67\n4d712f2e updateBotCommands 27 peer:6 bot_id:l commands:V49\n7063c3db updatePendingJoinRequests 27 peer:6 requests_pending:i recent_requesters:Vl\n11dfa986 updateBotChatInviteRequester 27 peer:6 date:i user_id:l about:s invite:45 qts:i\n5e1b3cb8 updateMessageReactions 27 flags:# peer:6 msg_id:i top_msg_id:flags.0?i reactions:124\n17b7a20b updateAttachMenuBots 27\n1592b79d updateWebViewResultSent 27 query_id:l\n14b85813 updateBotMenuButton 27 bot_id:l button:126\n74d8be99 updateSavedRingtones 27\n84cd5a updateTranscribedAudio 27 flags:# pending:flags.0?t peer:6 msg_id:i transcription_id:l text:s\nfb4c496c updateReadFeaturedEmojiStickers 27\n28373599 updateUserEmojiStatus 27 user_id:l emoji_status:128\n30f443db updateRecentEmojiStatuses 27\n6f7863f4 updateRecentReactions 27\n86fccf85 updateMoveStickerSetToTop 27 flags:# masks:flags.0?t emojis:flags.1?t stickerset:l\nd5a41724 updateMessageExtendedMedia 27 peer:6 msg_id:i extended_media:V130\n192efbe3 updateChannelPinnedTopic 27 flags:# pinned:flags.0?t channel_id:l topic_id:i\nfe198602 updateChannelPinnedTopics 27 flags:# channel_id:l order:flags.0?Vi\n20529438 updateUser 27 user_id:l\nec05b097 updateAutoSaveSettings 27\n75b3b798 updateStory 27 peer:6 story:138\nf74e932b updateReadStories 27 peer:6 max_id:i\n1bf335b9 updateStoryID 27 id:i random_id:l\n2c084dc1 updateStoriesStealthMode 27 stealth_mode:140\n7d627683 updateSentStoryReaction 27 peer:6 story_id:i reaction:129\n904dd49c updateBotChatBoost 27 peer:6 boost:143 qts:i\n7b68920 updateChannelViewForumAsMessages 27 channel_id:l enabled:B\nae3f101d updatePeerWallpaper 27 flags:# wallpaper_overridden:flags.1?t peer:6 wallpaper:flags.0?24\nac21d3ce updateBotMessageReaction 27 peer:6 msg_id:i date:i actor:6 old_reactions:V129 new_reactions:V129 qts:i\n9cb7759 updateBotMessageReactions 27 peer:6 msg_id:i date:i reactions:V123 qts:i\naeaf9e74 updateSavedDialogPinned 27 flags:# pinned:flags.0?t peer:80\n686c85a6 updatePinnedSavedDialogs 27 flags:# order:flags.0?V80\n39c67432 updateSavedReactionTags 27\nf16269d4 updateSmsJob 27 job_id:s\nf9470ab2 updateQuickReplies 27 quick_replies:V146\nf53da717 updateNewQuickReply 27 quick_reply:146\n53e6f1ec updateDeleteQuickReply 27 shortcut_id:i\n3e050d0f updateQuickReplyMessage 27 message:14\n566fe7cd updateDeleteQuickReplyMessages 27 shortcut_id:i messages:Vi\n8ae5c97a updateBotBusinessConnect 27 connection:147 qts:i\n9ddb347c updateBotNewBusinessMessage 27 flags:# connection_id:s message:14 reply_to_message:flags.0?14 qts:i\n7df587c updateBotEditBusinessMessage 27 flags:# connection_id:s message:14 reply_to_message:flags.0?14 qts:i\na02a982e updateBotDeleteBusinessMessage 27 connection_id:s peer:6 messages:Vi qts:i\n1824e40b updateNewStoryReaction 27 story_id:i peer:6 reaction:129\ndfd961f5 updateBroadcastRevenueTransactions 27 peer:6 balances:149\n4e80a379 updateStarsBalance 27 balance:156\n1ea2fda7 updateBusinessBotCallbackQuery 27 flags:# query_id:l user_id:l connection_id:s message:14 reply_to_message:flags.2?14 chat_instance:l data:flags.0?b\na584b019 updateStarsRevenueStatus 27 peer:6 status:152\n283bd312 updateBotPurchasedPaidMedia 27 user_id:l payload:s qts:i\n51ca7aec updatePaidReactionPrivacy 27 private:B\na56c2a3e updates.state 28 pts:i qts:i date:i seq:i unread_count:i\n5d75a138 updates.differenceEmpty 29 date:i seq:i\nf49ca0 updates.difference 29 new_messages:V14 new_encrypted_messages:V34 other_updates:V27 chats:V10 users:V7 state:28\na8fb1981 updates.differenceSlice 29 new_messages:V14 new_encrypted_messages:V34 other_updates:V27 chats:V10 users:V7 intermediate_state:28\n4afe8f6d updates.differenceTooLong 29 pts:i\ne317af7e updatesTooLong 30\n313bc7f8 updateShortMessage 30 flags:# out:flags.1?t mentioned:flags.4?t media_unread:flags.5?t silent:flags.13?t id:i user_id:l message:s pts:i pts_count:i date:i fwd_from:flags.2?58 via_bot_id:flags.11?l reply_to:flags.3?114 entities:flags.7?V53 ttl_period:flags.25?i\n4d6deea5 updateShortChatMessage 30 flags:# out:flags.1?t mentioned:flags.4?t media_unread:flags.5?t silent:flags.13?t id:i from_id:l chat_id:l message:s pts:i pts_count:i date:i fwd_from:flags.2?58 via_bot_id:flags.11?l reply_to:flags.3?114 entities:flags.7?V53 ttl_period:flags.25?i\n78d4dec1 updateShort 30 update:27 date:i\n725b04c3 updatesCombined 30 updates:V27 users:V7 chats:V10 date:i seq_start:i seq:i\n74ae4240 updates 30 updates:V27 users:V7 chats:V10 date:i seq:i\n9015e101 updateShortSentMessage 30 flags:# out:flags.1?t id:i pts:i pts_count:i date:i media:flags.9?15 entities:flags.7?V53 ttl_period:flags.25?i\n18b7a10d dcOption 31 flags:# ipv6:flags.0?t media_only:flags.1?t tcpo_only:flags.2?t cdn:flags.3?t static:flags.4?t this_port_only:flags.5?t id:i ip_address:s port:i secret:flags.10?b\nab7ec0a0 encryptedChatEmpty 32 id:i\n66b25953 encryptedChatWaiting 32 id:i access_hash:l date:i admin_id:l participant_id:l\n48f1d94c encryptedChatRequested 32 flags:# folder_id:flags.0?i id:i access_hash:l date:i admin_id:l participant_id:l g_a:b\n61f0d4c7 encryptedChat 32 id:i access_hash:l date:i admin_id:l participant_id:l g_a_or_b:b key_fingerprint:l\n1e1c7c45 encryptedChatDiscarded 32 flags:# history_deleted:flags.0?t id:i\nc21f497e encryptedFileEmpty 33\na8008cd8 encryptedFile 33 id:l access_hash:l size:l dc_id:i key_fingerprint:i\ned18c118 encryptedMessage 34 random_id:l chat_id:i date:i bytes:b file:33\n23734b06 encryptedMessageService 34 random_id:l chat_id:i date:i bytes:b\n72f0eaae inputDocumentEmpty 35\n1abfb575 inputDocument 35 id:l access_hash:l file_reference:b\n36f8c871 documentEmpty 36 id:l\n8fd4c4d8 document 36 flags:# id:l access_hash:l file_reference:b date:i mime_type:s size:l thumbs:flags.0?V19 video_thumbs:flags.1?V113 dc_id:i attributes:V41\n9fd40bd8 notifyPeer 37 peer:6\nb4c83b4c notifyUsers 37\nc007cec3 notifyChats 37\nd612e8ef notifyBroadcasts 37\n226e6308 notifyForumTopic 37 peer:6 top_msg_id:i\n16bf744e sendMessageTypingAction 38\nfd5ec8f5 sendMessageCancelAction 38\na187d66f sendMessageRecordVideoAction 38\ne9763aec sendMessageUploadVideoAction 38 progress:i\nd52f73f7 sendMessageRecordAudioAction 38\nf351d7ab sendMessageUploadAudioAction 38 progress:i\nd1d34a26 sendMessageUploadPhotoAction 38 progress:i\naa0cd9e4 sendMessageUploadDocumentAction 38 progress:i\n176f8ba1 sendMessageGeoLocationAction 38\n628cbc6f sendMessageChooseContactAction 38\ndd6a8f48 sendMessageGamePlayAction 38\n88f27fbc sendMessageRecordRoundAction 38\n243e1c66 sendMessageUploadRoundAction 38 progress:i\nd92c2285 speakingInGroupCallAction 38\ndbda9246 sendMessageHistoryImportAction 38 progress:i\nb05ac6b1 sendMessageChooseStickerAction 38\n25972bcb sendMessageEmojiInteraction 38 emoticon:s msg_id:i interaction:67\nb665902e sendMessageEmojiInteractionSeen 38 emoticon:s\nbc2eab30 privacyKeyStatusTimestamp 39\n500e6dfa privacyKeyChatInvite 39\n3d662b7b privacyKeyPhoneCall 39\n39491cc8 privacyKeyPhoneP2P 39\n69ec56a3 privacyKeyForwards 39\n96151fed privacyKeyProfilePhoto 39\nd19ae46d privacyKeyPhoneNumber 39\n42ffd42b privacyKeyAddedByPhone 39\n697f414 privacyKeyVoiceMessages 39\na486b761 privacyKeyAbout 39\n2000a518 privacyKeyBirthday 39\n2ca4fdf8 privacyKeyStarGiftsAutoSave 39\nfffe1bac privacyValueAllowContacts 40\n65427b82 privacyValueAllowAll 40\nb8905fb2 privacyValueAllowUsers 40 users:Vl\nf888fa1a privacyValueDisallowContacts 40\n8b73e763 privacyValueDisallowAll 40\ne4621141 privacyValueDisallowUsers 40 users:Vl\n6b134e8e privacyValueAllowChatParticipants 40 chats:Vl\n41c87565 privacyValueDisallowChatParticipants 40 chats:Vl\nf7e8d89b privacyValueAllowCloseFriends 40\nece9814b privacyValueAllowPremium 40\n21461b5d privacyValueAllowBots 40\nf6a5f82f privacyValueDisallowBots 40\n6c37c15c documentAttributeImageSize 41 w:i h:i\n11b58939 documentAttributeAnimated 41\n6319d612 documentAttributeSticker 41 flags:# mask:flags.1?t alt:s stickerset:46 mask_coords:flags.0?61\n43c57c48 documentAttributeVideo 41 flags:# round_message:flags.0?t supports_streaming:flags.1?t nosound:flags.3?t duration:d w:i h:i preload_prefix_size:flags.2?i video_start_ts:flags.4?d video_codec:flags.5?s\n9852f9c6 documentAttributeAudio 41 flags:# voice:flags.10?t duration:i title:flags.0?s performer:flags.1?s waveform:flags.2?b\n15590068 documentAttributeFilename 41 file_name:s\n9801d2f7 documentAttributeHasStickers 41\nfd149899 documentAttributeCustomEmoji 41 flags:# free:flags.0?t text_color:flags.1?t alt:s stickerset:46\n12b299d4 stickerPack 42 emoticon:s documents:Vl\n211a1788 webPageEmpty 43 flags:# id:l url:flags.0?s\nb0d13e47 webPagePending 43 flags:# id:l url:flags.0?s date:i\ne89c45b2 webPage 43 flags:# has_large_media:flags.13?t id:l url:s display_url:s hash:i type:flags.0?s site_name:flags.1?s title:flags.2?s description:flags.3?s photo:flags.4?18 embed_url:flags.5?s embed_type:flags.5?s embed_width:flags.6?i embed_height:flags.6?i duration:flags.7?i author:flags.8?s document:flags.9?36 cached_page:flags.10?95 attributes:flags.12?V111\n7311ca11 webPageNotModified 43 flags:# cached_page_views:flags.0?i\n957b50fb account.password 44 flags:# has_recovery:flags.0?t has_secure_values:flags.1?t has_password:flags.2?t current_algo:flags.2?87 srp_B:flags.2?b srp_id:flags.2?l hint:flags.3?s email_unconfirmed_pattern:flags.4?s new_algo:87 new_secure_algo:88 secure_random:b pending_reset_date:flags.5?i login_email_pattern:flags.6?s\na22cbd96 chatInviteExported 45 flags:# revoked:flags.0?t permanent:flags.5?t request_needed:flags.6?t link:s admin_id:l date:i start_date:flags.4?i expire_date:flags.1?i usage_limit:flags.2?i usage:flags.3?i requested:flags.7?i subscription_expired:flags.10?i title:flags.8?s subscription_pricing:flags.9?153\ned107ab7 chatInvitePublicJoinRequests 45\nffb62b95 inputStickerSetEmpty 46\n9de7a269 inputStickerSetID 46 id:l access_hash:l\n861cc8a0 inputStickerSetShortName 46 short_name:s\n28703c8 inputStickerSetAnimatedEmoji 46\ne67f520e inputStickerSetDice 46 emoticon:s\ncde3739 inputStickerSetAnimatedEmojiAnimations 46\nc88b3b02 inputStickerSetPremiumGifts 46\n4c4d4ce inputStickerSetEmojiGenericAnimations 46\n29d0f5ee inputStickerSetEmojiDefaultStatuses 46\n44c1f8e9 inputStickerSetEmojiDefaultTopicIcons 46\n49748553 inputStickerSetEmojiChannelDefaultStatuses 46\n2dd14edc stickerSet 47 flags:# archived:flags.1?t official:flags.2?t masks:flags.3?t emojis:flags.7?t text_color:flags.9?t channel_emoji_status:flags.10?t creator:flags.11?t installed_date:flags.0?i id:l access_hash:l title:s short_name:s thumbs:flags.4?V19 thumb_dc_id:flags.4?i thumb_version:flags.4?i thumb_document_id:flags.8?l count:i hash:i\n6e153f16 messages.stickerSet 48 set:47 packs:V42 keywords:V131 documents:V36\nd3f924eb messages.stickerSetNotModified 48\nc27ac8c7 botCommand 49 command:s description:s\na2fa4880 keyboardButton 50 text:s\n258aff05 keyboardButtonUrl 50 text:s url:s\n35bbdb6b keyboardButtonCallback 50 flags:# requires_password:flags.0?t text:s data:b\nb16a6c29 keyboardButtonRequestPhone 50 text:s\nfc796b3f keyboardButtonRequestGeoLocation 50 text:s\n93b9fbb5 keyboardButtonSwitchInline 50 flags:# same_peer:flags.0?t text:s query:s peer_types:flags.1?V119\n50f41ccf keyboardButtonGame 50 text:s\nafd93fbb keyboardButtonBuy 50 text:s\n10b78d29 keyboardButtonUrlAuth 50 flags:# text:s fwd_text:flags.0?s url:s button_id:i\nd02e7fd4 inputKeyboardButtonUrlAuth 50 flags:# request_write_access:flags.0?t text:s fwd_text:flags.1?s url:s bot:1\nbbc7515d keyboardButtonRequestPoll 50 flags:# quiz:flags.0?B text:s\ne988037b inputKeyboardButtonUserProfile 50 text:s user_id:1\n308660c1 keyboardButtonUserProfile 50 text:s user_id:l\n13767230 keyboardButtonWebView 50 text:s url:s\na0c0505c keyboardButtonSimpleWebView 50 text:s url:s\n53d7bfd8 keyboardButtonRequestPeer 50 text:s button_id:i peer_type:134 max_quantity:i\nc9662d05 inputKeyboardButtonRequestPeer 50 flags:# name_requested:flags.0?t username_requested:flags.1?t photo_requested:flags.2?t text:s button_id:i peer_type:134 max_quantity:i\n75d2698e keyboardButtonCopy 50 text:s copy_text:s\n77608b83 keyboardButtonRow 51 buttons:V50\na03e5b85 replyKeyboardHide 52 flags:# selective:flags.2?t\n86b40b08 replyKeyboardForceReply 52 flags:# single_use:flags.1?t selective:flags.2?t placeholder:flags.3?s\n85dd99d1 replyKeyboardMarkup 52 flags:# resize:flags.0?t single_use:flags.1?t selective:flags.2?t persistent:flags.4?t rows:V51 placeholder:flags.3?s\n48a30254 replyInlineMarkup 52 rows:V51\nbb92ba95 messageEntityUnknown 53 offset:i length:i\nfa04579d messageEntityMention 53 offset:i length:i\n6f635b0d messageEntityHashtag 53 offset:i length:i\n6cef8ac7 messageEntityBotCommand 53 offset:i length:i\n6ed02538 messageEntityUrl 53 offset:i length:i\n64e475c2 messageEntityEmail 53 offset:i length:i\nbd610bc9 messageEntityBold 53 offset:i length:i\n826f8b60 messageEntityItalic 53 offset:i length:i\n28a20571 messageEntityCode 53 offset:i length:i\n73924be0 messageEntityPre 53 offset:i length:i language:s\n76a6d327 messageEntityTextUrl 53 offset:i length:i url:s\ndc7b1140 messageEntityMentionName 53 offset:i length:i user_id:l\n208e68c9 inputMessageEntityMentionName 53 offset:i length:i user_id:1\n9b69e34b messageEntityPhone 53 offset:i length:i\n4c4e743f messageEntityCashtag 53 offset:i length:i\n9c4e7e8b messageEntityUnderline 53 offset:i length:i\nbf0693d4 messageEntityStrike 53 offset:i length:i\n761e6af4 messageEntityBankCard 53 offset:i length:i\n32ca960f messageEntitySpoiler 53 offset:i length:i\nc8cf05f8 messageEntityCustomEmoji 53 offset:i length:i document_id:l\nf1ccaaac messageEntityBlockquote 53 flags:# collapsed:flags.0?t offset:i length:i\nee8c1e86 inputChannelEmpty 54\nf35aec28 inputChannel 54 channel_id:l access_hash:l\n5b934f9d inputChannelFromMessage 54 peer:0 msg_id:i channel_id:l\n3e11affb updates.channelDifferenceEmpty 55 flags:# final:flags.0?t pts:i timeout:flags.1?i\na4bcc6fe updates.channelDifferenceTooLong 55 flags:# final:flags.0?t timeout:flags.1?i dialog:17 messages:V14 chats:V10 users:V7\n2064674e updates.channelDifference 55 flags:# final:flags.0?t pts:i timeout:flags.1?i new_messages:V14 other_updates:V27 chats:V10 users:V7\ncb397619 channelParticipant 56 flags:# user_id:l date:i subscription_until_date:flags.0?i\n4f607bef channelParticipantSelf 56 flags:# via_request:flags.0?t user_id:l inviter_id:l date:i subscription_until_date:flags.1?i\n2fe601d3 channelParticipantCreator 56 flags:# user_id:l admin_rights:100 rank:flags.0?s\n34c3bb53 channelParticipantAdmin 56 flags:# can_edit:flags.0?t self:flags.1?t user_id:l inviter_id:flags.1?l promoted_by:l date:i admin_rights:100 rank:flags.2?s\n6df8014e channelParticipantBanned 56 flags:# left:flags.0?t peer:6 kicked_by:l date:i banned_rights:101\n1b03f006 channelParticipantLeft 56 peer:6\n780a0310 help.termsOfService 57 flags:# popup:flags.0?t id:67 text:s entities:V53 min_age_confirm:flags.1?i\n4e4df4bb messageFwdHeader 58 flags:# imported:flags.7?t saved_out:flags.11?t from_id:flags.0?6 from_name:flags.5?s date:i channel_post:flags.2?i post_author:flags.3?s saved_from_peer:flags.4?6 saved_from_msg_id:flags.4?i saved_from_id:flags.8?6 saved_from_name:flags.9?s saved_date:flags.10?i psa_type:flags.6?s\n890c3d89 inputBotInlineMessageID 59 dc_id:i id:l access_hash:l\nb6d915d7 inputBotInlineMessageID64 59 dc_id:i owner_id:l id:i access_hash:l\n1b0c841a draftMessageEmpty 60 flags:# date:flags.0?i\n2d65321f draftMessage 60 flags:# no_webpage:flags.1?t invert_media:flags.6?t reply_to:flags.4?139 message:s entities:flags.3?V53 media:flags.5?3 date:i effect:flags.7?l\naed6dbb2 maskCoords 61 n:i x:d y:d zoom:d\nbdf9653b game 62 flags:# id:l access_hash:l short_name:s title:s description:s photo:18 document:flags.0?36\n32c3e77 inputGameID 63 id:l access_hash:l\nc331e80a inputGameShortName 63 bot_id:1 short_name:s\ndc3d824f textEmpty 64\n744694e0 textPlain 64 text:s\n6724abc4 textBold 64 text:64\nd912a59c textItalic 64 text:64\nc12622c4 textUnderline 64 text:64\n9bf8bb95 textStrike 64 text:64\n6c3f19b9 textFixed 64 text:64\n3c2884c1 textUrl 64 text:64 url:s webpage_id:l\nde5a0dd6 textEmail 64 text:64 email:s\n7e6260d7 textConcat 64 texts:V64\ned6a8504 textSubscript 64 text:64\nc7fb5e01 textSuperscript 64 text:64\n34b8621 textMarked 64 text:64\n1ccb966a textPhone 64 text:64 phone:s\n81ccf4f textImage 64 document_id:l w:i h:i\n35553762 textAnchor 64 text:64 name:s\n13567e8a pageBlockUnsupported 65\n70abc3fd pageBlockTitle 65 text:64\n8ffa9a1f pageBlockSubtitle 65 text:64\nbaafe5e0 pageBlockAuthorDate 65 author:64 published_date:i\nbfd064ec pageBlockHeader 65 text:64\nf12bb6e1 pageBlockSubheader 65 text:64\n467a0766 pageBlockParagraph 65 text:64\nc070d93e pageBlockPreformatted 65 text:64 language:s\n48870999 pageBlockFooter 65 text:64\ndb20b188 pageBlockDivider 65\nce0d37b0 pageBlockAnchor 65 name:s\ne4e88011 pageBlockList 65 items:V92\n263d7c26 pageBlockBlockquote 65 text:64 caption:64\n4f4456d3 pageBlockPullquote 65 text:64 caption:64\n1759c560 pageBlockPhoto 65 flags:# photo_id:l caption:91 url:flags.0?s webpage_id:flags.0?l\n7c8fe7b6 pageBlockVideo 65 flags:# autoplay:flags.0?t loop:flags.1?t video_id:l caption:91\n39f23300 pageBlockCover 65 cover:65\na8718dc5 pageBlockEmbed 65 flags:# full_width:flags.0?t allow_scrolling:flags.3?t url:flags.1?s html:flags.2?s poster_photo_id:flags.4?l w:flags.5?i h:flags.5?i caption:91\nf259a80b pageBlockEmbedPost 65 url:s webpage_id:l author_photo_id:l author:s date:i blocks:V65 caption:91\n65a0fa4d pageBlockCollage 65 items:V65 caption:91\n31f9590 pageBlockSlideshow 65 items:V65 caption:91\nef1751b5 pageBlockChannel 65 channel:10\n804361ea pageBlockAudio 65 audio_id:l caption:91\n1e148390 pageBlockKicker 65 text:64\nbf4dea82 pageBlockTable 65 flags:# bordered:flags.0?t striped:flags.1?t title:64 rows:V90\n9a8ae1e1 pageBlockOrderedList 65 items:V93\n76768bed pageBlockDetails 65 flags:# open:flags.0?t blocks:V65 title:64\n16115a96 pageBlockRelatedArticles 65 title:64 articles:V94\na44f3ef6 pageBlockMap 65 geo:20 zoom:i w:i h:i caption:91\n85e42301 phoneCallDiscardReasonMissed 66\ne095c1a0 phoneCallDiscardReasonDisconnect 66\n57adc690 phoneCallDiscardReasonHangup 66\nfaf7e8c9 phoneCallDiscardReasonBusy 66\nafe2b839 phoneCallDiscardReasonAllowGroupCall 66 encrypted_key:b\n7d748d04 dataJSON 67 data:s\ncb296bf8 labeledPrice 68 label:s amount:l\n49ee584 invoice 69 flags:# test:flags.0?t name_requested:flags.1?t phone_requested:flags.2?t email_requested:flags.3?t shipping_address_requested:flags.4?t flexible:flags.5?t phone_to_provider:flags.6?t email_to_provider:flags.7?t recurring:flags.9?t currency:s prices:V68 max_tip_amount:flags.8?l suggested_tip_amounts:flags.8?Vl terms_url:flags.10?s subscription_period:flags.11?i\nea02c27e paymentCharge 70 id:s provider_charge_id:s\n1e8caaeb postAddress 71 street_line1:s street_line2:s city:s state:s country_iso2:s post_code:s\n909c3f94 paymentRequestedInfo 72 flags:# name:flags.0?s phone:flags.1?s email:flags.2?s shipping_address:flags.3?71\n1c570ed1 webDocument 73 url:s access_hash:l size:i mime_type:s attributes:V41\nf9c8bcc6 webDocumentNoProxy 73 url:s size:i mime_type:s attributes:V41\n9bed434d inputWebDocument 74 url:s size:i mime_type:s attributes:V41\n5366c915 phoneCallEmpty 75 id:l\need42858 phoneCallWaiting 75 flags:# video:flags.6?t id:l access_hash:l date:i admin_id:l participant_id:l protocol:77 receive_date:flags.0?i conference_call:flags.8?117\n45361c63 phoneCallRequested 75 flags:# video:flags.6?t id:l access_hash:l date:i admin_id:l participant_id:l g_a_hash:b protocol:77 conference_call:flags.8?117\n22fd7181 phoneCallAccepted 75 flags:# video:flags.6?t id:l access_hash:l date:i admin_id:l participant_id:l g_b:b protocol:77 conference_call:flags.8?117\n3ba5940c phoneCall 75 flags:# p2p_allowed:flags.5?t video:flags.6?t id:l access_hash:l date:i admin_id:l participant_id:l g_a_or_b:b key_fingerprint:l protocol:77 connections:V76 start_date:i custom_parameters:flags.7?67 conference_call:flags.8?117\nf9d25503 phoneCallDiscarded 75 flags:# need_rating:flags.2?t need_debug:flags.3?t video:flags.6?t id:l reason:flags.0?66 duration:flags.1?i conference_call:flags.8?117\n9cc123c7 phoneConnection 76 flags:# tcp:flags.0?t id:l ip:s ipv6:s port:i peer_tag:b\n635fe375 phoneConnectionWebrtc 76 flags:# turn:flags.0?t stun:flags.1?t id:l ip:s ipv6:s port:i username:s password:s\nfc878fc8 phoneCallProtocol 77 flags:# udp_p2p:flags.0?t udp_reflector:flags.1?t min_layer:i max_layer:i library_versions:Vs\ncad181f6 langPackString 78 key:s value:s\n6c47ac9f langPackStringPluralized 78 flags:# key:s zero_value:flags.0?s one_value:flags.1?s two_value:flags.2?s few_value:flags.3?s many_value:flags.4?s other_value:s\n2979eeb2 langPackStringDeleted 78 key:s\nf385c1f6 langPackDifference 79 lang_code:s from_version:i version:i strings:V78\ne56dbf05 dialogPeer 80 peer:6\n514519e2 dialogPeerFolder 80 folder_id:i\n64199744 secureFileEmpty 81\n7d09c27e secureFile 81 id:l access_hash:l size:l dc_id:i date:i file_hash:b secret:b\n8aeabec3 secureData 82 data:b data_hash:b secret:b\n7d6099dd securePlainPhone 83 phone:s\n21ec5a5f securePlainEmail 83 email:s\n9d2a81e3 secureValueTypePersonalDetails 84\n3dac6a00 secureValueTypePassport 84\n6e425c4 secureValueTypeDriverLicense 84\na0d0744b secureValueTypeIdentityCard 84\n99a48f23 secureValueTypeInternalPassport 84\ncbe31e26 secureValueTypeAddress 84\nfc36954e secureValueTypeUtilityBill 84\n89137c0d secureValueTypeBankStatement 84\n8b883488 secureValueTypeRentalAgreement 84\n99e3806a secureValueTypePassportRegistration 84\nea02ec33 secureValueTypeTemporaryRegistration 84\nb320aadb secureValueTypePhone 84\n8e3ca7ee secureValueTypeEmail 84\n187fa0ca secureValue 85 flags:# type:84 data:flags.0?82 front_side:flags.1?81 reverse_side:flags.2?81 selfie:flags.3?81 translation:flags.6?V81 files:flags.4?V81 plain_data:flags.5?83 hash:b\n33f0ea47 secureCredentialsEncrypted 86 data:b hash:b secret:b\nd45ab096 passwordKdfAlgoUnknown 87\n3a912d4a passwordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow 87 salt1:b salt2:b g:i p:b\n4a8537 securePasswordKdfAlgoUnknown 88\nbbf2dda0 securePasswordKdfAlgoPBKDF2HMACSHA512iter100000 88 salt:b\n86471d92 securePasswordKdfAlgoSHA512 88 salt:b\n34566b6a pageTableCell 89 flags:# header:flags.0?t align_center:flags.3?t align_right:flags.4?t valign_middle:flags.5?t valign_bottom:flags.6?t text:flags.7?64 colspan:flags.1?i rowspan:flags.2?i\ne0c0c5e5 pageTableRow 90 cells:V89\n6f747657 pageCaption 91 text:64 credit:64\nb92fb6cd pageListItemText 92 text:64\n25e073fc pageListItemBlocks 92 blocks:V65\n5e068047 pageListOrderedItemText 93 num:s text:64\n98dd8936 pageListOrderedItemBlocks 93 num:s blocks:V65\nb390dc08 pageRelatedArticle 94 flags:# url:s webpage_id:l title:flags.0?s description:flags.1?s photo_id:flags.2?l author:flags.3?s published_date:flags.4?i\n98657f0d page 95 flags:# part:flags.0?t rtl:flags.1?t v2:flags.2?t url:s blocks:V65 photos:V18 documents:V36 views:flags.3?i\nff16e2ca pollAnswer 96 text:135 option:b\n58747131 poll 97 id:l flags:# closed:flags.0?t public_voters:flags.1?t multiple_choice:flags.2?t quiz:flags.3?t question:135 answers:V96 close_period:flags.4?i close_date:flags.5?i\n3b6ddad2 pollAnswerVoters 98 flags:# chosen:flags.0?t correct:flags.1?t option:b voters:i\n7adf2420 pollResults 99 flags:# min:flags.0?t results:flags.1?V98 total_voters:flags.2?i recent_voters:flags.3?V6 solution:flags.4?s solution_entities:flags.4?V53\n5fb224d5 chatAdminRights 100 flags:# change_info:flags.0?t post_messages:flags.1?t edit_messages:flags.2?t delete_messages:flags.3?t ban_users:flags.4?t invite_users:flags.5?t pin_messages:flags.7?t add_admins:flags.9?t anonymous:flags.10?t manage_call:flags.11?t other:flags.12?t manage_topics:flags.13?t post_stories:flags.14?t edit_stories:flags.15?t delete_stories:flags.16?t\n9f120418 chatBannedRights 101 flags:# view_messages:flags.0?t send_messages:flags.1?t send_media:flags.2?t send_stickers:flags.3?t send_gifs:flags.4?t send_games:flags.5?t send_inline:flags.6?t embed_links:flags.7?t send_polls:flags.8?t change_info:flags.10?t invite_users:flags.15?t pin_messages:flags.17?t manage_topics:flags.18?t send_photos:flags.19?t send_videos:flags.20?t send_roundvideos:flags.21?t send_audios:flags.22?t send_voices:flags.23?t send_docs:flags.24?t send_plain:flags.25?t until_date:i\n372efcd0 wallPaperSettings 102 flags:# blur:flags.1?t motion:flags.2?t background_color:flags.0?i second_background_color:flags.4?i third_background_color:flags.5?i fourth_background_color:flags.6?i intensity:flags.3?i rotation:flags.4?i emoticon:flags.7?s\nff544e65 folder 103 flags:# autofill_new_broadcasts:flags.0?t autofill_public_groups:flags.1?t autofill_new_correspondents:flags.2?t id:i title:s photo:flags.3?13\ne9baa668 folderPeer 104 peer:6 folder_id:i\nca461b5d peerLocated 105 peer:6 expires:i distance:i\nf8ec284b peerSelfLocated 105 expires:i\nd072acb4 restrictionReason 106 platform:s reason:s text:s\na00e67d6 theme 107 flags:# creator:flags.0?t default:flags.1?t for_chat:flags.5?t id:l access_hash:l slug:s title:s document:flags.2?36 settings:flags.3?V110 emoticon:flags.6?s installs_count:flags.4?i\n629f1980 auth.loginToken 108 expires:i token:b\n68e9916 auth.loginTokenMigrateTo 108 dc_id:i token:b\n390d5c5e auth.loginTokenSuccess 108 authorization:21\nc3a12462 baseThemeClassic 109\nfbd81688 baseThemeDay 109\nb7b31ea8 baseThemeNight 109\n6d5f77ee baseThemeTinted 109\n5b11125a baseThemeArctic 109\nfa58b6d4 themeSettings 110 flags:# message_colors_animated:flags.2?t base_theme:109 accent_color:i outbox_accent_color:flags.3?i message_colors:flags.0?Vi wallpaper:flags.1?24\n54b56617 webPageAttributeTheme 111 flags:# documents:flags.0?V36 settings:flags.1?110\n2e94c3e7 webPageAttributeStory 111 flags:# peer:6 id:i story:flags.0?138\n50cc03d3 webPageAttributeStickerSet 111 flags:# emojis:flags.0?t text_color:flags.1?t stickers:V36\ncf6f6db8 webPageAttributeUniqueStarGift 111 gift:155\naa472651 dialogFilter 112 flags:# contacts:flags.0?t non_contacts:flags.1?t groups:flags.2?t broadcasts:flags.3?t bots:flags.4?t exclude_muted:flags.11?t exclude_read:flags.12?t exclude_archived:flags.13?t title_noanimate:flags.28?t id:i title:135 emoticon:flags.25?s color:flags.27?i pinned_peers:V0 include_peers:V0 exclude_peers:V0\n363293ae dialogFilterDefault 112\n96537bd7 dialogFilterChatlist 112 flags:# has_my_invites:flags.26?t title_noanimate:flags.28?t id:i title:135 emoticon:flags.25?s color:flags.27?i pinned_peers:V0 include_peers:V0\nde33b094 videoSize 113 flags:# type:s w:i h:i size:i video_start_ts:flags.0?d\nf85c413c videoSizeEmojiMarkup 113 emoji_id:l background_colors:Vi\nda082fe videoSizeStickerMarkup 113 stickerset:46 sticker_id:l background_colors:Vi\nafbc09db messageReplyHeader 114 flags:# reply_to_scheduled:flags.2?t forum_topic:flags.3?t quote:flags.9?t reply_to_msg_id:flags.4?i reply_to_peer_id:flags.0?6 reply_from:flags.5?58 reply_media:flags.8?15 reply_to_top_id:flags.1?i quote_text:flags.6?s quote_entities:flags.7?V53 quote_offset:flags.10?i\ne5af939 messageReplyStoryHeader 114 peer:6 story_id:i\n83d60fc2 messageReplies 115 flags:# comments:flags.0?t replies:i replies_pts:i recent_repliers:flags.1?V6 channel_id:flags.0?l max_id:flags.2?i read_max_id:flags.3?i\n7780bcb4 groupCallDiscarded 116 id:l access_hash:l duration:i\ncdf8d3e3 groupCall 116 flags:# join_muted:flags.1?t can_change_join_muted:flags.2?t join_date_asc:flags.6?t schedule_start_subscribed:flags.8?t can_start_video:flags.9?t record_video_active:flags.11?t rtmp_stream:flags.12?t listeners_hidden:flags.13?t id:l access_hash:l participants_count:i title:flags.3?s stream_dc_id:flags.4?i record_start_date:flags.5?i schedule_date:flags.7?i unmuted_video_count:flags.10?i unmuted_video_limit:i version:i conference_from_call:flags.14?l\nd8aa840f inputGroupCall 117 id:l access_hash:l\neba636fe groupCallParticipant 118 flags:# muted:flags.0?t left:flags.1?t can_self_unmute:flags.2?t just_joined:flags.4?t versioned:flags.5?t min:flags.8?t muted_by_you:flags.9?t volume_by_admin:flags.10?t self:flags.12?t video_joined:flags.15?t peer:6 date:i active_date:flags.3?i source:i volume:flags.7?i about:flags.11?s raise_hand_rating:flags.13?l video:flags.6?121 presentation:flags.14?121\n3081ed9d inlineQueryPeerTypeSameBotPM 119\n833c0fac inlineQueryPeerTypePM 119\nd766c50a inlineQueryPeerTypeChat 119\n5ec4be43 inlineQueryPeerTypeMegagroup 119\n6334ee9a inlineQueryPeerTypeBroadcast 119\ne3b2d0c inlineQueryPeerTypeBotPM 119\ndcb118b7 groupCallParticipantVideoSourceGroup 120 semantics:s sources:Vi\n67753ac8 groupCallParticipantVideo 121 flags:# paused:flags.0?t endpoint:s source_groups:V120 audio_source:flags.1?i\nc3a2835f auth.loggedOut 122 flags:# future_auth_token:flags.0?b\na3d1cb80 reactionCount 123 flags:# chosen_order:flags.0?i reaction:129 count:i\na339f0b messageReactions 124 flags:# min:flags.0?t can_see_list:flags.2?t reactions_as_tags:flags.3?t results:V123 recent_reactions:flags.1?V125 top_reactors:flags.4?V154\n8c79b63c messagePeerReaction 125 flags:# big:flags.0?t unread:flags.1?t my:flags.2?t peer_id:6 date:i reaction:129\n7533a588 botMenuButtonDefault 126\n4258c205 botMenuButtonCommands 126\nc7b57ce6 botMenuButton 126 text:s url:s\n97e8bebe notificationSoundDefault 127\n6f0c34df notificationSoundNone 127\n830b9ae4 notificationSoundLocal 127 title:s data:s\nff6c8049 notificationSoundRingtone 127 id:l\n2de11aae emojiStatusEmpty 128\ne7ff068a emojiStatus 128 flags:# document_id:l until:flags.0?i\n7184603b emojiStatusCollectible 128 flags:# collectible_id:l document_id:l title:s slug:s pattern_document_id:l center_color:i edge_color:i pattern_color:i text_color:i until:flags.0?i\n7141dbf inputEmojiStatusCollectible 128 flags:# collectible_id:l until:flags.0?i\n79f5d419 reactionEmpty 129\n1b2286b8 reactionEmoji 129 emoticon:s\n8935fc73 reactionCustomEmoji 129 document_id:l\n523da4eb reactionPaid 129\nad628cc8 messageExtendedMediaPreview 130 flags:# w:flags.0?i h:flags.0?i thumb:flags.1?19 video_duration:flags.2?i\nee479c64 messageExtendedMedia 130 media:15\nfcfeb29c stickerKeyword 131 document_id:l keyword:Vs\nb4073647 username 132 flags:# editable:flags.0?t active:flags.1?t username:s\n23f109b forumTopicDeleted 133 id:i\n71701da9 forumTopic 133 flags:# my:flags.1?t closed:flags.2?t pinned:flags.3?t short:flags.5?t hidden:flags.6?t id:i date:i title:s icon_color:i icon_emoji_id:flags.0?l top_message:i read_inbox_max_id:i read_outbox_max_id:i unread_count:i unread_mentions_count:i unread_reactions_count:i from_id:6 notify_settings:22 draft:flags.4?60\n5f3b8a00 requestPeerTypeUser 134 flags:# bot:flags.0?B premium:flags.1?B\nc9f06e1b requestPeerTypeChat 134 flags:# creator:flags.0?t bot_participant:flags.5?t has_username:flags.3?B forum:flags.4?B user_admin_rights:flags.1?100 bot_admin_rights:flags.2?100\n339bef6c requestPeerTypeBroadcast 134 flags:# creator:flags.0?t has_username:flags.3?B user_admin_rights:flags.1?100 bot_admin_rights:flags.2?100\n751f3146 textWithEntities 135 text:s entities:V53\n5da674b7 botAppNotModified 136\n95fcd1d6 botApp 136 flags:# id:l access_hash:l short_name:s title:s description:s photo:18 document:flags.0?36 hash:l\n8d595cd6 storyViews 137 flags:# has_viewers:flags.1?t views_count:i forwards_count:flags.2?i reactions:flags.3?V123 reactions_count:flags.4?i recent_viewers:flags.0?Vl\n51e6ee4f storyItemDeleted 138 id:i\nffadc913 storyItemSkipped 138 flags:# close_friends:flags.8?t id:i date:i expire_date:i\n79b26a24 storyItem 138 flags:# pinned:flags.5?t public:flags.7?t close_friends:flags.8?t min:flags.9?t noforwards:flags.10?t edited:flags.11?t contacts:flags.12?t selected_contacts:flags.13?t out:flags.16?t id:i date:i from_id:flags.18?6 fwd_from:flags.17?144 expire_date:i caption:flags.0?s entities:flags.1?V53 media:15 media_areas:flags.14?V142 privacy:flags.2?V40 views:flags.3?137 sent_reaction:flags.15?129\n22c0f6d5 inputReplyToMessage 139 flags:# reply_to_msg_id:i top_msg_id:flags.0?i reply_to_peer_id:flags.1?0 quote_text:flags.2?s quote_entities:flags.3?V53 quote_offset:flags.4?i\n5881323a inputReplyToStory 139 peer:0 story_id:i\n712e27fd storiesStealthMode 140 flags:# active_until_date:flags.0?i cooldown_until_date:flags.1?i\ncfc9e002 mediaAreaCoordinates 141 flags:# x:d y:d w:d h:d rotation:d radius:flags.0?d\nbe82db9c mediaAreaVenue 142 coordinates:141 geo:20 title:s address:s provider:s venue_id:s venue_type:s\nb282217f inputMediaAreaVenue 142 coordinates:141 query_id:l result_id:s\ncad5452d mediaAreaGeoPoint 142 flags:# coordinates:141 geo:20 address:flags.0?151\n14455871 mediaAreaSuggestedReaction 142 flags:# dark:flags.0?t flipped:flags.1?t coordinates:141 reaction:129\n770416af mediaAreaChannelPost 142 coordinates:141 channel_id:l msg_id:i\n2271f2bf inputMediaAreaChannelPost 142 coordinates:141 channel:54 msg_id:i\n37381085 mediaAreaUrl 142 coordinates:141 url:s\n49a6549c mediaAreaWeather 142 coordinates:141 emoji:s temperature_c:d color:i\n5787686d mediaAreaStarGift 142 coordinates:141 slug:s\n4b3e14d6 boost 143 flags:# gift:flags.1?t giveaway:flags.2?t unclaimed:flags.3?t id:s user_id:flags.0?l giveaway_msg_id:flags.2?i date:i expires:i used_gift_slug:flags.4?s multiplier:flags.5?i stars:flags.6?l\nb826e150 storyFwdHeader 144 flags:# modified:flags.3?t from:flags.0?6 from_name:flags.1?s story_id:flags.2?i\nb54b5acf peerColor 145 flags:# color:flags.0?i background_emoji_id:flags.1?l\n697102b quickReply 146 shortcut_id:i shortcut:s top_message:i count:i\n896433b4 botBusinessConnection 147 flags:# can_reply:flags.0?t disabled:flags.1?t connection_id:s user_id:l dc_id:i date:i\nd62ff46a requestedPeerUser 148 flags:# user_id:l first_name:flags.0?s last_name:flags.0?s username:flags.1?s photo:flags.2?18\n7307544f requestedPeerChat 148 flags:# chat_id:l title:flags.0?s photo:flags.2?18\n8ba403e4 requestedPeerChannel 148 flags:# channel_id:l title:flags.0?s username:flags.1?s photo:flags.2?18\nc3ff71e7 broadcastRevenueBalances 149 flags:# withdrawal_enabled:flags.0?t current_balance:l available_balance:l overall_revenue:l\nb89bfccf factCheck 150 flags:# need_check:flags.0?t country:flags.1?s text:flags.1?135 hash:l\nde4c5d93 geoPointAddress 151 flags:# country_iso2:s state:flags.0?s city:flags.1?s street:flags.2?s\nfebe5491 starsRevenueStatus 152 flags:# withdrawal_enabled:flags.0?t current_balance:156 available_balance:156 overall_revenue:156 next_withdrawal_at:flags.1?i\n5416d58 starsSubscriptionPricing 153 period:i amount:l\n4ba3a95a messageReactor 154 flags:# top:flags.0?t my:flags.1?t anonymous:flags.2?t peer_id:flags.3?6 count:i\n2cc73c8 starGift 155 flags:# limited:flags.0?t sold_out:flags.1?t birthday:flags.2?t id:l sticker:36 stars:l availability_remains:flags.0?i availability_total:flags.0?i convert_stars:l first_sale_date:flags.1?i last_sale_date:flags.1?i upgrade_stars:flags.3?l\nf2fe7e4a starGiftUnique 155 flags:# id:l title:s slug:s num:i owner_id:flags.0?6 owner_name:flags.1?s owner_address:flags.2?s attributes:V157 availability_issued:i availability_total:i\nbbb6b4a3 starsAmount 156 amount:l nanos:i\n39d99013 starGiftAttributeModel 157 name:s document:36 rarity_permille:i\n13acff19 starGiftAttributePattern 157 name:s document:36 rarity_permille:i\n94271762 starGiftAttributeBackdrop 157 name:s center_color:i edge_color:i pattern_color:i text_color:i rarity_permille:i\ne0bff26c starGiftAttributeOriginalDetails 157 flags:# sender_id:flags.0?6 recipient_id:6 date:i message:flags.1?135";
return { SCHEMA_LAYER, SCHEMA_TYPES, SCHEMA_CTORS };
})();

// ---- src/mtproto/schema/reader.js ----
const __mod_src_mtproto_schema_reader = (() => {
// A schema-driven TL reader: it interprets the constructor table that scripts/gen-schema.mjs extracts from the layer-198
// schema (generated.js) and turns a server answer into plain objects: { _: "channel", id: 123n, access_hash: -5n, ... }.
// Field names are TL's own; int is a number, long a BigInt, double a number, int128/int256/bytes a Uint8Array (a view
// into the answer, no copy), string a string, Bool a boolean, a `true` flag field is `true` when its bit is set and
// absent otherwise, flags fields keep their numeric value.
//
// TL has no lengths: an unknown constructor id cannot be skipped, so it stops the read with a typed `protocol` error
// naming the id (`e.ctor`); so does a constructor of the wrong type, a bad Bool, a truncated answer or trailing bytes.
// Nothing is ever guessed.
//
// The table is parsed lazily: one split of the string at the first decode, each constructor's params on first use.
const { Reader, CTOR } = __mod_src_mtproto_tl;
const { toHex, fromHex } = __mod_src_mtproto_bytes;
const { gunzipHex } = __mod_src_mtproto_crypto;
const { mtError, fromRpcError } = __mod_src_mtproto_errors;
const { SCHEMA_LAYER, SCHEMA_TYPES, SCHEMA_CTORS } = __mod_src_mtproto_schema_generated;

const K_FLAGS = 1, K_INT = 2, K_LONG = 3, K_DOUBLE = 4, K_INT128 = 5, K_INT256 = 6, K_STRING = 7, K_BYTES = 8, K_BOOL = 9, K_TRUE = 10,
  K_OBJ = 11, K_VECTOR = 12, K_BARE_VECTOR = 13, K_BARE = 14;
const SIMPLE = { "#": K_FLAGS, i: K_INT, l: K_LONG, d: K_DOUBLE, q: K_INT128, Q: K_INT256, s: K_STRING, b: K_BYTES, B: K_BOOL, t: K_TRUE };
const MAX_DEPTH = 64; // nested objects per answer; real layer-198 answers stay far below
const hex8 = (id) => "0x" + (id >>> 0).toString(16).padStart(8, "0");
const protocol = (message, extra) => mtError("protocol", message, extra);

function parseCode(s) {
  const k = SIMPLE[s];
  if (k) return { k };
  const c = s.charCodeAt(0);
  if (c >= 48 && c <= 57) return { k: K_OBJ, t: Number(s) };
  if (s[0] === "V") return { k: K_VECTOR, of: parseCode(s.slice(1)) };
  if (s[0] === "v") return { k: K_BARE_VECTOR, of: parseCode(s.slice(1)) };
  if (s[0] === "%") return { k: K_BARE, name: s.slice(1) };
  throw new Error("bad schema type code " + s);
}

function compileLine(line) {
  const parts = line.split(" ");
  const params = [];
  for (let i = 3; i < parts.length; i++) {
    const p = parts[i];
    const colon = p.indexOf(":");
    const name = p.slice(0, colon);
    let code = p.slice(colon + 1);
    let flagField = null, bit = 0;
    const q = code.indexOf("?");
    if (q > 0) {
      const dot = code.indexOf(".");
      flagField = code.slice(0, dot);
      bit = Number(code.slice(dot + 1, q));
      code = code.slice(q + 1);
    }
    params.push({ name, flagField, bit, type: parseCode(code) });
  }
  return { id: parseInt(parts[0], 16) >>> 0, name: parts[1], type: Number(parts[2]), params };
}

/** A decoder over a schema `{ types: [typeName], ctors: "id name typeIndex params...\n..." }` (generated.js format). */
function createDecoder({ types, ctors, layer = null }) {
  let byId = null;   // id -> line (string) until compiled, then the compiled constructor
  let byName = null; // name -> compiled constructor (for bare types; built on first need)
  const typeIndex = new Map(types.map((t, i) => [t, i]));
  let depth = 0; // objects open right now (decode resets it), so a hostile answer cannot nest without bound
  const enter = () => { if (++depth > MAX_DEPTH) throw protocol("TL answer nested too deep (over " + MAX_DEPTH + " objects)"); };

  const index = () => {
    if (byId) return byId;
    byId = new Map();
    for (const line of ctors.split("\n")) {
      if (line) byId.set(parseInt(line.slice(0, line.indexOf(" ")), 16) >>> 0, line);
    }
    return byId;
  };
  const ctorById = (id) => {
    const m = index();
    const v = m.get(id);
    if (typeof v !== "string") return v;
    const c = compileLine(v);
    m.set(id, c);
    return c;
  };
  const ctorByName = (name) => {
    if (!byName) {
      byName = new Map();
      for (const id of index().keys()) { const c = ctorById(id); byName.set(c.name, c); }
    }
    const c = byName.get(name);
    if (!c) throw protocol("bare type " + name + " is not in the schema");
    return c;
  };

  function readBoxed(r, expected, skip) {
    const id = r.int();
    const c = ctorById(id);
    if (!c) {
      throw protocol("unknown TL constructor " + hex8(id) + (expected >= 0 ? " where a " + types[expected] + " belongs" : "") + " at byte " + (r.o - 4), { ctor: id });
    }
    if (expected >= 0 && c.type !== expected) {
      throw protocol("TL constructor " + c.name + " (" + hex8(id) + ", a " + types[c.type] + ") where a " + types[expected] + " belongs", { ctor: id });
    }
    if (skip && skip(c.name, types[c.type])) {
      walkBody(r, c);
      return { _: c.name, skipped: true };
    }
    return readBody(r, c, skip);
  }

  function readBody(r, c, skip) {
    enter();
    const o = { _: c.name };
    const ps = c.params;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.flagField !== null && ((o[p.flagField] >>> p.bit) & 1) === 0) continue;
      if (p.type.k === K_TRUE) { o[p.name] = true; continue; }
      o[p.name] = readValue(r, p.type, skip);
    }
    depth--;
    return o;
  }

  function readValue(r, t, skip) {
    switch (t.k) {
      case K_FLAGS: return r.int();
      case K_INT: return r.int32();
      case K_LONG: return r.long();
      case K_DOUBLE: return r.double();
      case K_INT128: return r.raw(16);
      case K_INT256: return r.raw(32);
      case K_STRING: return r.string();
      case K_BYTES: return r.bytes();
      case K_BOOL: return readBool(r);
      case K_TRUE: return true;
      case K_OBJ: return readBoxed(r, t.t, skip);
      case K_BARE: return readBody(r, ctorByName(t.name), skip);
      case K_VECTOR:
      case K_BARE_VECTOR: {
        const n = vectorCount(r, t.k === K_VECTOR);
        const out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = readValue(r, t.of, skip);
        return out;
      }
      default: throw protocol("bad schema type");
    }
  }

  // The same walk without building anything (strings are not decoded, bytes not copied).
  function walkBoxed(r, expected) {
    const id = r.int();
    const c = ctorById(id);
    if (!c) throw protocol("unknown TL constructor " + hex8(id) + (expected >= 0 ? " where a " + types[expected] + " belongs" : "") + " at byte " + (r.o - 4), { ctor: id });
    if (expected >= 0 && c.type !== expected) throw protocol("TL constructor " + c.name + " (" + hex8(id) + ", a " + types[c.type] + ") where a " + types[expected] + " belongs", { ctor: id });
    walkBody(r, c);
  }
  function walkBody(r, c) {
    enter();
    const ps = c.params;
    let flags = null;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.flagField !== null && ((flags[p.flagField] >>> p.bit) & 1) === 0) continue;
      if (p.type.k === K_FLAGS) { (flags || (flags = {}))[p.name] = r.int(); continue; }
      walkValue(r, p.type);
    }
    depth--;
  }
  function walkValue(r, t) {
    switch (t.k) {
      case K_FLAGS: case K_INT: r.raw(4); return;
      case K_LONG: case K_DOUBLE: r.raw(8); return;
      case K_INT128: r.raw(16); return;
      case K_INT256: r.raw(32); return;
      case K_STRING: case K_BYTES: r.bytes(); return;
      case K_BOOL: readBool(r); return;
      case K_TRUE: return;
      case K_OBJ: walkBoxed(r, t.t); return;
      case K_BARE: walkBody(r, ctorByName(t.name)); return;
      case K_VECTOR: case K_BARE_VECTOR: {
        const n = vectorCount(r, t.k === K_VECTOR);
        const of = t.of;
        if (of.k === K_INT || of.k === K_FLAGS) { r.raw(4 * n); return; }
        if (of.k === K_LONG || of.k === K_DOUBLE) { r.raw(8 * n); return; }
        for (let i = 0; i < n; i++) walkValue(r, of);
        return;
      }
      default: throw protocol("bad schema type");
    }
  }

  function vectorCount(r, boxed) {
    if (boxed) {
      const id = r.int();
      if (id !== CTOR.vector) throw protocol("not a vector: " + hex8(id), { ctor: id });
    }
    const n = r.int32();
    if (n < 0 || n * 4 > r.b.length - r.o) throw protocol("bad vector length " + n);
    return n;
  }

  /**
   * Decodes one boxed object filling all of `u8`. Options: `expect` a type name the top-level object must belong to;
   * `skip(name, typeName)` true for a constructor that should be walked but not built (answers { _, skipped: true }).
   * A top-level gzip_packed is unpacked (natively); a top-level rpc_error answers { _: "rpc_error", error_code, error_message },
   * or is thrown as its typed error (errors.js) when `expect` is given. More than 64 nested objects is `protocol`.
   */
  function decode(u8, { expect, skip } = {}) {
    depth = 0;
    let r = new Reader(u8);
    let head = r.peekInt();
    if (head === CTOR.gzipPacked) {
      r.int();
      r = new Reader(fromHex(gunzipHex(toHex(r.bytes()))));
      head = r.peekInt();
    }
    let out;
    if (head === CTOR.rpcError) {
      r.int();
      out = { _: "rpc_error", error_code: r.int32(), error_message: r.string() };
      if (expect !== undefined) throw fromRpcError({ code: out.error_code, message: out.error_message });
    } else {
      let expected = -1;
      if (expect !== undefined) {
        expected = typeIndex.has(expect) ? typeIndex.get(expect) : -2;
        if (expected === -2) throw protocol("type " + expect + " is not in the schema");
      }
      out = readBoxed(r, expected, skip || null);
    }
    if (!r.atEnd()) throw protocol("trailing bytes after " + out._ + " (" + (r.b.length - r.o) + ")");
    return out;
  }

  return {
    decode,
    has: (id) => index().has(id >>> 0),
    stats: () => ({ layer, constructors: index().size, types: types.length, typeNames: types.slice(), has: (id) => index().has(id >>> 0), bytes: ctors.length }),
  };
}

let api = null;
const apiDecoder = () => api || (api = createDecoder({ types: SCHEMA_TYPES, ctors: SCHEMA_CTORS, layer: SCHEMA_LAYER }));

/** Decodes an answer with the layer-198 API schema (see createDecoder's decode for the options). */
const decode = (u8, opts) => apiDecoder().decode(u8, opts);
const schemaStats = () => apiDecoder().stats();

function readBool(r) {
  const c = r.int();
  if (c === CTOR.boolTrue) return true;
  if (c === CTOR.boolFalse) return false;
  throw protocol("not a Bool: " + hex8(c), { ctor: c });
}
return { createDecoder, decode, schemaStats };
})();

// ---- src/mtproto/big.js ----
const __mod_src_mtproto_big = (() => {
// A hand-kept MODEL of the big strings this library holds at once (hex of packets and chunks), so a test can bound the
// peak under QuickJS's 64 MiB per-plugin cap. It is NOT the real QuickJS heap: it only knows what the code tells it
// (hold when a big string is made or taken, release at its last use), so it catches a release missing in our code, or a
// copy kept longer than planned, never a reference kept by mistake that nobody declared, and never the copies made
// inside kino.crypto/kino.ws (the prelude's JSON, Kotlin). Strings handed to a caller (getFile's answer) are the
// caller's: not counted here. Counts characters of strings of at least BIG characters (hex: 2 per byte).
const BIG = 65536;
const big = {
  live: 0,
  peak: 0,
  /** Counts a string of `n` characters (when it is big); answers what it counted, for a symmetric release. */
  hold(n) { if (n >= BIG) { this.live += n; if (this.live > this.peak) this.peak = this.live; return n; } return 0; },
  /** The opposite of hold(n). No clamp: a release with no matching hold shows as a negative live count. */
  release(n) { if (n >= BIG) this.live -= n; },
  /** Takes back exactly what hold() answered (a sum of holds of different sizes). */
  releaseCounted(counted) { this.live -= counted; },
  reset() { this.live = 0; this.peak = 0; },
};
return { big };
})();

// ---- src/mtproto/transport.js ----
const __mod_src_mtproto_transport = (() => {
// Obfuscated "intermediate" MTProto transport over kino.ws, as the spike's Transport (mtproto.mjs) did over Node's
// WebSocket: a 64-byte random init whose tail is encrypted, then packets `len:uint32le payload`, the whole stream in
// each direction under one AES-256-CTR keystream that continues across messages.
//
// kino.crypto's CTR is one-shot (key + iv in, bytes out), so CtrStream keeps the stream position itself: the byte at
// stream offset k uses counter block iv + floor(k / 16), so a message starting at offset k is encrypted as
// (k % 16 zero bytes + data) under iv + floor(k / 16) and the k % 16 prefix bytes are dropped.
//
// Frames cross kino.ws as hex strings (apiVersion 13: `send(hex, { encoding: "hex" })`, `recv(ms, { encoding: "hex" })`):
// Kino encodes and decodes them natively, so no JavaScript loop touches the bytes of a chunk. An app without frame
// encodings answers a Uint8Array or refuses a string: the transport notices it once and goes on the old way.
const { toHex, fromHex, readU32LE, writeU32LE, random, reversed } = __mod_src_mtproto_bytes;
const { ctrHex } = __mod_src_mtproto_crypto;
const { mtError } = __mod_src_mtproto_errors;
const { big } = __mod_src_mtproto_big;

const DC_HOSTS = Object.freeze({ 1: "pluto", 2: "venus", 3: "aurora", 4: "vesta", 5: "flora" });
const MAX_SEND_BYTES = 786000; // kino.ws frame cap
// A 1 MiB chunk is ~1 MiB + 100 bytes; at most 3 chunk requests are in flight (client.js), so Telegram may pack at most
// three answers into one container. Past 3 MiB + 64 KiB it is not an answer of ours (and its hex copies would not fit
// QuickJS's 64 MiB cap).
const MAX_PACKET_BYTES = 3 * (1 << 20) + 65536;
const MASK128 = (1n << 128n) - 1n;
const ZEROS = "00".repeat(16);

function dcUrl(dc) {
  const host = DC_HOSTS[dc];
  if (!host) throw mtError("invalid_request", "unknown DC " + dc);
  return "wss://" + host + ".web.telegram.org/apiws";
}

class CtrStream {
  constructor(keyHex, ivHex) {
    this.key = keyHex;
    this.iv = BigInt("0x" + ivHex);
    this.offset = 0;
  }
  /** Encrypts (or decrypts) the next bytes of the stream, given and returned as hex. */
  processHex(dataHex) {
    if (dataHex.length === 0) return "";
    const skip = this.offset % 16;
    const block = BigInt(Math.floor(this.offset / 16));
    const iv = ((this.iv + block) & MASK128).toString(16).padStart(32, "0");
    const out = ctrHex(skip ? ZEROS.slice(0, skip * 2) + dataHex : dataHex, this.key, iv);
    this.offset += dataHex.length / 2;
    return skip ? out.slice(skip * 2) : out;
  }
}

const BAD_FIRST_WORDS = [0x44414548, 0x54534f50, 0x20544547, 0x4954504f, 0xeeeeeeee, 0xdddddddd, 0x02010316];

/** The 64-byte obfuscation init (plain), as the spike made it: never mistaken for another protocol's first bytes. */
function makeInit(dc, rand = random) {
  for (;;) {
    const b = rand(64);
    if (b[0] === 0xef) continue;
    if (BAD_FIRST_WORDS.includes(readU32LE(b, 0))) continue;
    if (readU32LE(b, 4) === 0) continue;
    writeU32LE(b, 56, 0xeeeeeeee);
    b[60] = dc & 255;
    b[61] = (dc >> 8) & 255;
    return b;
  }
}

class Transport {
  /** `open` is kino.ws.open (injectable for tests); `url` defaults to the DC's apiws address. */
  constructor(dc, { url, open } = {}) {
    this.dc = dc;
    this.url = url || dcUrl(dc);
    this.wsOpen = open || ((u, o) => kino.ws.open(u, o));
    this.ws = null;
    this.bufHex = "";   // the start of the stream not yet returned as packets
    this.pending = [];  // later frames (deobfuscated hex) not yet joined: one join per packet, not one per frame
    this.pendingChars = 0;
    this.encoded = true; // frames as hex strings, until the app shows it cannot
    this.closed = false;
  }

  async open() {
    const init = makeInit(this.dc);
    const keyIv = init.subarray(8, 56);
    const rev = reversed(keyIv);
    this.enc = new CtrStream(toHex(init.subarray(8, 40)), toHex(init.subarray(40, 56)));
    this.dec = new CtrStream(toHex(rev.subarray(0, 32)), toHex(rev.subarray(32, 48)));
    const encInit = this.enc.processHex(toHex(init));
    this.firstHex = toHex(init.subarray(0, 56)) + encInit.slice(112, 128);
    try {
      this.ws = await this.wsOpen(this.url, { protocol: "binary" });
    } catch (e) {
      throw mtError(e && e.code === "timeout" ? "timeout" : "closed", "could not open " + this.url + ": " + (e && e.message), { cause: e && e.code });
    }
    return this;
  }

  /** Sends one packet; `payloadHex` is the MTProto message (unencrypted or encrypted) as hex. */
  async sendHex(payloadHex) {
    if (this.closed || !this.ws) throw mtError("closed", "transport closed");
    // The size first: once CTR has run, the keystream has moved and a refused send would leave the stream out of step.
    if (4 + payloadHex.length / 2 + (this.firstHex ? this.firstHex.length / 2 : 0) > MAX_SEND_BYTES) throw mtError("invalid_request", "packet too large for one frame");
    const len = new Uint8Array(4);
    writeU32LE(len, 0, payloadHex.length / 2);
    let wire = this.enc.processHex(toHex(len) + payloadHex);
    if (this.firstHex) { wire = this.firstHex + wire; this.firstHex = null; }
    try {
      if (this.encoded) {
        try {
          await this.ws.send(wire, { encoding: "hex" });
        } catch (e) {
          if (!(e && e.code === "invalid_request" && /Uint8Array/.test(String(e.message)))) throw e;
          this.encoded = false; // an app without frame encodings
          await this.ws.send(fromHex(wire));
        }
      } else {
        await this.ws.send(fromHex(wire));
      }
    } catch (e) {
      const code = e && e.code;
      if (code === "too_large" || code === "invalid_request") throw mtError("invalid_request", "send refused: " + (e && e.message), { cause: code });
      this.closed = true;
      throw mtError("closed", "send failed: " + (e && e.message), { cause: code });
    }
  }

  /** The next packet's payload as hex. Throws `timeout` after `timeoutMs`, `closed` when the socket ends. */
  async recvHex(timeoutMs = 20000, now = () => Date.now(), trace) {
    const deadline = now() + timeoutMs;
    const join = () => {
      if (!this.pending.length) return;
      // One copy of the frames joined; the frames go right after (they are the only other copy).
      const joined = this.pending.length === 1 ? this.pending[0] : this.pending.join("");
      if (this.pending.length > 1) { big.hold(joined.length); for (const p of this.pending) big.release(p.length); } // one frame: the same string
      this.pending = [];
      this.pendingChars = 0;
      if (this.bufHex === "") { this.bufHex = joined; return; } // the usual case: no second concatenated copy
      big.hold(this.bufHex.length + joined.length);
      big.release(this.bufHex.length); big.release(joined.length);
      this.bufHex += joined;
    };
    for (;;) {
      if (this.bufHex.length < 8) join();
      if (this.bufHex.length >= 8) {
        const n = readU32LE(fromHex(this.bufHex.slice(0, 8)), 0) & 0x7fffffff;
        if (n > MAX_PACKET_BYTES) {
          await this.close();
          throw mtError("protocol", "packet of " + n + " bytes announced: over the " + MAX_PACKET_BYTES + "-byte cap");
        }
        if (this.bufHex.length + this.pendingChars >= 8 + n * 2) {
          join();
          const payload = this.bufHex.slice(8, 8 + n * 2);
          big.hold(payload.length);
          const rest = this.bufHex.length > 8 + n * 2 ? this.bufHex.slice(8 + n * 2) : "";
          big.release(this.bufHex.length); big.hold(rest.length);
          this.bufHex = rest;
          return payload; // the caller owns it (and releases it)
        }
      }
      if (this.closed || !this.ws) throw mtError("closed", "transport closed");
      const left = deadline - now();
      if (left <= 0) throw mtError("timeout", "no answer from DC " + this.dc);
      let frame;
      const t0 = trace ? Date.now() : 0;
      try {
        frame = await this.ws.recv(Math.min(left, 60000), this.encoded ? { encoding: "hex" } : undefined);
      } catch (e) {
        this.closed = true;
        throw mtError(e && e.code === "limit" ? "protocol" : "closed", "socket closed: " + (e && e.message), { cause: e && e.code });
      }
      if (frame === null) { if (trace) trace.wsrecv += Date.now() - t0; continue; }
      const t1 = trace ? Date.now() : 0;
      let fh;
      if (typeof frame === "string") fh = frame;
      else { this.encoded = false; fh = toHex(frame); } // an app that ignored the encoding: the old JS pass
      const t2 = trace ? Date.now() : 0;
      const plain = this.dec.processHex(fh);
      fh = null; frame = null; // the encrypted frame dies here: only its plaintext is kept
      big.hold(plain.length);
      this.pending.push(plain);
      this.pendingChars += plain.length;
      if (trace) {
        // Timing (the shell's TIMING switch): numbers only, never the data.
        trace.wsrecv += t1 - t0; trace.frames++; trace.frameBytes += plain.length / 2;
        if (!trace.firstFrameAt) trace.firstFrameAt = t1;
        trace.tohex += t2 - t1; trace.ctr += Date.now() - t2;
      }
    }
  }

  async close() {
    this.closed = true;
    big.release(this.bufHex.length);
    for (const p of this.pending) big.release(p.length);
    this.bufHex = "";
    this.pending = [];
    this.pendingChars = 0;
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { await ws.close(); } catch { /* already closed */ } }
  }
}
return { DC_HOSTS, MAX_SEND_BYTES, MAX_PACKET_BYTES, dcUrl, CtrStream, makeInit, Transport };
})();

// ---- src/mtproto/msgid.js ----
const __mod_src_mtproto_msgid = (() => {
// Client message ids: about unixtime * 2^32, divisible by 4, strictly increasing within a session.
class MsgIds {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.last = 0n;
  }
  /** `offsetSec`: server time minus local time. */
  next(offsetSec = 0) {
    const ms = this.now();
    const secs = BigInt(Math.floor(ms / 1000) + offsetSec);
    const frac = BigInt(Math.floor((ms % 1000) * 4294967.296)) & ~3n;
    let id = (secs << 32n) | frac;
    if (id <= this.last) id = this.last + 4n;
    this.last = id;
    return id;
  }
}
return { MsgIds };
})();

// ---- src/mtproto/authkey.js ----
const __mod_src_mtproto_authkey = (() => {
// "Creating an authorization key" (MTProto 2.0), exactly as the verified-live spike (mtproto.mjs createAuthKey):
// req_pq_multi, pq factorisation, p_q_inner_data_dc under RSA_PAD, server_DH_params_ok, the safety checks on dh_prime,
// g, g_a and g_b, set_client_DH_params and the new_nonce_hash1 check. Big-number powers go to kino.crypto.modPow
// (native); BigInt is only used for comparisons, the pq factorisation (~63 bits) and Miller-Rabin's bookkeeping.
const { toHex, fromHex, concat, equal, xor, reversed, random, bigFromBytes, bigToBytes, bigToHex } = __mod_src_mtproto_bytes;
const { sha1, sha256, igeEncrypt, igeDecrypt, modPowHex } = __mod_src_mtproto_crypto;
const { Writer, Reader, CTOR, reqPqMulti, pqInnerDataDc, reqDHParams, clientDHInnerData, setClientDHParams } = __mod_src_mtproto_tl;
const { MsgIds } = __mod_src_mtproto_msgid;
const { mtError, fromTransportError } = __mod_src_mtproto_errors;

/** Telegram's fixed 2048-bit DH prime (a safe prime; g = 3 works with it). Seeing it skips the primality rounds. */
const TELEGRAM_DH_PRIME_HEX =
  "c71caeb9c6b1c9048e6c522f70f13f73980d40238e3e21c14934d037563d930f48198a0aa7c14058229493d22530f4dbfa336f6e0ac925139543aed44cce7c3720fd51f69458705ac68cd4fe6b6b13abdc9746512969328454f18faf8c595f642477fe96bb2a941d5bcd1d4ac8cc49880708fa9b378e3c4f3a9060bee67cf9a4a4a695811051907e162753b56b0f6b410dba74d8a84b2a14b3144e0ef1284754fd17ed950d5965b4b9dd46582db1178d169c6bc465b0d6ff9ca3928fef5b9ae4e418fc15e83ebea0f87fa9ff5eed70050ded2849f47bf959d956850ce929851f0d8115f635b105ee2e4e15d04b2454bf6f4fadf034b10403119cd8e3b92fcc5b";
const TELEGRAM_DH_PRIME = BigInt("0x" + TELEGRAM_DH_PRIME_HEX);

const protocol = (m) => mtError("protocol", m);
const evenHex = (n) => { const h = n.toString(16); return h.length % 2 ? "0" + h : h; };
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

/** Brent's variant of Pollard's rho with batched gcds: pq < 2^64 factors in a few thousand BigInt steps. */
function factorPq(pq) {
  // Telegram's pq is a product of two primes below 2^32 (so below 2^64): anything else is not a server of ours.
  if (typeof pq !== "bigint" || pq < 4n || pq >= 1n << 64n) throw protocol("pq out of range");
  if (pq % 2n === 0n) return [2n, pq / 2n];
  let steps = 0;
  for (let c = 1n; c < 64n; c++) {
    const f = (v) => (v * v + c) % pq;
    let y = 2n, x = 2n, ys = 2n, q = 1n, g = 1n, r = 1;
    const m = 128;
    while (g === 1n) {
      x = y;
      for (let i = 0; i < r; i++) y = f(y);
      for (let k = 0; k < r && g === 1n; k += m) {
        ys = y;
        const lim = Math.min(m, r - k);
        for (let i = 0; i < lim; i++) { y = f(y); q = (q * (x > y ? x - y : y - x)) % pq; }
        g = gcd(q, pq);
        steps += lim;
      }
      r *= 2;
      // A semiprime below 2^64 falls in well under 2^20 steps; past it the input is not one (bounded CPU either way).
      if (steps > 1 << 22) throw protocol("could not factor pq");
    }
    if (g === pq) {
      do { ys = f(ys); g = gcd(x > ys ? x - ys : ys - x, pq); } while (g === 1n);
    }
    if (g !== pq) { const a = g, b = pq / g; return a < b ? [a, b] : [b, a]; }
  }
  throw protocol("could not factor pq");
}

/** Telegram's RSA key fingerprint: the low 64 bits of sha1(TL bytes(n) + TL bytes(e)), as a signed decimal string. */
function rsaFingerprint(nHex, e) {
  const w = new Writer().bytes(fromHex(evenHex(BigInt("0x" + nHex)))).bytes(fromHex(evenHex(BigInt(e)))).done();
  return new Reader(sha1(w), 12).long().toString();
}

const SMALL_PRIMES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];

/** Miller-Rabin with random bases; each base costs one native kino.crypto.modPow. */
function isProbablePrime(n, rounds = 16) {
  if (n < 2n) return false;
  for (const p of SMALL_PRIMES) { if (n === p) return true; if (n % p === 0n) return false; }
  let d = n - 1n, s = 0;
  while ((d & 1n) === 0n) { d >>= 1n; s++; }
  const nHex = evenHex(n), dHex = evenHex(d), byteLen = Math.ceil(n.toString(16).length / 2) + 8;
  outer: for (let i = 0; i < rounds; i++) {
    const a = (bigFromBytes(random(byteLen)) % (n - 3n)) + 2n;
    let x = BigInt("0x" + modPowHex(evenHex(a), dHex, nHex));
    if (x === 1n || x === n - 1n) continue;
    for (let j = 1; j < s; j++) { x = (x * x) % n; if (x === n - 1n) continue outer; }
    return false;
  }
  return true;
}

/** The protocol's checks on (dh_prime, g). Telegram's fixed prime is recognised instead of tested ({ known: true }). */
function checkDhPrime(p, g) {
  if (p.toString(2).length !== 2048) throw protocol("dh_prime is not 2048 bits");
  if (!(g >= 2 && g <= 7)) throw protocol("unexpected g " + g);
  const ok = {
    2: () => p % 8n === 7n,
    3: () => p % 3n === 2n,
    4: () => true,
    5: () => [1n, 4n].includes(p % 5n),
    6: () => [19n, 23n].includes(p % 24n),
    7: () => [3n, 5n, 6n].includes(p % 7n),
  }[g]();
  if (!ok) throw protocol("g = " + g + " does not generate the right subgroup of this dh_prime");
  if (p === TELEGRAM_DH_PRIME) return { known: true };
  if (!isProbablePrime(p) || !isProbablePrime((p - 1n) / 2n)) throw protocol("dh_prime is not a safe prime");
  return { known: false };
}

/** One unencrypted request (auth_key_id = 0) and its answer, as a Reader on the answer's body. */
async function plainCall(t, body, { msgIds, timeoutMs, deadline, now = () => Date.now() }) {
  const w = new Writer().long(0n).long(msgIds.next()).int(body.length).raw(body).done();
  await t.sendHex(toHex(w));
  // With a deadline (the whole key exchange's), each answer waits only for what is left of it.
  const wait = deadline === undefined ? timeoutMs : deadline - now();
  if (wait < 1) throw mtError("timeout", "the key exchange ran out of time", { deadline: true });
  const raw = fromHex(await t.recvHex(wait));
  if (raw.length === 4) throw fromTransportError(new Reader(raw).int32());
  const r = new Reader(raw);
  if (r.long() !== 0n) throw protocol("expected an unencrypted answer");
  r.long();
  const len = r.int();
  return new Reader(r.raw(len));
}

const LIMIT = 1n << (2048n - 64n);
const inRange = (v, p) => v > 1n && v < p - 1n && v > LIMIT && v < p - LIMIT;

/**
 * A new auth key on transport `t` (opened on DC `dc`). `publicKeys` is { signedDecimalFingerprint: { n: hex, e: decimal } }.
 * Answers { authKey (256 bytes), authKeyId (8 bytes), serverSalt (8 bytes), timeOffset (s) }. `rand(n)` is the
 * randomness source (kino.crypto by default; tests inject a broken one to reach the g_b check).
 */
async function createAuthKey(t, { dc, publicKeys, now = () => Date.now(), timeoutMs = 20000, rand = random }) {
  const msgIds = new MsgIds(now);
  // One deadline for the whole exchange (three round trips), not timeoutMs for each.
  const opts = { msgIds, timeoutMs, deadline: now() + timeoutMs, now };
  const nonce = rand(16);
  let r = await plainCall(t, reqPqMulti(nonce), opts);
  if (r.int() !== CTOR.resPQ) throw protocol("expected resPQ");
  if (!equal(r.int128(), nonce)) throw protocol("nonce mismatch");
  const serverNonce = r.int128().slice();
  const pq = bigFromBytes(r.bytes());
  const fps = r.vectorLong().map((f) => f.toString());
  const fp = fps.find((f) => Object.prototype.hasOwnProperty.call(publicKeys, f));
  if (!fp) throw protocol("no known server key among " + fps.join(", "));
  const [p, q] = factorPq(pq);
  const newNonce = rand(32);
  const inner = pqInnerDataDc({ pq: bigToBytes(pq), p: bigToBytes(p), q: bigToBytes(q), nonce, serverNonce, newNonce, dc });
  if (inner.length > 144) throw protocol("inner data too long");

  // RSA_PAD (the plain "sha1 + data" form is refused with -404 since 2021).
  const key = publicKeys[fp];
  const n = BigInt("0x" + key.n), nHex = evenHex(n), eHex = evenHex(BigInt(key.e));
  let encrypted;
  for (let attempt = 0; attempt < 32 && !encrypted; attempt++) {
    const withPad = concat(inner, rand(192 - inner.length));
    const tempKey = rand(32);
    const dataWithHash = concat(reversed(withPad), sha256(tempKey, withPad));
    const aesEnc = igeEncrypt(dataWithHash, tempKey, new Uint8Array(32));
    const keyAesEnc = concat(xor(tempKey, sha256(aesEnc)), aesEnc);
    if (bigFromBytes(keyAesEnc) >= n) continue;
    // The app's modPow pads its answer to the modulus' width (PluginCrypto.modPow); pad here too, never truncate.
    encrypted = bigToBytes(BigInt("0x" + modPowHex(toHex(keyAesEnc), eHex, nHex)), 256);
  }
  if (!encrypted) throw protocol("RSA_PAD found no value below the modulus");

  r = await plainCall(t, reqDHParams({ nonce, serverNonce, p: bigToBytes(p), q: bigToBytes(q), fingerprint: BigInt(fp), encryptedData: encrypted }), opts);
  const ctor = r.int();
  if (ctor === CTOR.serverDHParamsFail) throw protocol("server_DH_params_fail");
  if (ctor !== CTOR.serverDHParamsOk) throw protocol("unexpected answer to req_DH_params: 0x" + ctor.toString(16));
  if (!equal(r.int128(), nonce) || !equal(r.int128(), serverNonce)) throw protocol("nonce mismatch in server_DH_params");
  const answerEnc = r.bytes();
  const a1 = sha1(newNonce, serverNonce), a2 = sha1(serverNonce, newNonce);
  const tmpKey = concat(a1, a2.subarray(0, 12));
  const tmpIv = concat(a2.subarray(12), sha1(newNonce, newNonce), newNonce.subarray(0, 4));
  const answerFull = igeDecrypt(answerEnc, tmpKey, tmpIv);
  const answer = answerFull.subarray(20);
  const d = new Reader(answer);
  if (d.int() !== CTOR.serverDHInnerData) throw protocol("bad server_DH_inner_data");
  if (!equal(d.int128(), nonce) || !equal(d.int128(), serverNonce)) throw protocol("nonce mismatch in inner data");
  const g = d.int();
  const dhPrimeBytes = d.bytes(), gABytes = d.bytes();
  const serverTime = d.int();
  if (!equal(sha1(answer.subarray(0, d.o)), answerFull.subarray(0, 20))) throw protocol("answer hash mismatch");
  const dhPrime = bigFromBytes(dhPrimeBytes), gA = bigFromBytes(gABytes);
  checkDhPrime(dhPrime, g);
  if (!inRange(gA, dhPrime)) throw protocol("g_a out of range");
  const timeOffset = serverTime - Math.floor(now() / 1000);

  const primeHex = bigToHex(dhPrime, 256);
  let b, gB;
  for (let attempt = 0; ; attempt++) {
    if (attempt === 8) throw protocol("g_b out of range");
    b = rand(256);
    gB = bigFromBytes(fromHex(modPowHex(evenHex(BigInt(g)), toHex(b), primeHex)));
    if (inRange(gB, dhPrime)) break;
  }
  const cInner = clientDHInnerData({ nonce, serverNonce, retryId: 0n, gB: bigToBytes(gB) });
  const withHash = concat(sha1(cInner), cInner);
  const cPadded = concat(withHash, rand((16 - (withHash.length % 16)) % 16));
  r = await plainCall(t, setClientDHParams({ nonce, serverNonce, encryptedData: igeEncrypt(cPadded, tmpKey, tmpIv) }), opts);
  const res = r.int();
  if (res !== CTOR.dhGenOk) throw protocol(res === CTOR.dhGenRetry ? "dh_gen_retry" : res === CTOR.dhGenFail ? "dh_gen_fail" : "unexpected answer to set_client_DH_params");
  if (!equal(r.int128(), nonce) || !equal(r.int128(), serverNonce)) throw protocol("nonce mismatch in dh_gen_ok");
  const newNonceHash1 = r.int128();
  const authKey = bigToBytes(BigInt("0x" + modPowHex(toHex(gABytes), toHex(b), primeHex)), 256);
  const authHash = sha1(authKey);
  if (!equal(sha1(newNonce, Uint8Array.of(1), authHash.subarray(0, 8)).subarray(4, 20), newNonceHash1)) throw protocol("new_nonce_hash1 mismatch");
  return {
    authKey,
    authKeyId: authHash.slice(12, 20),
    serverSalt: xor(newNonce.subarray(0, 8), serverNonce.subarray(0, 8)),
    timeOffset,
  };
}
return { TELEGRAM_DH_PRIME_HEX, factorPq, rsaFingerprint, isProbablePrime, checkDhPrime, plainCall, createAuthKey };
})();

// ---- src/mtproto/session.js ----
const __mod_src_mtproto_session = (() => {
// The encrypted MTProto 2.0 session on top of an auth key, ported from the spike's Session (session.mjs): msg_key and
// AES key derivation with sha256, containers, gzip_packed, new_session_created, bad_server_salt (resend), plus what a
// long-lived phone session needs: bad_msg_notification time/seqno fixes, msgs_ack for the server's content messages,
// and a deadline per call.
//
// Bytes stay hex from the socket to the decrypted plaintext: kino.ws hands a Uint8Array, the transport turns it into
// hex once (one JS pass), CTR, IGE and the msg_key hash run natively on hex strings. Messages stay hex too: containers
// and gzip_packed are walked by decoding only their few header bytes, and an rpc result is turned into a Uint8Array
// (a second JS pass) only when the caller wants bytes; `call(body, { hex: true })` hands the result's hex as it is
// (the download path: no JS pass over a file chunk here).
const { toHex, fromHex, random, readI32LE } = __mod_src_mtproto_bytes;
const { sha256Hex, igeEncryptHex, igeDecryptHex, gunzipHex } = __mod_src_mtproto_crypto;
const { Writer, Reader, CTOR, msgsAck, parseRpcError, hexU32, hexBytesAt } = __mod_src_mtproto_tl;
const { MsgIds } = __mod_src_mtproto_msgid;
const { big } = __mod_src_mtproto_big;
const { mtError, fromRpcError, fromTransportError } = __mod_src_mtproto_errors;

const MAX_RESENDS = 5;
const ABANDONED_MS = 30000; // an abandoned request still unanswered after this long is taken as lost
const protocol = (m) => mtError("protocol", m);

class Session {
  /**
   * `state` is { authKey, authKeyId, serverSalt (Uint8Array), timeOffset (s) }: the session updates its salt and time
   * offset in place, so whoever owns `state` can persist them. `onUpdate(body)` gets every message that is not an answer
   * to a call (updates and other constructors this layer does not know).
   */
  constructor(transport, state, { now = () => Date.now(), timeoutMs = 20000, onUpdate = null, log = () => {}, abandonedMs = ABANDONED_MS } = {}) {
    this.abandonedMs = abandonedMs;
    this.maxInflight = 0;
    if (!state.authKey || state.authKey.length !== 256) throw mtError("invalid_request", "auth key must be 256 bytes");
    this.t = transport;
    this.state = state;
    this.ak = toHex(state.authKey);
    this.akId = toHex(state.authKeyId);
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.onUpdate = onUpdate;
    this.log = log;
    this.msgIds = new MsgIds(now);
    this.pendingAcks = [];
    this.waiting = new Map();   // msg_id -> the request waiting for its answer
    this.abandoned = new Map(); // msg_id -> when it was given up: still on the wire, its answer is dropped unkept
    this.seenIds = new Set();   // the last server msg_ids seen (duplicates are dropped)
    this.oldSessions = new Set();
    this.newSession();
  }

  newSession() {
    if (this.sessionId) this.oldSessions.add(this.sessionId);
    this.sessionId = toHex(random(8));
    this.seq = 0;
  }

  /** MTProto 2.0 key derivation over hex: x = 0 client to server, 8 server to client. */
  keyIv(msgKeyHex, x) {
    const a = sha256Hex(msgKeyHex + this.ak.slice(2 * x, 2 * x + 72));
    const b = sha256Hex(this.ak.slice(80 + 2 * x, 152 + 2 * x) + msgKeyHex);
    return { key: a.slice(0, 16) + b.slice(16, 48) + a.slice(48, 64), iv: b.slice(0, 16) + a.slice(16, 48) + b.slice(48, 64) };
  }

  /** Encrypts and sends one message; answers its msg_id. `content` false for acks (even seqno). */
  async send(body, content = true) {
    const id = this.msgIds.next(this.state.timeOffset);
    const seq = content ? this.seq++ * 2 + 1 : this.seq * 2;
    const head = new Writer().raw(this.state.serverSalt).raw(fromHex(this.sessionId)).long(id).int(seq).int(body.length).raw(body).done();
    const padLen = 12 + ((16 - ((head.length + 12) % 16)) % 16);
    const plainHex = toHex(head) + toHex(random(padLen));
    const msgKey = sha256Hex(this.ak.slice(176, 240) + plainHex).slice(16, 48);
    const { key, iv } = this.keyIv(msgKey, 0);
    await this.t.sendHex(this.akId + msgKey + igeEncryptHex(plainHex, key, iv));
    return id;
  }

  async flushAcks() {
    while (this.pendingAcks.length) {
      const ids = this.pendingAcks.splice(0, 1024);
      await this.send(msgsAck(ids), false);
    }
  }

  /** One transport packet -> its message [{ id, seqno, hex }] (empty when it belongs to one of our older sessions). */
  async recvMessages(deadline, trace) {
    // Boxed so that no stack slot of ours keeps the packet alive once openPacket has let it go.
    const box = { hex: await this.t.recvHex(Math.max(1, deadline - this.now()), this.now, trace) };
    return this.openPacket(box, trace);
  }

  /**
   * Decrypts one packet ({ hex }, taken out of the box) and answers its message. Memory: QuickJS frees a string the
   * moment its last reference goes, so every big string here is dropped before the next one is made: the packet before
   * the decryption runs (only its encrypted part is kept), the encrypted part right after, the plaintext once the
   * message is sliced out. At most two copies of a packet are alive at once (big.js counts them).
   */
  openPacket(box, trace) {
    let hex = box.hex;
    box.hex = null;
    if (hex.length === 8) { big.release(hex.length); throw fromTransportError(readI32LE(fromHex(hex), 0)); }
    if (hex.length < 48 + 64) throw protocol("short packet");
    if (hex.slice(0, 16) !== this.akId) { big.release(hex.length); throw protocol("answer under another auth key"); }
    if (((hex.length - 48) / 2) % 16 !== 0) { big.release(hex.length); throw protocol("encrypted data not a multiple of 16"); }
    const msgKey = hex.slice(16, 48);
    const enc = { hex: hex.slice(48) };
    big.hold(enc.hex.length);
    big.release(hex.length);
    hex = null;
    let plainHex = this.decrypt(enc, msgKey, trace);
    const sid = plainHex.slice(16, 32);
    if (sid !== this.sessionId) {
      big.release(plainHex.length);
      if (this.oldSessions.has(sid)) { this.log("message for an older session ignored"); return []; }
      throw protocol("answer for another session");
    }
    const h = new Reader(fromHex(plainHex.slice(32, 64)));
    const id = h.long(), seqno = h.int(), len = h.int();
    // A server message id is odd, and each is seen once: a duplicate (a replay) is dropped.
    if ((id & 1n) !== 1n) { big.release(plainHex.length); throw protocol("server msg_id is not odd"); }
    if (this.seenIds.has(id)) { big.release(plainHex.length); this.log("duplicate server message dropped"); return []; }
    this.seenIds.add(id);
    if (this.seenIds.size > 512) this.seenIds.delete(this.seenIds.values().next().value);
    const total = plainHex.length / 2;
    const padding = total - 32 - len;
    if (len % 4 !== 0 || padding < 12 || padding > 1024) { big.release(plainHex.length); throw protocol("bad message length"); }
    const body = plainHex.slice(64, 64 + len * 2);
    big.hold(body.length);
    big.release(plainHex.length);
    plainHex = null;
    return [{ id, seqno, hex: body }];
  }

  /** The plaintext (hex) of the encrypted part ({ hex }, taken out of the box), its msg_key checked. */
  decrypt(enc, msgKey, trace) {
    let encHex = enc.hex;
    enc.hex = null;
    const { key, iv } = this.keyIv(msgKey, 8);
    const t0 = trace ? Date.now() : 0;
    // Kino with apiVersion 13's aesIgeVerify: the AES-IGE decryption and the msg_key check (SHA-256(auth_key[96:128] ||
    // plaintext), bytes 8..24) in one native call, with no joined copy of the plaintext. An older Kino: the two calls.
    if (typeof kino.crypto.aesIgeVerify === "function") {
      let plainHex;
      try {
        plainHex = kino.crypto.aesIgeVerify(key, iv, encHex, {
          mac: msgKey, macPrefix: this.ak.slice(192, 256), macOffset: 8,
          keyEncoding: "hex", ivEncoding: "hex", inputEncoding: "hex", outputEncoding: "hex",
        });
      } catch (e) {
        big.release(encHex.length);
        // The op's own words, or (should they change) any crypto_error of it: an answer that cannot be opened.
        if (e && (e.message === "the mac doesn't match" || e.code === "crypto_error")) throw protocol("msg_key mismatch");
        throw e;
      }
      big.hold(plainHex.length);
      big.release(encHex.length);
      encHex = null;
      if (trace) trace.ige += Date.now() - t0; // decryption and MAC together (mac stays 0 on this path)
      return plainHex;
    }
    const plainHex = igeDecryptHex(encHex, key, iv);
    big.hold(plainHex.length);
    big.release(encHex.length);
    encHex = null;
    const t1 = trace ? Date.now() : 0;
    // SHA-256 takes one string: the 32 key bytes and the plaintext are joined for the call only (one more copy, briefly).
    big.hold(64 + plainHex.length); big.release(64 + plainHex.length);
    const ok = sha256Hex(this.ak.slice(192, 256) + plainHex).slice(16, 48) === msgKey;
    if (trace) { trace.ige += t1 - t0; trace.mac += Date.now() - t1; }
    if (!ok) { big.release(plainHex.length); throw protocol("msg_key mismatch"); }
    return plainHex;
  }

  /**
   * Sends `body` and waits for its rpc_result: answers the result's bytes (unzipped), throws the rpc_error as a typed
   * error (errors.js), `timeout` past the deadline, `bad_msg` when the server keeps refusing the message. With
   * `hex: true` the result comes back as a hex string instead of a Uint8Array.
   */
  async call(body, { timeoutMs = this.timeoutMs, hex = false, trace } = {}) {
    const deadline = this.now() + timeoutMs;
    const entry = await this.request(body, { hex, trace });
    return this.settle(entry, deadline);
  }

  /**
   * Sends `body` and answers its entry without waiting for the answer. Several requests may be in flight at once (one
   * connection, MTProto pairs every answer with its msg_id): each pump fills whichever entry an answer belongs to.
   * An entry is { done, result (hex), error }; `settle(entry, deadline)` pumps until it is done.
   */
  async request(body, { hex = false, trace } = {}) {
    await this.flushAcks();
    const entry = { body, hex, trace, id: 0n, done: false, result: null, error: null, resends: 0 };
    entry.id = await this.send(body);
    if (trace && !trace.sentAt) trace.sentAt = Date.now();
    this.waiting.set(entry.id, entry);
    this.maxInflight = Math.max(this.maxInflight, this.inflight());
    return entry;
  }

  /** Stops waiting for `entry`: its answer, if it ever comes, is dropped without being kept (but counted in flight). */
  forget(entry) {
    if (entry.done) return;
    this.waiting.delete(entry.id);
    this.abandoned.set(entry.id, this.now());
  }

  /** Requests sent and not answered yet, those given up included (their answers are still on the way). */
  inflight() {
    const old = this.now() - this.abandonedMs;
    for (const [id, at] of this.abandoned) if (at < old) this.abandoned.delete(id); // lost for good
    return this.waiting.size + this.abandoned.size;
  }

  finish(entry, result, error) {
    this.waiting.delete(entry.id);
    entry.done = true;
    entry.result = result;
    entry.error = error;
  }

  async resend(entry, why) {
    this.waiting.delete(entry.id);
    if (++entry.resends > MAX_RESENDS) {
      this.finish(entry, null, mtError("bad_msg", "the server keeps refusing the message (" + why + ")", { badMsgCode: why }));
      return;
    }
    entry.id = await this.send(entry.body);
    this.waiting.set(entry.id, entry);
  }

  /**
   * Pumps answers until `entry` is done; then answers its result (hex, or bytes when the request did not ask for hex)
   * or throws its error. A pump that fails (the socket, a protocol error, the deadline) fails every request still in
   * flight on this session: the client drops such a connection.
   */
  async settle(entry, deadline) {
    while (!entry.done) {
      if (this.now() >= deadline) {
        this.forget(entry);
        throw mtError("timeout", "no answer in time");
      }
      try {
        await this.pumpOnce(deadline, entry.trace);
      } catch (e) {
        if (e && e.code === "timeout" && !this.broken) { this.forget(entry); throw e; } // between packets: the stream is intact
        // Anything else leaves the stream in an unknown state: this session is never used again (the client drops it).
        this.broken = true;
        for (const w of [...this.waiting.values()]) this.finish(w, null, e);
        throw e;
      }
    }
    if (entry.error) throw entry.error;
    // The result goes to the caller: the entry lets go of it. A hex result stays counted until the caller drops it.
    const result = entry.result;
    entry.result = null;
    if (entry.hex) return result;
    const bytes = fromHex(result);
    big.release(result.length); // after its last use
    return bytes;
  }

  /**
   * Makes room for one more request: pumps answers until fewer than `max` requests are in flight, until `until`.
   * Answers false when the room did not come in time (requests that will not come back): the caller then drops this
   * connection, which is the only way to take them off the wire.
   */
  async drainBelow(max, until) {
    while (this.inflight() >= max) {
      if (this.now() >= until) return false;
      try {
        await this.pumpOnce(until);
      } catch (e) {
        if (e && e.code === "timeout" && !this.broken) continue;
        this.broken = true;
        for (const w of [...this.waiting.values()]) this.finish(w, null, e);
        throw e;
      }
    }
    return true;
  }

  /** One transport packet: every message in it goes to the request it answers (or to onUpdate). */
  async pumpOnce(deadline, trace) {
    const queue = await this.recvMessages(deadline, trace);
    while (queue.length) {
      const m = queue.shift();
      if (m.seqno & 1) this.pendingAcks.push(m.id);
      const ctor = hexU32(m.hex, 0);
      if (ctor === CTOR.msgContainer) {
        const size = m.hex.length / 2;
        const n = hexU32(m.hex, 4);
        let o = 8;
        for (let i = 0; i < n; i++) {
          if (o + 16 > size) throw protocol("container past its end");
          const h = new Reader(fromHex(m.hex.slice(o * 2, (o + 16) * 2)));
          const id = h.long(), seqno = h.int(), len = h.int();
          if (o + 16 + len > size) throw protocol("container past its end");
          const inner = m.hex.slice((o + 16) * 2, (o + 16 + len) * 2);
          big.hold(inner.length);
          queue.push({ id, seqno, hex: inner });
          o += 16 + len;
        }
        big.release(m.hex.length); // the container itself is not kept
        continue;
      }
      if (ctor === CTOR.gzipPacked) {
        const tg = trace ? Date.now() : 0;
        const unpacked = gunzipHex(hexBytesAt(m.hex, 4).hex);
        big.hold(unpacked.length);
        big.release(m.hex.length);
        queue.unshift({ id: m.id, seqno: 0, hex: unpacked });
        if (trace) trace.gunzip += Date.now() - tg;
        continue;
      }
      if (ctor === CTOR.rpcResult) {
        const to = new Reader(fromHex(m.hex.slice(8, 24))).long();
        const entry = this.waiting.get(to);
        if (!entry) {
          // Given up (a seek, a timeout) or unknown (late, duplicated): dropped, its data never kept.
          if (this.abandoned.delete(to)) this.log("answer for an abandoned request dropped");
          else this.log("answer for an unknown request dropped");
          big.release(m.hex.length);
          continue;
        }
        let result = m.hex.slice(24);
        big.hold(result.length);
        big.release(m.hex.length);
        if (result.length >= 8 && hexU32(result, 0) === CTOR.gzipPacked) {
          const tg = trace ? Date.now() : 0;
          const packed = result.length;
          result = gunzipHex(hexBytesAt(result, 4).hex);
          big.hold(result.length);
          big.release(packed);
          if (trace) trace.gunzip += Date.now() - tg;
        }
        if (result.length >= 8 && hexU32(result, 0) === CTOR.rpcError) { big.release(result.length); this.finish(entry, null, fromRpcError(parseRpcError(new Reader(fromHex(result))))); }
        else this.finish(entry, result, null); // held by the entry until its caller takes it
        continue;
      }
      // Everything else is small: read it as bytes.
      const mBody = fromHex(m.hex);
      big.release(m.hex.length);
      const r = new Reader(mBody);
      r.int();
      switch (ctor) {
        case CTOR.newSessionCreated: {
          const firstMsgId = r.long(); r.long();
          this.state.serverSalt = r.raw(8).slice();
          // Requests sent before the server's new session began may never be answered: send those again.
          for (const w of [...this.waiting.values()]) if (w.id < firstMsgId) await this.resend(w, 0);
          break;
        }
        case CTOR.badServerSalt: {
          const bad = r.long(); r.int(); r.int();
          this.state.serverSalt = r.raw(8).slice();
          const entry = this.waiting.get(bad);
          if (entry) await this.resend(entry, 48);
          break;
        }
        case CTOR.badMsgNotification: {
          const bad = r.long(); r.int();
          const code = r.int();
          const entry = this.waiting.get(bad);
          if (!entry) break;
          if (code === 16 || code === 17 || code === 32 || code === 33) {
            if (code === 16 || code === 17) {
              // The server's own msg_id carries its clock. Ids made under the old offset may be far ahead (17), and
              // MsgIds only ever goes up: drop that floor and start a new session so the next ids follow the new clock.
              this.state.timeOffset = Number(m.id >> 32n) - Math.floor(this.now() / 1000);
              this.msgIds.last = 0n;
            }
            this.newSession();
            // Every request in flight was sent under the old session: its answer would be ignored. Send them all again.
            for (const w of [...this.waiting.values()]) await this.resend(w, code);
          } else {
            this.finish(entry, null, mtError("bad_msg", "bad_msg_notification " + code, { badMsgCode: code }));
          }
          break;
        }
        case CTOR.msgsAck:
        case CTOR.pong:
        case CTOR.msgDetailedInfo:
        case CTOR.msgNewDetailedInfo:
        case CTOR.futureSalts:
          break;
        default:
          if (this.onUpdate) { try { this.onUpdate(mBody); } catch (e) { this.log("onUpdate failed: " + (e && e.message)); } }
      }
    }
  }
}
return { Session };
})();

// ---- src/mtproto/srp.js ----
const __mod_src_mtproto_srp = (() => {
// The 2FA password check (SRP, "Two-factor authentication" in Telegram's docs) for the one algorithm Telegram uses,
// passwordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow:
//   SH(data, salt) = H(salt | data | salt)            H = SHA-256
//   PH1 = SH(SH(password, salt1), salt2)
//   PH2 = SH(pbkdf2(sha512, PH1, salt1, 100000), salt2)        x = PH2 as a big number
//   k = H(p | g)   v = g^x   A = g^a   u = H(A | B)   t = (B - k v) mod p   S = t^(a + u x)   K = H(S)
//   M1 = H(H(p) xor H(g) | H(salt1) | H(salt2) | A | B | K)
// Numbers are hashed as 256 big-endian bytes. Powers go to kino.crypto.modPow (native); PBKDF2 to kino.crypto.pbkdf2.
// The server's p and g pass the same checks as the DH exchange's (2048-bit safe prime, g generating the right subgroup),
// and B, A and t the range checks of the docs. The password is only an argument here: never kept, never logged.
const { toHex, fromHex, xor, random, bigFromBytes, bigToBytes, utf8 } = __mod_src_mtproto_bytes;
const { sha256, modPowHex } = __mod_src_mtproto_crypto;
const { checkDhPrime } = __mod_src_mtproto_authkey;
const { mtError } = __mod_src_mtproto_errors;

const SRP_ALGO = "passwordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow";
const SIZE = 256;
const protocol = (m) => mtError("protocol", m);
const evenHex = (n) => { const h = n.toString(16); return h.length % 2 ? "0" + h : h; };
const pow = (b, e, m) => BigInt("0x" + modPowHex(evenHex(b), evenHex(e), evenHex(m)));
const pad = (n) => bigToBytes(n, SIZE);
const bits = (n) => (n === 0n ? 0 : n.toString(2).length);

/** The docs' range check for g^a and g^b style values: 2^(2048-64) <= x <= p - 2^(2048-64). */
function goodModExp(x, p) {
  const diff = p - x;
  return diff > 0n && bits(diff) >= 2048 - 64 && bits(x) >= 2048 - 64 && Math.ceil(bits(x) / 8) <= SIZE;
}

/** PH2(password): the password's hash for the verifier, from the algorithm's two salts. */
function passwordHash(password, salt1, salt2) {
  const sh = (data, salt) => sha256(salt, data, salt);
  const ph1 = sh(sh(utf8(password), salt1), salt2);
  const k = kino.crypto.pbkdf2("sha512", toHex(ph1), toHex(salt1), 100000, 64, { keyEncoding: "hex", inputEncoding: "hex", outputEncoding: "hex" });
  return sh(fromHex(k), salt2);
}

/**
 * The InputCheckPasswordSRP for `password` against account.getPassword's answer: `{ algo: { _, salt1, salt2, g, p },
 * srpB, srpId }` (bytes as Uint8Array) -> `{ srpId, A, M1 }`. `aBytes` (256 bytes) is for the test vector only; in use
 * `a` is random. Throws `protocol` when the server's numbers fail a check (nothing is sent then).
 */
function srpCheck({ algo, srpB, srpId }, password, { aBytes } = {}) {
  if (!algo || algo._ !== SRP_ALGO) throw mtError("invalid_request", "unsupported 2FA password algorithm");
  if (typeof password !== "string" || !password) throw mtError("invalid_request", "the password is empty");
  if (!(algo.p instanceof Uint8Array) || algo.p.length !== SIZE) throw protocol("2FA p is not 2048 bits");
  if (!(srpB instanceof Uint8Array) || srpB.length === 0 || srpB.length > SIZE) throw protocol("2FA srp_B has a bad length");
  const p = bigFromBytes(algo.p);
  const g = Number(algo.g);
  checkDhPrime(p, g); // a 2048-bit safe prime with a good g, as for the auth key
  const B = bigFromBytes(srpB);
  if (!(B > 1n && B < p - 1n)) throw protocol("2FA srp_B out of range");
  const x = bigFromBytes(passwordHash(password, algo.salt1, algo.salt2));
  const pBytes = pad(p), gBytes = pad(BigInt(g)), bBytes = pad(B);
  const k = bigFromBytes(sha256(pBytes, gBytes));
  const v = pow(BigInt(g), x, p);
  const t = (((B - ((k * v) % p)) % p) + p) % p;
  if (!goodModExp(t, p)) throw protocol("2FA srp_B is not a good value");
  let a, A, u;
  for (let tries = 0; ; tries++) {
    if (tries >= 8) throw protocol("2FA: no good random value");
    a = bigFromBytes(aBytes && tries === 0 ? aBytes : random(SIZE));
    A = pow(BigInt(g), a, p);
    if (!goodModExp(A, p)) { if (aBytes) throw protocol("2FA: the given a is not good"); continue; }
    u = bigFromBytes(sha256(pad(A), bBytes));
    if (u > 0n) break;
  }
  const S = pow(t, a + u * x, p);
  const K = sha256(pad(S));
  const M1 = sha256(xor(sha256(pBytes), sha256(gBytes)), sha256(algo.salt1), sha256(algo.salt2), pad(A), bBytes, K);
  return { srpId, A: pad(A), M1 };
}
return { SRP_ALGO, passwordHash, srpCheck };
})();

// ---- src/mtproto/requests.js ----
const __mod_src_mtproto_requests = (() => {
// Serialized API methods for the discovery (layer 198), written field by field from their TL lines:
// updates.getState#edd4882a = updates.State
// updates.getDifference#19c2f763 flags:# pts:int pts_limit:flags.1?int pts_total_limit:flags.0?int date:int qts:int qts_limit:flags.2?int
// updates.getChannelDifference#3173d78 flags:# force:flags.0?true channel:InputChannel filter:ChannelMessagesFilter pts:int limit:int
// channels.getMessages#ad8c9a23 channel:InputChannel id:Vector<InputMessage>
// messages.getMessages#63c66506 id:Vector<InputMessage>
// inputChannel#f35aec28 channel_id:long access_hash:long   inputMessageID#a676a322 id:int   channelMessagesFilterEmpty#94d42ee7
const { Writer, CTOR } = __mod_src_mtproto_tl;

/**
 * The ONLY methods TelegramClient.call sends: the five the discovery needs. A new method for the plugin shell is added
 * here, in this one list, never per call site. Anything else (auth methods, the invoke and initConnection wrappers, gzip_packed,
 * msg_container, destructive methods) is refused by the client before a byte goes out.
 */
const BOT_CALLS = Object.freeze([
  0xedd4882a, // updates.getState
  0x19c2f763, // updates.getDifference
  0x03173d78, // updates.getChannelDifference
  0xad8c9a23, // channels.getMessages
  0x63c66506, // messages.getMessages
]);
/** Kept for the bot path's callers and tests: the bot's list. */
const ALLOWED_CALLS = BOT_CALLS;

/**
 * Account mode (0.3.0, the person's own Telegram account) is READ ONLY: a closed list of reading methods, nothing that
 * sends, edits, deletes, forwards, marks read, joins, leaves or changes anything. updates.* are not needed (the account's
 * chats are read by search, not by the update boxes).
 */
const ACCOUNT_CALLS = Object.freeze([
  0xa0f4cb4f, // messages.getDialogs: which chats there are
  0x29ee847a, // messages.search: a chat's videos (inputMessagesFilterVideo / inputMessagesFilterDocument, empty q)
  0x63c66506, // messages.getMessages: re-read a message (a fresh file_reference) in a basic group or Saved Messages
  0xad8c9a23, // channels.getMessages: the same in a channel or supergroup
]);
/** The account's login and logout methods: only through the client's own login calls, never through `call`. */
const ACCOUNT_AUTH_CALLS = Object.freeze([
  0xb7e085fe, // auth.exportLoginToken
  0x95ac5ce4, // auth.importLoginToken
  0x548a30f5, // account.getPassword
  0xd18b4d16, // auth.checkPassword
  0x3e72ba19, // auth.logOut
]);

const big = (v) => (typeof v === "bigint" ? v : BigInt(v));
const inputChannel = (w, channelId, accessHash) => w.int(0xf35aec28).long(big(channelId)).long(big(accessHash));
const inputMessageIds = (w, ids) => { w.int(CTOR.vector).int(ids.length); for (const id of ids) w.int(0xa676a322).int(id); return w; };

const getState = () => new Writer().int(0xedd4882a).done();

const getDifference = ({ pts, date, qts }) => new Writer().int(0x19c2f763).int(0).int(pts).int(date).int(qts).done();

const getChannelDifference = ({ channelId, accessHash, pts, limit = 100, force = false }) =>
  inputChannel(new Writer().int(0x03173d78).int(force ? 1 : 0), channelId, accessHash).int(0x94d42ee7).int(pts).int(limit).done();

const channelsGetMessages = ({ channelId, accessHash, ids }) =>
  inputMessageIds(inputChannel(new Writer().int(0xad8c9a23), channelId, accessHash), ids).done();

const messagesGetMessages = (ids) => inputMessageIds(new Writer().int(0x63c66506), ids).done();

// ---- account mode (read only) ----
// inputPeerSelf#7da07ec9  inputPeerChat#35a95cb9 chat_id:long  inputPeerChannel#27bcbbfc channel_id:long access_hash:long
// inputPeerUser#dde8a54c user_id:long access_hash:long
// inputPeerEmpty#7f3b18ea  inputMessagesFilterVideo#9fc00e65  inputMessagesFilterDocument#9eddf188
// messages.getDialogs#a0f4cb4f flags:# exclude_pinned:flags.0?true folder_id:flags.1?int offset_date:int offset_id:int
//   offset_peer:InputPeer limit:int hash:long
// messages.search#29ee847a flags:# peer:InputPeer q:string from_id:flags.0?InputPeer saved_peer_id:flags.2?InputPeer
//   saved_reaction:flags.3?Vector<Reaction> top_msg_id:flags.1?int filter:MessagesFilter min_date:int max_date:int
//   offset_id:int add_offset:int limit:int max_id:int min_id:int hash:long
const FILTER = Object.freeze({ video: 0x9fc00e65, document: 0x9eddf188 });

/** An InputPeer: { kind: "self" } | { kind: "chat", id } | { kind: "channel" | "user", id, accessHash } | { kind: "empty" }. */
function inputPeer(w, peer) {
  if (!peer || peer.kind === "empty") return w.int(0x7f3b18ea);
  if (peer.kind === "self") return w.int(0x7da07ec9);
  if (peer.kind === "chat") return w.int(0x35a95cb9).long(big(peer.id));
  if (peer.kind === "channel") return w.int(0x27bcbbfc).long(big(peer.id)).long(big(peer.accessHash));
  if (peer.kind === "user") return w.int(0xdde8a54c).long(big(peer.id)).long(big(peer.accessHash)); // a dialog cursor only
  throw new Error("unknown peer kind");
}

const getDialogs = ({ offsetDate = 0, offsetId = 0, offsetPeer = null, limit = 100 } = {}) =>
  inputPeer(new Writer().int(0xa0f4cb4f).int(0).int(offsetDate).int(offsetId), offsetPeer).int(limit).long(0n).done();

const searchMessages = ({ peer, filter, offsetId = 0, minId = 0, limit = 100 }) =>
  inputPeer(new Writer().int(0x29ee847a).int(0), peer).string("").int(filter).int(0).int(0).int(offsetId).int(0).int(limit).int(0).int(minId).long(0n).done();
return { BOT_CALLS, ALLOWED_CALLS, ACCOUNT_CALLS, ACCOUNT_AUTH_CALLS, getState, getDifference, getChannelDifference, channelsGetMessages, messagesGetMessages, FILTER, inputPeer, getDialogs, searchMessages };
})();

// ---- src/mtproto/sync-requests.js ----
const __mod_src_mtproto_sync_requests = (() => {
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
const { Writer, CTOR, Reader } = __mod_src_mtproto_tl;
const { mtError } = __mod_src_mtproto_errors;
const { utf8 } = __mod_src_mtproto_bytes;

const M = Object.freeze({
  saveFilePart: 0xb304a621,
  sendMedia: 0x7852834e,
  updatePinnedMessage: 0xd2aaf7ec,
  deleteMessages: 0xe58e95d2,
  search: 0x29ee847a,
});
const INPUT_PEER_SELF = 0x7da07ec9;
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
const SYNC_CALLS = Object.freeze([M.saveFilePart, M.sendMedia, M.updatePinnedMessage, M.deleteMessages, M.search]);
/**
 * Where the InputPeer sits in the body of each method that names one: always right after the method id and its flags
 * word. The client refuses such a body unless the 4 bytes there are inputPeerSelf.
 */
const SELF_PEER_OFFSET = Object.freeze({ [M.sendMedia]: 8, [M.updatePinnedMessage]: 8, [M.search]: 8 });

/** Telegram's part rules for upload.saveFilePart (files under 10 MB): 128 KiB divides 512 KiB and is a multiple of 1 KiB. */
const PART_BYTES = 131072;
const MAX_FILE_BYTES = 4194304;
const MAX_PARTS = MAX_FILE_BYTES / PART_BYTES;
const SNAPSHOT_NAME = "kino-sync.bin";
const MIME = "application/octet-stream";

const ids = (list) => {
  if (!Array.isArray(list) || !list.length || list.length > 100) throw mtError("invalid_request", "1 to 100 message ids");
  for (const id of list) if (!Number.isInteger(id) || id <= 0 || id > 0x7fffffff) throw mtError("invalid_request", "a message id is a positive int");
  return list;
};

/** One part of the file being uploaded: `bytes` (a Uint8Array) is exactly PART_BYTES long, except for the last part. */
function saveFilePart({ fileId, part, bytes }) {
  if (typeof fileId !== "bigint") throw mtError("invalid_request", "fileId is a BigInt");
  if (!Number.isInteger(part) || part < 0 || part >= MAX_PARTS) throw mtError("invalid_request", "part out of range");
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > PART_BYTES) throw mtError("invalid_request", "a part is 1 to " + PART_BYTES + " bytes");
  return new Writer().int(M.saveFilePart).long(fileId).int(part).bytes(bytes).done();
}

/**
 * Sends the uploaded file to Saved Messages as a document named SNAPSHOT_NAME, silently (flag 5), with no caption
 * unless `caption` is given. `randomId` is a BigInt the caller keeps to find the new message id in the answer.
 */
function sendSnapshot({ fileId, parts, randomId, caption = "" }) {
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
function pinSnapshot(id) {
  ids([id]);
  return new Writer().int(M.updatePinnedMessage).int(1).int(INPUT_PEER_SELF).int(id).done();
}

/**
 * Deletes messages by id, without revoke (Saved Messages has no other side, and a wrong id could only ever go on the
 * person's side). The client accepts it only for ids it saw in an answer about Saved Messages.
 */
function deleteSnapshots(list) {
  return new Writer().int(M.deleteMessages).int(0).vectorInt(ids(list)).done();
}

/**
 * The pinned messages of Saved Messages, newest first, at most `limit`. `minId`/`maxId` bound the ids (0: no bound):
 * minId = id - 1, maxId = id + 1 re-reads one message (a fresh file_reference) without leaving Saved Messages.
 */
function searchPinned({ limit = 100, minId = 0, maxId = 0 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw mtError("invalid_request", "limit 1 to 100");
  for (const v of [minId, maxId]) if (!Number.isInteger(v) || v < 0 || v > 0x7fffffff) throw mtError("invalid_request", "an id bound is a non-negative int");
  return new Writer().int(M.search).int(0).int(INPUT_PEER_SELF).string("").int(FILTER_PINNED)
    .int(0).int(0).int(0).int(0).int(limit).int(maxId).int(minId).long(0n).done();
}

/** Bool -> true/false; anything else is a protocol error. */
function parseBool(u8) { return new Reader(u8).bool(); }

/** messages.affectedMessages -> { pts, ptsCount }. */
function parseAffectedMessages(u8) {
  const r = new Reader(u8);
  if (r.int() !== AFFECTED_MESSAGES) throw mtError("protocol", "unexpected answer to messages.deleteMessages");
  return { pts: r.int32(), ptsCount: r.int32() };
}
return { M, INPUT_PEER_SELF, SYNC_CALLS, SELF_PEER_OFFSET, PART_BYTES, MAX_FILE_BYTES, MAX_PARTS, SNAPSHOT_NAME, saveFilePart, sendSnapshot, pinSnapshot, deleteSnapshots, searchPinned, parseBool, parseAffectedMessages };
})();

// ---- src/mtproto/phone-requests.js ----
const __mod_src_mtproto_phone_requests = (() => {
// Sync-Gram Cuenta's phone sign-in (1.1.0): a phone cannot scan its own QR, so it signs in with its number and the code
// Telegram sends. These two methods go on the LOGIN list of the `sync` client mode only (client.js authInvoke), never
// through `call`. Not vendored: Sync-Gram Cuenta's own code, next to requests.js because that is where it would go
// upstream. Checked by hand against the layer-198 TL schema (gramjs tl/apiTl.js, the source the Library's schema was
// generated from):
// auth.sendCode#a677244f phone_number:string api_id:int api_hash:string settings:CodeSettings = auth.SentCode
// codeSettings#ad253d78 flags:# allow_flashcall:flags.0?true current_number:flags.1?true allow_app_hash:flags.4?true
//   allow_missed_call:flags.5?true allow_firebase:flags.7?true unknown_number:flags.9?true logout_tokens:flags.6?Vector<bytes>
//   token:flags.8?string app_sandbox:flags.8?Bool = CodeSettings
// auth.signIn#8d52a951 flags:# phone_number:string phone_code_hash:string phone_code:flags.0?string
//   email_verification:flags.1?EmailVerification = auth.Authorization
// auth.sentCode#5e002502 flags:# type:auth.SentCodeType phone_code_hash:string next_type:flags.1?auth.CodeType
//   timeout:flags.2?int = auth.SentCode
// auth.sentCodeSuccess#2390fe44 authorization:auth.Authorization = auth.SentCode
// auth.sentCodeTypeApp#3dbb5986 length:int   auth.sentCodeTypeSms#c000bba2 length:int   auth.sentCodeTypeCall#5353e5a7 length:int
// auth.sentCodeTypeFlashCall#ab03c6d9 pattern:string   auth.sentCodeTypeMissedCall#82006484 prefix:string length:int
// auth.sentCodeTypeEmailCode#f450f59b flags:# apple_signin_allowed:flags.0?true google_signin_allowed:flags.1?true
//   email_pattern:string length:int reset_available_period:flags.3?int reset_pending_date:flags.4?int
// auth.sentCodeTypeSetUpEmailRequired#a5491dea flags:# apple_signin_allowed:flags.0?true google_signin_allowed:flags.1?true
// auth.sentCodeTypeFragmentSms#d9565c39 url:string length:int
// auth.sentCodeTypeFirebaseSms#9fd736 flags:# nonce:flags.0?bytes play_integrity_project_id:flags.2?long
//   play_integrity_nonce:flags.2?bytes receipt:flags.1?string push_timeout:flags.1?int length:int
// auth.sentCodeTypeSmsWord#a416ac81 flags:# beginning:flags.0?string   auth.sentCodeTypeSmsPhrase#b37794af (the same)
// auth.resendCode is not here: "Enviar código" again asks a new code (auth.sendCode), so the list stays at two.
const { Writer, Reader } = __mod_src_mtproto_tl;
const { mtError } = __mod_src_mtproto_errors;

const PHONE_METHOD = Object.freeze({ sendCode: 0xa677244f, signIn: 0x8d52a951 });
const PHONE_AUTH_CALLS = Object.freeze([PHONE_METHOD.sendCode, PHONE_METHOD.signIn]);
const CODE_SETTINGS = 0xad253d78;
const SENT_CODE = 0x5e002502;
const SENT_CODE_SUCCESS = 0x2390fe44;
/** A number as Telegram takes it: digits only (the country code first), 7 to 15 of them. */
const PHONE_DIGITS = /^[1-9]\d{6,14}$/;
const CODE_DIGITS = /^\d{3,8}$/;

/** auth.sendCode with plain delivery (no code setting flag). `phone` is digits only. */
function sendCode({ phone, apiId, apiHash }) {
  if (!PHONE_DIGITS.test(String(phone))) throw mtError("invalid_request", "a number is 7 to 15 digits");
  if (!Number.isInteger(apiId) || apiId <= 0 || typeof apiHash !== "string" || !apiHash) throw mtError("invalid_request", "api_id and api_hash are needed");
  return new Writer().int(PHONE_METHOD.sendCode).string(phone).int(apiId).string(apiHash).int(CODE_SETTINGS).int(0).done();
}

/** auth.signIn with the code (flag 0), never an email verification. */
function signIn({ phone, hash, code }) {
  if (!PHONE_DIGITS.test(String(phone))) throw mtError("invalid_request", "a number is 7 to 15 digits");
  if (typeof hash !== "string" || !hash) throw mtError("invalid_request", "the code hash is needed");
  if (!CODE_DIGITS.test(String(code))) throw mtError("invalid_request", "a code is digits only");
  return new Writer().int(PHONE_METHOD.signIn).int(1).string(phone).string(hash).string(String(code)).done();
}

/**
 * auth.SentCode: { kind: "code", hash, via: "app" | "sms" | "call" | "other" }, or { kind: "authorization", body } (the
 * answer already signed in: body is the auth.Authorization). A code sent by email (or one asking to set up an email)
 * throws `email_required`; an answer this layer does not know throws `protocol`.
 */
function parseSentCode(u8) {
  const r = new Reader(u8);
  const ctor = r.int();
  if (ctor === SENT_CODE_SUCCESS) return { kind: "authorization", body: u8.subarray(4) };
  if (ctor !== SENT_CODE) throw mtError("protocol", "unexpected answer to auth.sendCode");
  r.int(); // flags (next_type and timeout come after the hash: not read)
  const type = r.int();
  let via;
  switch (type) {
    case 0x3dbb5986: r.int(); via = "app"; break;
    case 0xc000bba2: r.int(); via = "sms"; break;
    case 0x5353e5a7: r.int(); via = "call"; break;
    case 0xab03c6d9: r.string(); via = "call"; break;
    case 0x82006484: r.string(); r.int(); via = "call"; break;
    case 0xd9565c39: r.string(); r.int(); via = "other"; break;
    case 0x009fd736: {
      const f = r.int();
      if (f & 1) r.bytes();
      if (f & 4) { r.long(); r.bytes(); }
      if (f & 2) { r.string(); r.int(); }
      r.int();
      via = "sms";
      break;
    }
    case 0xa416ac81:
    case 0xb37794af: { const f = r.int(); if (f & 1) r.string(); via = "sms"; break; }
    case 0xf450f59b:
    case 0xa5491dea:
      throw mtError("email_required", "Telegram sends this account's code by email");
    default:
      throw mtError("protocol", "unknown code type 0x" + (type >>> 0).toString(16));
  }
  return { kind: "code", hash: r.string(), via };
}
return { PHONE_METHOD, PHONE_AUTH_CALLS, PHONE_DIGITS, sendCode, signIn, parseSentCode };
})();

// ---- src/mtproto/keys.js ----
const __mod_src_mtproto_keys = (() => {
// Telegram's PUBLIC RSA server keys (from tg-public-keys.json, as used by the verified-live spike), keyed by the
// signed decimal fingerprint the server lists in resPQ. n is big-endian hex, e decimal.
const TELEGRAM_PUBLIC_KEYS = Object.freeze({
  "-3414540481677951611": {
    "n": "e8bb3305c0b52c6cf2afdf7637313489e63e05268e5badb601af417786472e5f93b85438968e20e6729a301c0afc121bf7151f834436f7fda680847a66bf64accec78ee21c0b316f0edafe2f41908da7bd1f4a5107638eeb67040ace472a14f90d9f7c2b7def99688ba3073adb5750bb02964902a359fe745d8170e36876d4fd8a5d41b2a76cbff9a13267eb9580b2d06d10357448d20d9da2191cb5d8c93982961cdfdeda629e37f1fb09a0722027696032fe61ed663db7a37f6f263d370f69db53a0dc0a1748bdaaff6209d5645485e6e001d1953255757e4b8e42813347b11da6ab500fd0ace7e6dfa3736199ccaf9397ed0745a427dcfa6cd67bcb1acff3",
    "e": 65537
  },
  "-5595554452916591101": {
    "n": "c8c11d635691fac091dd9489aedced2932aa8a0bcefef05fa800892d9b52ed03200865c9e97211cb2ee6c7ae96d3fb0e15aeffd66019b44a08a240cfdd2868a85e1f54d6fa5deaa041f6941ddf302690d61dc476385c2fa655142353cb4e4b59f6e5b6584db76fe8b1370263246c010c93d011014113ebdf987d093f9d37c2be48352d69a1683f8f6e6c2167983c761e3ab169fde5daaa12123fa1beab621e4da5935e9c198f82f35eae583a99386d8110ea6bd1abb0f568759f62694419ea5f69847c43462abef858b4cb5edc84e7b9226cd7bd7e183aa974a712c079dde85b9dc063b8a5c08e8f859c0ee5dcd824c7807f20153361a7f63cfd2a433a1be7f5",
    "e": 65537
  }
});
return { TELEGRAM_PUBLIC_KEYS };
})();

// ---- src/mtproto/client.js ----
const __mod_src_mtproto_client = (() => {
// The high-level client: one auth key per DC, a bot login once per home DC, DC migration, chunked file downloads and
// a JSON-safe state the plugin shell stores encrypted. Calls run one at a time (Kino calls `read` one at a time too).
const { toBase64, fromBase64, toHex, fromHex } = __mod_src_mtproto_bytes;
const { sha1 } = __mod_src_mtproto_crypto;
const { Transport } = __mod_src_mtproto_transport;
const { createAuthKey } = __mod_src_mtproto_authkey;
const { Session } = __mod_src_mtproto_session;
const { CTOR, LAYER, invokeWithLayer, initConnection, importBotAuthorization, exportAuthorization, importAuthorization, inputDocumentFileLocation, uploadGetFile, parseUploadFile, parseUploadFileHex, parseAuthorization, parseExportedAuthorization, exportLoginToken, importLoginToken, getPassword, checkPassword, logOut } = __mod_src_mtproto_tl;
const { decode } = __mod_src_mtproto_schema_reader;
const { srpCheck } = __mod_src_mtproto_srp;
const { mtError } = __mod_src_mtproto_errors;
const { BOT_CALLS, ACCOUNT_CALLS, ACCOUNT_AUTH_CALLS } = __mod_src_mtproto_requests;
const { SYNC_CALLS, SELF_PEER_OFFSET, INPUT_PEER_SELF, M: SYNC_METHOD } = __mod_src_mtproto_sync_requests;
const { PHONE_AUTH_CALLS, sendCode, signIn, parseSentCode } = __mod_src_mtproto_phone_requests;
const { describeError, isServerAnswer } = __mod_src_mtproto_errors;
const { big } = __mod_src_mtproto_big;
const { TELEGRAM_PUBLIC_KEYS } = __mod_src_mtproto_keys;

const CHUNK = 1048576;
const BUDGET_KEY = "mtproto.botLogins";
const BUDGET_MAX = 3;
const BUDGET_WINDOW_MS = 3600000;
const MIN_LEFT_MS = 1500;   // a request never starts with less time than this before its caller's deadline
const MARGIN_MS = 500;      // what a request leaves its caller after its own wait
const POLL_MS = 250;        // how often a call waiting for its turn checks its deadline
const MAX_AHEAD = 2;           // file chunks requested ahead and tracked (answered or still in flight), oldest dropped first:
                              // a hard count cap, so answered hex held is at most ~2 chunks whatever the timing
const MAX_AHEAD_BYTES = 5 << 20; // characters of ANSWERED read-ahead hex kept at once: ~2 chunks (a 1 MiB chunk is
                                 // ~2 MiB of hex), enough for the depth-2 read-ahead, so a runtime with no forced GC
                                 // never piles several more up
const MAX_IN_FLIGHT = 3;    // requests on one connection at once (the asked chunk included), on every path
const ROOM_WAIT_MS = 2500;  // the longest a chunk request waits for room before taking the oldest in flight as lost
const AHEAD_WAIT_MS = 8000; // the longest a read waits for a chunk requested ahead before asking for it again

/**
 * At most 3 bot logins per hour per device (Telegram answered FLOOD_WAIT_3121 after about ten in an hour). `store` is
 * kino.storage or anything with get/set of strings. Answers { allowed, remaining, retryAfterSeconds, record() };
 * record() notes a login now, or throws `login_budget` (with `seconds`) when none is left.
 */
function loginBudget(store, now = Date.now(), { key = BUDGET_KEY, max = BUDGET_MAX, what = "bot logins" } = {}) {
  let times = [];
  try {
    const v = JSON.parse(store.get(key) || "[]");
    if (Array.isArray(v)) times = v.filter((t) => typeof t === "number" && t <= now && now - t < BUDGET_WINDOW_MS).sort((a, b) => a - b);
  } catch { times = []; }
  const allowed = times.length < max;
  const retryAfterSeconds = allowed ? 0 : Math.ceil((times[0] + BUDGET_WINDOW_MS - now) / 1000);
  return {
    allowed,
    remaining: Math.max(0, max - times.length),
    retryAfterSeconds,
    record() {
      if (!allowed) throw mtError("login_budget", "too many " + what + " on this device in the last hour", { seconds: retryAfterSeconds });
      times.push(now);
      store.set(key, JSON.stringify(times));
    },
  };
}

function encodeState(dc, s) {
  const out = { dc, authKey: toBase64(s.authKey), authKeyId: toHex(s.authKeyId), serverSalt: toBase64(s.serverSalt), timeOffset: s.timeOffset | 0, loggedIn: !!s.loggedIn };
  if (s.userId !== undefined) out.userId = String(s.userId);
  return out;
}

function decodeState(v) {
  const authKey = fromBase64(String(v.authKey || ""));
  if (authKey.length !== 256) throw mtError("invalid_request", "stored auth key must be 256 bytes");
  let serverSalt = new Uint8Array(8);
  try { const s = fromBase64(String(v.serverSalt || "")); if (s.length === 8) serverSalt = s; } catch { /* a bad salt is fixed by bad_server_salt */ }
  const s = { authKey, authKeyId: sha1(authKey).slice(12, 20), serverSalt, timeOffset: Number(v.timeOffset) | 0, loggedIn: v.loggedIn === true };
  if (v.userId !== undefined) s.userId = BigInt(v.userId);
  return s;
}

// `call` sends only what is on the mode's allowlist (requests.js): the first 4 bytes of the body must be one of those
// method ids. Account mode is read only (ACCOUNT_CALLS); its login methods go only through the login calls below.
// Sync mode (Sync-Gram, local patch: sync-requests.js) signs in as account mode does and may write, to Saved Messages
// only: SYNC_CALLS, and every one of them that names a peer must name inputPeerSelf (checked on the body's bytes).
const ALLOWED = Object.freeze({ bot: new Set(BOT_CALLS), account: new Set(ACCOUNT_CALLS), sync: new Set(SYNC_CALLS) });
const LOGIN_MODES = new Set(["account", "sync"]);
const SELF_IDS_MAX = 1000; // Saved Messages ids a sync client remembers from its answers (the oldest go first)
const u32At = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const ACCOUNT_AUTH = new Set(ACCOUNT_AUTH_CALLS);
// Sync mode (local patch): its login list adds the phone sign-in (phone-requests.js); account mode's stays as it was.
const SYNC_AUTH = new Set([...ACCOUNT_AUTH_CALLS, ...PHONE_AUTH_CALLS]);
const methodId = (body) => (body[0] | (body[1] << 8) | (body[2] << 16) | (body[3] << 24)) >>> 0;
/** 2FA password attempts per device and hour (each one is a guess Telegram counts). */
const PASSWORD_BUDGET = Object.freeze({ key: "mtproto.passwordTries", max: 5, what: "password attempts" });

const DEFAULT_DEVICE = Object.freeze({ deviceModel: "Kino", systemVersion: "Android", appVersion: "1.0", systemLangCode: "en", langPack: "", langCode: "en" });

function checkRange(offset, limit) {
  if (!Number.isInteger(offset) || offset < 0 || offset % 4096 !== 0) throw mtError("invalid_request", "offset must be a non-negative multiple of 4096");
  if (!Number.isInteger(limit) || limit <= 0 || limit % 4096 !== 0 || CHUNK % limit !== 0) throw mtError("invalid_request", "limit must be a multiple of 4096 that divides 1 MiB");
  if (Math.floor(offset / CHUNK) !== Math.floor((offset + limit - 1) / CHUNK)) throw mtError("invalid_request", "a chunk may not cross a 1 MiB boundary");
}

class TelegramClient {
  /**
   * `apiId` is needed for initConnection on every new connection. `publicKeys` defaults to Telegram's (tests inject a
   * fake DC's). `store` is REQUIRED: kino.storage (or any get/set of strings) for the login budget, which keeps a
   * burst of bot logins from earning a FLOOD_WAIT of almost an hour; only a test may pass `store: false` to go without.
   * `wsOpen`/`urlFor` are for tests and other transports.
   */
  constructor({ apiId, publicKeys = TELEGRAM_PUBLIC_KEYS, device = {}, store, timeoutMs = 20000, now = () => Date.now(), log = () => {}, onUpdate = null, wsOpen, urlFor, abandonedMs, mode = "bot" } = {}) {
    if (mode !== "bot" && mode !== "account" && mode !== "sync") throw mtError("invalid_request", "mode is bot, account or sync");
    this.mode = mode;
    this.abandonedMs = abandonedMs;
    this.maxInflight = 0; // the most requests ever in flight on one connection at a send (tests)
    if (store === false) store = null;
    else if (!store || typeof store.get !== "function" || typeof store.set !== "function") {
      throw mtError("invalid_request", "TelegramClient needs `store` (kino.storage) for the bot login budget; only tests may pass store: false");
    }
    this.apiId = apiId;
    this.publicKeys = publicKeys;
    this.device = { ...DEFAULT_DEVICE, ...device };
    this.store = store;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.log = log;
    this.onUpdate = onUpdate;
    this.wsOpen = wsOpen;
    this.urlFor = urlFor;
    this.homeDc = null;
    this.dcs = new Map();   // dc -> { authKey, authKeyId, serverSalt, timeOffset, loggedIn, userId? }
    this.conns = new Map(); // dc -> { transport, session, inited }
    this.chain = Promise.resolve();
    this.ahead = new Map(); // "<doc id>:<offset>" -> { dc, session, entry, limit }, in request order
    this.lastActiveAt = this.now(); // when a chunk request last ran: an idle runtime drops its caches (idleReset)
    this.selfIds = new Set(); // sync mode: message ids answered about Saved Messages (a self search, our sendMedia)
  }

  /** Sync mode: the ids of messages an answer about Saved Messages named (never throws: a bad answer adds nothing). */
  learnSelfIds(id, res) {
    const add = (n) => {
      if (!Number.isInteger(n) || n <= 0) return;
      this.selfIds.delete(n);
      this.selfIds.add(n);
      while (this.selfIds.size > SELF_IDS_MAX) this.selfIds.delete(this.selfIds.values().next().value);
    };
    try {
      if (id === SYNC_METHOD.search) for (const m of decode(res, { expect: "messages.Messages" }).messages || []) add(m.id);
      if (id === SYNC_METHOD.sendMedia) {
        for (const u of decode(res, { expect: "Updates" }).updates || []) {
          if (u._ === "updateMessageID") add(u.id);
          if (u._ === "updateNewMessage" && u.message) add(u.message.id);
        }
      }
    } catch (e) {
      this.log("answer not read for the delete guard (" + describeError(e) + ")");
    }
  }

  /** Sync mode: a deleteMessages body is flags 0 and a vector of ids this client saw in Saved Messages, nothing else. */
  checkSelfDelete(body) {
    const refuse = () => { throw mtError("invalid_request", "sync mode deletes only messages it saw in Saved Messages"); };
    if (body.length < 16 || u32At(body, 4) !== 0 || u32At(body, 8) !== CTOR.vector) refuse();
    const n = u32At(body, 12);
    if (n < 1 || n > 100 || body.length !== 16 + 4 * n) refuse();
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(u32At(body, 16 + 4 * i) | 0);
    if (!ids.every((x) => this.selfIds.has(x))) refuse();
    return ids;
  }

  /** How many chunks requested ahead are kept (tests). */
  aheadCount() { return this.ahead.size; }
  /** Characters of answered read-ahead hex held right now (in-flight entries hold nothing yet). */
  aheadBytes() { let n = 0; for (const a of this.ahead.values()) if (a.entry.done && a.entry.result) n += a.entry.result.length; return n; }

  /**
   * Frees everything a finished play leaves behind when the runtime has been idle for `idleMs`: the read-ahead cache
   * (hex chunks) and the open connection (its transport buffers and session). The next read reconnects with the stored
   * key (no key exchange, no login). There is no "stream closed" hook from Kino, so this is where retention is bounded
   * between plays.
   */
  async idleReset(idleMs) {
    if ((this.ahead.size || this.conns.size) && this.now() - this.lastActiveAt >= idleMs) {
      this.log("idle " + Math.round((this.now() - this.lastActiveAt) / 1000) + " s: releasing caches and the connection");
      await this.reset();
    }
  }

  /**
   * Tears everything down after a failure the caller cannot place: every connection closes (the requests in flight on
   * them are dropped), the chunks read ahead are forgotten. The keys and logins stay: the next call reconnects with
   * them, with no key exchange and no new login.
   */
  reset() {
    return this.serial(async () => {
      for (const [k, a] of [...this.ahead]) this.dropAhead(k, a);
      for (const dc of [...this.conns.keys()]) await this.drop(dc);
    });
  }

  /**
   * Runs `fn` after the calls already queued (one at a time). With a `deadline` (a time of `now()`), the call is
   * dropped unsent when its turn comes too late, and a caller queued behind a busy client gets a typed timeout at its
   * deadline instead of waiting for its turn (`kino.sleep` polls; it is only used while the client is busy).
   */
  serial(fn, deadline, trace) {
    const queuedAt = trace ? Date.now() : 0;
    const busy = this.pending > 0;
    this.pending = (this.pending || 0) + 1;
    const turn = () => {
      if (trace) trace.queue += Date.now() - queuedAt;
      if (deadline !== undefined && this.now() > deadline - MIN_LEFT_MS) throw mtError("timeout", "no time left before the caller's deadline", { deadline: true });
      return fn();
    };
    const run = this.chain.then(turn, turn);
    this.chain = run.then(() => { this.pending--; }, () => { this.pending--; });
    if (!busy || deadline === undefined || typeof kino === "undefined" || typeof kino.sleep !== "function") return run;
    let settled = false;
    run.then(() => { settled = true; }, () => { settled = true; });
    const watch = (async () => {
      for (;;) {
        const left = deadline - MIN_LEFT_MS - this.now();
        if (settled) return new Promise(() => {}); // the call won: this side never answers
        if (left <= 0) throw mtError("timeout", "the client stayed busy past the caller's deadline", { deadline: true });
        await kino.sleep(Math.min(POLL_MS, left));
      }
    })();
    return Promise.race([run, watch]);
  }

  /** The wait of one request: the client's timeout, or less when the caller's `deadline` is closer (typed timeout when too close). */
  budget(deadline) {
    if (deadline === undefined || deadline === null || !Number.isFinite(deadline)) return { ms: this.timeoutMs, clamped: false };
    const left = deadline - this.now() - MARGIN_MS;
    if (left < MIN_LEFT_MS - MARGIN_MS) throw mtError("timeout", "no time left before the caller's deadline", { deadline: true });
    return left < this.timeoutMs ? { ms: left, clamped: true } : { ms: this.timeoutMs, clamped: false };
  }

  /** Takes a state from exportState() (all DCs) or one DC's entry of it. */
  importState(state) {
    if (!state || typeof state !== "object") return;
    if (state.dcs && typeof state.dcs === "object") {
      for (const [k, v] of Object.entries(state.dcs)) this.dcs.set(Number(k), decodeState(v));
      if (state.homeDc) this.homeDc = Number(state.homeDc);
    } else if (state.authKey) {
      this.dcs.set(Number(state.dc), decodeState(state));
    }
  }

  /** { homeDc, dcs: { "<dc>": { dc, authKey (base64), authKeyId (hex), serverSalt (base64), timeOffset, loggedIn, userId? } } } */
  exportState() {
    const dcs = {};
    for (const [dc, s] of this.dcs) dcs[String(dc)] = encodeState(dc, s);
    return { homeDc: this.homeDc, dcs };
  }

  /** Connects to the home DC (`state.homeDc` wins over `dc` when a full state is given), reusing a stored key. */
  connect(dc, state, { deadline } = {}) {
    return this.serial(async () => {
      this.importState(state);
      if (!(state && state.homeDc)) this.homeDc = Number(dc);
      await this.conn(this.homeDc, deadline);
      return this;
    }, deadline);
  }

  async conn(dc, deadline) {
    let c = this.conns.get(dc);
    if (c && !c.transport.closed && !c.session.broken) return c;
    if (c) await this.drop(dc);
    const transport = await new Transport(dc, { open: this.wsOpen, url: this.urlFor ? this.urlFor(dc) : undefined }).open();
    let st = this.dcs.get(dc);
    if (!st) {
      try {
        st = { ...(await createAuthKey(transport, { dc, publicKeys: this.publicKeys, now: this.now, timeoutMs: this.budget(deadline).ms })), loggedIn: false };
      } catch (e) {
        await transport.close();
        throw e;
      }
      this.dcs.set(dc, st);
    }
    let session;
    try {
      session = new Session(transport, st, { now: this.now, timeoutMs: this.timeoutMs, onUpdate: this.onUpdate, log: this.log, ...(this.abandonedMs !== undefined ? { abandonedMs: this.abandonedMs } : {}) });
    } catch (e) {
      await transport.close();
      throw e;
    }
    c = { transport, session, inited: false };
    this.conns.set(dc, c);
    return c;
  }

  async drop(dc) {
    const c = this.conns.get(dc);
    this.conns.delete(dc);
    for (const [k, a] of [...this.ahead]) if (a.dc === dc) this.dropAhead(k, a); // their answers die with the connection
    if (c) await c.transport.close();
  }

  /** Forgets one chunk read ahead: an answered one gives its result back, one in flight is abandoned. */
  dropAhead(k, a) {
    this.ahead.delete(k);
    if (a.entry.done) { if (a.entry.result) big.release(a.entry.result.length); a.entry.result = null; }
    else a.session.forget(a.entry);
  }

  /**
   * One API call on DC `dc`; the first call of each connection goes inside invokeWithLayer(initConnection(...)).
   * A closed socket is retried once on a new connection unless `retry` is false (the bot login retries by itself, so
   * that every attempt spends the budget). `hex` answers the result as a hex string (Session.call).
   */
  async invoke(dc, body, { retry = true, hex = false, deadline, trace, after, before } = {}) {
    const c = await this.conn(dc, deadline);
    const wrapped = c.inited ? body : invokeWithLayer(LAYER, initConnection({ apiId: this.apiId, ...this.device }, body));
    const wait = this.budget(deadline);
    try {
      // `before` makes room on the connection first (a chunk request waits for fewer than 3 in flight). When the room
      // does not come (requests that never answer), the connection goes: that takes them off the wire, and a new one
      // (stored key, no key exchange, no login) starts with nothing in flight. A failure while waiting (a socket that
      // closed) is handled below like any other.
      if (before && (await before(c)) === false) {
        this.log("no room on the connection: reconnecting");
        await this.drop(dc);
        return this.invoke(dc, body, { retry, hex, deadline, trace, after });
      }
      const started = this.now();
      const entry = await c.session.request(wrapped, { hex, trace });
      this.maxInflight = Math.max(this.maxInflight, c.session.maxInflight);
      // `after` sends more requests right behind this one, on a connection already initialised: never a failure of its own.
      if (after && c.inited) { try { await after(c); } catch (e) { this.log("request ahead not sent (" + describeError(e) + ")"); } }
      const res = await c.session.settle(entry, started + wait.ms);
      c.inited = true;
      return res;
    } catch (thrown) {
      // Anything may be thrown from below (a native failure is not always an Error): read it through `e`.
      const e = thrown && typeof thrown === "object" ? thrown : { code: undefined, thrown };
      if (e.code === "closed" && retry) {
        await this.drop(dc);
        return this.invoke(dc, body, { retry: false, hex, deadline, trace, before, after });
      }
      // A connection in an unknown state is never used again: the next call reconnects with the stored key.
      if (e.code === "timeout" || e.code === "closed" || e.code === "protocol" || !isServerAnswer(e) || c.session.broken) await this.drop(dc);
      if (e.code === "timeout" && wait.clamped) e.deadline = true; // the caller's deadline, not the server's silence alone
      if (e.code === "auth_key_unregistered") {
        // A key the server forgot (-404), refuses (AUTH_KEY_INVALID) or sees on two connections at once
        // (AUTH_KEY_DUPLICATED: e.g. a copy restored on another device) is dead: drop it, the next call makes a new one.
        // Any other 401 (AUTH_KEY_UNREGISTERED, SESSION_REVOKED...) keeps the key and only needs a new login.
        if (e.transport || /^AUTH_KEY_(INVALID|DUPLICATED)$/.test(String(e.rpc || ""))) { await this.drop(dc); this.dcs.delete(dc); }
        else { const st = this.dcs.get(dc); if (st) st.loggedIn = false; }
      }
      throw thrown;
    }
  }

  /**
   * Logs the bot in on the home DC once: a DC already logged in (also from a stored state) sends nothing and answers
   * { reused: true, userId }. Follows USER_MIGRATE_n (the home DC changes only when the login there succeeds) and
   * retries once after a closed socket. Every attempt sent, migrations and retries included, spends a budget slot.
   */
  /** Whether the home DC still needs a bot login (no key there yet, or a key not logged in). */
  needsLogin() {
    const home = this.homeDc ? this.dcs.get(this.homeDc) : null;
    return !(home && home.loggedIn);
  }

  botLogin({ apiId, apiHash, botToken, deadline }) {
    if (this.mode !== "bot") return Promise.reject(mtError("invalid_request", "botLogin is for bot mode"));
    return this.serial(async () => {
      if (apiId !== undefined) this.apiId = Number(apiId);
      if (!this.homeDc) throw mtError("invalid_request", "connect first");
      if (!apiHash || !botToken || !this.apiId) throw mtError("invalid_request", "apiId, apiHash and botToken are required");
      const home = this.dcs.get(this.homeDc);
      if (home && home.loggedIn) return { reused: true, userId: home.userId };
      let dc = this.homeDc;
      let hops = 0, closedRetries = 0;
      for (;;) {
        if (this.store) loginBudget(this.store, this.now()).record();
        try {
          const auth = parseAuthorization(await this.invoke(dc, importBotAuthorization({ apiId: this.apiId, apiHash, botToken }), { retry: false, deadline }));
          if (auth.ctor !== CTOR.authAuthorization) throw mtError("protocol", "unexpected answer to the bot login");
          const st = this.dcs.get(dc);
          st.loggedIn = true;
          st.userId = auth.userId;
          this.homeDc = dc;
          return { userId: auth.userId };
        } catch (e) {
          if (e.code === "user_migrate" && hops < 2 && e.dc !== dc) { hops++; dc = e.dc; continue; }
          if (e.code === "closed" && closedRetries < 1) { closedRetries++; continue; }
          throw e;
        }
      }
    }, deadline);
  }

  /**
   * One raw API call on the home DC for the logged-in bot: `body` is the serialized method (a Uint8Array), the answer
   * is the result's bytes (unzipped; decode them with schema/reader.js). Server errors come back typed (errors.js).
   * Refused with `invalid_request` before a login, and for any method not on ALLOWED_CALLS (requests.js): auth
   * methods, invoke wrappers, gzip_packed, msg_container and every other method are never sent.
   */
  call(body, { deadline } = {}) {
    let deleting = null; // sync mode: the ids a deleteMessages names, checked against selfIds
    let id;
    try {
      if (!(body instanceof Uint8Array) || body.length < 4) throw mtError("invalid_request", "call needs the serialized method as a Uint8Array");
      id = methodId(body);
      if (!ALLOWED[this.mode].has(id)) throw mtError("invalid_request", "method 0x" + id.toString(16).padStart(8, "0") + " is not allowed through call in " + this.mode + " mode (requests.js)");
      if (this.mode === "sync" && SELF_PEER_OFFSET[id] !== undefined) {
        const at = SELF_PEER_OFFSET[id];
        if (body.length < at + 4 || u32At(body, at) !== INPUT_PEER_SELF) {
          throw mtError("invalid_request", "sync mode writes and reads only Saved Messages (inputPeerSelf)");
        }
      }
      if (this.mode === "sync" && id === SYNC_METHOD.deleteMessages) deleting = this.checkSelfDelete(body);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.serial(async () => {
      if (!this.homeDc) throw mtError("invalid_request", "connect first");
      const st = this.dcs.get(this.homeDc);
      if (!st || !st.loggedIn) throw mtError("invalid_request", "log in first");
      // sendMedia makes a message: a closed socket after the server took it must not send it again (sync mode).
      const res = await this.invoke(this.homeDc, body, { deadline, retry: !(this.mode === "sync" && id === SYNC_METHOD.sendMedia) });
      if (this.mode === "sync") {
        if (deleting) for (const x of deleting) this.selfIds.delete(x);
        else this.learnSelfIds(id, res);
      }
      return res;
    }, deadline);
  }

  // ---- account mode: the QR login, the 2FA password and the logout ----

  /**
   * One account login method on DC `dc` (ACCOUNT_AUTH_CALLS; in sync mode also the phone sign-in), decoded as `expect`,
   * or the answer's bytes when `expect` is null.
   */
  async authInvoke(dc, body, expect, deadline) {
    if (!LOGIN_MODES.has(this.mode)) throw mtError("invalid_request", "account login methods are for account mode");
    const id = methodId(body);
    if (!(this.mode === "sync" ? SYNC_AUTH : ACCOUNT_AUTH).has(id)) throw mtError("invalid_request", "not an account login method");
    // Asking for a token or for the password's parameters again changes nothing: those two may retry a closed socket.
    // A code request (an SMS, a message) and a sign-in never go twice.
    const idempotent = id === 0xb7e085fe || id === 0x548a30f5;
    const res = await this.invoke(dc, body, { retry: idempotent, deadline });
    return expect ? decode(res, { expect }) : res;
  }

  /**
   * Sync mode: asks Telegram to send the sign-in code to `phone` (digits only). Follows PHONE_MIGRATE_n /
   * NETWORK_MIGRATE_n (at most two hops): the DC that answered becomes the home DC, where signIn and the 2FA step go.
   * Answers { hash, via } (the code hash, never logged), or { userId } when Telegram signed in at once. Never retried.
   */
  phoneSendCode({ phone, apiHash, deadline } = {}) {
    if (this.mode !== "sync") return Promise.reject(mtError("invalid_request", "the phone sign-in is for sync mode"));
    return this.serial(async () => {
      if (!this.homeDc) throw mtError("invalid_request", "connect first");
      if (!apiHash || !this.apiId) throw mtError("invalid_request", "apiId and apiHash are required");
      const home = this.dcs.get(this.homeDc);
      if (home && home.loggedIn) return { reused: true, userId: home.userId };
      let dc = this.homeDc;
      for (let hops = 0; ; hops++) {
        try {
          const sent = parseSentCode(await this.authInvoke(dc, sendCode({ phone, apiId: this.apiId, apiHash }), null, deadline));
          if (dc !== this.homeDc) { const from = this.homeDc; this.homeDc = dc; await this.drop(from); }
          if (sent.kind === "authorization") return this.loggedIn(dc, decode(sent.body, { expect: "auth.Authorization" }));
          return { hash: sent.hash, via: sent.via };
        } catch (e) {
          if (e && e.code === "user_migrate" && hops < 2 && e.dc !== dc && e.dc >= 1 && e.dc <= 5) { dc = e.dc; continue; }
          throw e;
        }
      }
    }, deadline);
  }

  /**
   * Sync mode: the code the person typed, on the home DC (where phoneSendCode left it). Answers { userId }; a 2FA
   * account throws `password_needed` (checkPassword goes on there); a number with no account throws `sign_up_required`.
   */
  phoneSignIn({ phone, hash, code, deadline } = {}) {
    if (this.mode !== "sync") return Promise.reject(mtError("invalid_request", "the phone sign-in is for sync mode"));
    return this.serial(async () => {
      if (!this.homeDc) throw mtError("invalid_request", "connect first");
      const home = this.dcs.get(this.homeDc);
      if (home && home.loggedIn) return { reused: true, userId: home.userId };
      const auth = await this.authInvoke(this.homeDc, signIn({ phone, hash, code }), "auth.Authorization", deadline);
      if (auth && auth._ === "auth.authorizationSignUpRequired") throw mtError("sign_up_required", "this number has no Telegram account");
      return this.loggedIn(this.homeDc, auth);
    }, deadline);
  }

  /** An auth.authorization: the DC it came from is the home DC, logged in as that user. */
  loggedIn(dc, auth) {
    if (!auth || auth._ !== "auth.authorization" || !auth.user || auth.user._ !== "user") throw mtError("protocol", "unexpected answer to the account login");
    if (auth.user.bot) throw mtError("protocol", "the login answered a bot, not an account");
    const st = this.dcs.get(dc);
    st.loggedIn = true;
    st.userId = BigInt(auth.user.id);
    this.homeDc = dc;
    return { userId: st.userId };
  }

  /**
   * One round of the QR login on the home DC: auth.exportLoginToken. Answers { token (Uint8Array), expires (a unix
   * time of the server's) } while nobody has scanned it, or { userId } once the person accepted it in the official
   * Telegram app (auth.loginTokenSuccess; auth.loginTokenMigrateTo is followed: auth.importLoginToken on that DC, which
   * gets its own auth key, and becomes the home DC). A 2FA account throws `password_needed`: the home DC is then the
   * DC that asked, and checkPassword goes on there. A DC already logged in sends nothing and answers { reused, userId }.
   */
  qrLoginStep({ apiHash, deadline }) {
    if (!LOGIN_MODES.has(this.mode)) return Promise.reject(mtError("invalid_request", "account login methods are for account mode"));
    return this.serial(async () => {
      if (!this.homeDc) throw mtError("invalid_request", "connect first");
      if (!apiHash || !this.apiId) throw mtError("invalid_request", "apiId and apiHash are required");
      const home = this.dcs.get(this.homeDc);
      if (home && home.loggedIn) return { reused: true, userId: home.userId };
      let dc = this.homeDc;
      let res = await this.authInvoke(dc, exportLoginToken({ apiId: this.apiId, apiHash }), "auth.LoginToken", deadline);
      for (let hops = 0; res._ === "auth.loginTokenMigrateTo"; hops++) {
        if (hops >= 2) throw mtError("protocol", "too many login migrations");
        const target = Number(res.dc_id);
        if (!(target >= 1 && target <= 5)) throw mtError("protocol", "bad login DC " + target);
        dc = target;
        try {
          res = await this.authInvoke(dc, importLoginToken(res.token), "auth.LoginToken", deadline);
        } catch (e) {
          if (e && e.code === "password_needed") { const from = this.homeDc; this.homeDc = dc; if (from !== dc) await this.drop(from); }
          throw e;
        }
      }
      if (dc !== this.homeDc) await this.drop(this.homeDc); // the DC the token came from is not the account's: free its socket
      if (res._ === "auth.loginTokenSuccess") return this.loggedIn(dc, res.authorization);
      if (res._ === "auth.loginToken") return { token: res.token, expires: Number(res.expires) };
      throw mtError("protocol", "unexpected answer to auth.exportLoginToken");
    }, deadline);
  }

  /**
   * The 2FA step: account.getPassword, the SRP proof (srp.js), auth.checkPassword, on the home DC. `password` is only
   * used here: never kept, never logged. Each attempt spends one of PASSWORD_BUDGET; a stale SRP round (SRP_ID_INVALID)
   * is retried once with a fresh getPassword. A wrong password throws `password_invalid`.
   */
  checkPassword(password, { deadline } = {}) {
    if (!LOGIN_MODES.has(this.mode)) return Promise.reject(mtError("invalid_request", "account login methods are for account mode"));
    return this.serial(async () => {
      if (!this.homeDc) throw mtError("invalid_request", "connect first");
      const home = this.dcs.get(this.homeDc);
      if (home && home.loggedIn) return { reused: true, userId: home.userId };
      if (this.store) loginBudget(this.store, this.now(), PASSWORD_BUDGET).record();
      for (let attempt = 0; ; attempt++) {
        const pw = await this.authInvoke(this.homeDc, getPassword(), "account.Password", deadline);
        if (!pw.has_password || !pw.current_algo) throw mtError("protocol", "the account has no 2FA password");
        const proof = srpCheck({ algo: pw.current_algo, srpB: pw.srp_B, srpId: BigInt(pw.srp_id) }, password);
        try {
          return this.loggedIn(this.homeDc, await this.authInvoke(this.homeDc, checkPassword(proof), "auth.Authorization", deadline));
        } catch (e) {
          if (e && e.code === "password_invalid" && e.rpc === "SRP_ID_INVALID" && attempt === 0) continue;
          throw e;
        }
      }
    }, deadline);
  }

  /** auth.logOut on the home DC (best effort: the caller forgets the session whatever happens). */
  logOut({ deadline } = {}) {
    if (!LOGIN_MODES.has(this.mode)) return Promise.reject(mtError("invalid_request", "account login methods are for account mode"));
    return this.serial(async () => {
      if (!this.homeDc) return false;
      const home = this.dcs.get(this.homeDc);
      if (!home || !home.loggedIn) return false;
      await this.authInvoke(this.homeDc, logOut(), "auth.LoggedOut", deadline);
      home.loggedIn = false;
      return true;
    }, deadline);
  }

  /** Makes DC `dc` act for the logged-in bot: export the authorization from the home DC, import it there. */
  async authorize(dc, deadline) {
    if (dc === this.homeDc) return;
    await this.conn(dc, deadline);
    const st = this.dcs.get(dc);
    if (st && st.loggedIn) return;
    const exp = parseExportedAuthorization(await this.invoke(this.homeDc, exportAuthorization(dc), { deadline }));
    if (exp.ctor !== CTOR.exportedAuthorization) throw mtError("protocol", "unexpected answer to auth.exportAuthorization");
    const auth = parseAuthorization(await this.invoke(dc, importAuthorization(exp), { deadline }));
    if (auth.ctor !== CTOR.authAuthorization) throw mtError("protocol", "unexpected answer to auth.importAuthorization");
    this.dcs.get(dc).loggedIn = true;
  }

  /**
   * `limit` bytes of a document from `offset` (fewer at the end of the file), via upload.getFile with an
   * InputDocumentFileLocation. `loc` is { id, accessHash, fileReference (Uint8Array), dcId? }. Offset a multiple of
   * 4096, limit a multiple of 4096 dividing 1 MiB, never across a 1 MiB boundary (Telegram's rules, checked here first).
   * Follows FILE_MIGRATE_n; FLOOD_WAIT_n, FILE_REFERENCE_EXPIRED... come back as typed errors. With `{ hex: true }`
   * the bytes come back as a hex string, sliced out of the decrypted answer with no JS pass over them.
   * With `{ thumbSize: "m" }` it reads the document's thumbnail of that type instead (thumb_size in the location):
   * nothing is read ahead for it and it never touches the file's chunks read ahead.
   */
  getFile(loc, offset, limit, { hex = false, deadline, trace, ahead = [], abandon = false, thumbSize = "" } = {}) {
    try {
      if (!loc || loc.id === undefined || loc.accessHash === undefined || !(loc.fileReference && typeof loc.fileReference.length === "number")) {
        throw mtError("invalid_request", "a location needs id, accessHash and fileReference");
      }
      if (typeof thumbSize !== "string" || !/^[A-Za-z0-9]{0,4}$/.test(thumbSize)) throw mtError("invalid_request", "a thumb size is 1 to 4 letters or digits");
      checkRange(offset, limit);
    } catch (e) {
      return Promise.reject(e);
    }
    if (thumbSize) { ahead = []; abandon = false; }
    const location = inputDocumentFileLocation({ id: BigInt(loc.id), accessHash: BigInt(loc.accessHash), fileReference: loc.fileReference, thumbSize });
    const body = uploadGetFile(location, offset, limit);
    // Chunks read ahead are kept by offset: a read asking a shorter limit there (the file's last chunk) uses them too.
    const doc = String(loc.id) + ":" + toHex(loc.fileReference) + ":" + (thumbSize ? "t" + thumbSize + ":" : "");
    const keyOf = (o) => doc + o;
    const dropAhead = (k, a) => this.dropAhead(k, a);
    return this.serial(async () => {
      if (!this.homeDc) throw mtError("invalid_request", "connect first");
      this.lastActiveAt = this.now();
      let dc = Number(loc.dcId) || this.homeDc;
      if (trace) { trace.pipe = "miss"; trace.ahead = 0; }
      // The chunks to request right behind this one: not already requested, never this one, and never more than
      // MAX_IN_FLIGHT chunk requests on the connection (abandoned ones still on the wire count): Telegram may pack all
      // the answers in flight into one packet, and each MiB of it is 2 MiB of hex per copy under QuickJS's 64 MiB cap.
      const sendAhead = async (c) => {
        for (const a of ahead) {
          const k = keyOf(a.offset);
          if (this.ahead.has(k) || a.offset === offset) continue;
          if (c.session.inflight() >= MAX_IN_FLIGHT) break;
          try { checkRange(a.offset, a.limit); } catch { continue; }
          const entry = await c.session.request(uploadGetFile(location, a.offset, a.limit), { hex: true });
          this.maxInflight = Math.max(this.maxInflight, c.session.maxInflight);
          this.ahead.set(k, { dc, session: c.session, entry, limit: a.limit });
          if (trace) trace.ahead++;
          // Bound both the count and the ANSWERED bytes held: drop the oldest until both fit.
          while (this.ahead.size > MAX_AHEAD || this.aheadBytes() > MAX_AHEAD_BYTES) {
            const oldest = this.ahead.entries().next().value;
            if (!oldest || oldest[0] === k) break; // never the one just added
            dropAhead(oldest[0], oldest[1]);
          }
        }
      };
      // A seek first: the chunks read ahead for this file that this read no longer wants are given up (their answers,
      // when they come, are dropped without being kept); this read's own chunk, if read ahead, is kept.
      if (abandon) {
        const wanted = new Set([keyOf(offset), ...ahead.map((a) => keyOf(a.offset))]);
        for (const [k, a] of [...this.ahead]) if (k.startsWith(doc) && !wanted.has(k)) dropAhead(k, a);
      }
      // A chunk requested ahead by an earlier read: its answer may already be here (or on its way).
      const pre = this.ahead.get(keyOf(offset));
      if (pre && pre.limit >= limit) {
        this.ahead.delete(keyOf(offset));
        const c = this.conns.get(pre.dc);
        if (c && c.session === pre.session && !c.transport.closed) {
          try {
            const until = Math.min(this.now() + AHEAD_WAIT_MS, deadline === undefined ? Infinity : deadline - MIN_LEFT_MS);
            let answer = await c.session.settle(pre.entry, until); // read-aheads are always asked as hex
            let file;
            try { file = parseUploadFileHex(answer); } finally { big.release(answer.length); answer = null; } // its last use
            if (file.ctor === CTOR.uploadFile) {
              if (trace) trace.pipe = "hit";
              if (ahead.length) { try { await sendAhead(c); } catch (e) { this.log("request ahead not sent (" + describeError(e) + ")"); } } // keep the pipe full
              const chunk = file.bytesHex.length > limit * 2 ? file.bytesHex.slice(0, limit * 2) : file.bytesHex;
              return hex ? chunk : fromHex(chunk);
            }
          } catch (e) {
            this.log("chunk read ahead not usable (" + describeError(e) + "): asking again");
            if (!isServerAnswer(e) || c.session.broken) await this.drop(pre.dc); // the stream is in an unknown state
          }
        } else {
          dropAhead(keyOf(offset), pre);
        }
      }
      // The asked chunk goes out only with room on the wire (fewer than MAX_IN_FLIGHT in flight), never waiting long.
      const makeRoom = (c) => c.session.drainBelow(MAX_IN_FLIGHT, Math.min(this.now() + ROOM_WAIT_MS, deadline === undefined ? Infinity : deadline - 3 * MIN_LEFT_MS));
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await this.authorize(dc, deadline);
          let answer = await this.invoke(dc, body, { hex, deadline, trace, before: makeRoom, after: attempt === 0 && ahead.length ? sendAhead : undefined });
          const tp = trace ? Date.now() : 0;
          const file = hex ? parseUploadFileHex(answer) : parseUploadFile(answer);
          if (hex) big.release(answer.length); // its last use: the answer below is a slice of it
          answer = null;
          if (trace) trace.parse += Date.now() - tp;
          if (file.ctor === CTOR.uploadFileCdnRedirect) throw mtError("protocol", "CDN redirects are not supported");
          if (file.ctor !== CTOR.uploadFile) throw mtError("protocol", "unexpected answer to upload.getFile");
          return hex ? file.bytesHex : file.bytes;
        } catch (e) {
          if (e && e.code === "file_migrate" && e.dc !== dc) { dc = e.dc; continue; }
          if (e && e.code === "auth_key_unregistered" && dc !== this.homeDc) continue; // authorize() again (a new key if it was dropped)
          throw e;
        }
      }
      throw mtError("protocol", "too many redirects for one chunk");
    }, deadline, trace);
  }

  async close() {
    await this.serial(async () => {
      for (const dc of [...this.conns.keys()]) await this.drop(dc);
    });
  }
}
return { CHUNK, loginBudget, PASSWORD_BUDGET, TelegramClient };
})();

// ---- src/account/round.js ----
const __mod_src_account_round = (() => {
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
const { decode } = __mod_src_mtproto_schema_reader;
const { CHUNK } = __mod_src_mtproto_client;
const { toHex, fromHex, toBase64, fromBase64 } = __mod_src_mtproto_bytes;
const { mtError } = __mod_src_mtproto_errors;
const { saveFilePart, sendSnapshot, pinSnapshot, deleteSnapshots, searchPinned, parseBool, parseAffectedMessages, PART_BYTES, MAX_FILE_BYTES, SNAPSHOT_NAME } = __mod_src_mtproto_sync_requests;

const native = (from, to) => typeof kino !== "undefined" && kino.crypto && typeof kino.crypto.convert === "function"
  ? (s) => kino.crypto.convert(s, from, to) : null;
const b64ToHex = (s) => { const f = native("base64", "hex"); return f ? f(s) : toHex(fromBase64(s)); };
const hexToB64 = (s) => { const f = native("hex", "base64"); return f ? f(s) : toBase64(fromHex(s)); };
const randomLong = () => BigInt.asIntN(64, BigInt("0x" + kino.crypto.randomBytes(8, "hex")));
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function blobBytes(blob) {
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
function roundOf(client, deadline) {
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
async function pull(client, { maxBlobBytes, deadline } = {}) {
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
function checkBlob(blob, maxBlobBytes) {
  if (typeof blob !== "string" || blob.length < 4 || blob.length % 4 !== 0 || !BASE64.test(blob)) throw mtError("invalid_request", "no blob");
  const size = blobBytes(blob);
  if (size > capOf(maxBlobBytes)) throw mtError("too_large", "blob over maxBlobBytes");
  return size;
}

/** { version } of the new copy; "conflict" when the pinned copy is not `expectedVersion`. */
async function push(client, { blob, expectedVersion, maxBlobBytes, deadline } = {}) {
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
async function peek(client, { deadline } = {}) {
  const [snap] = await roundOf(client, deadline).snapshots();
  return snap ? { version: String(snap.id), bytes: snap.size } : null;
}
return { blobBytes, roundOf, pull, checkBlob, push, peek };
})();

// ---- src/account/session.js ----
const __mod_src_account_session = (() => {
// The account's Telegram session on this device, for Sync-Gram Cuenta: one live `sync` client per plugin runtime. A round
// opens it from the stored session (no key exchange, no login); only the QR login (login.js) creates one.
//
// The stored session is the one the Telegram Library (Video-Gram) keeps, in the same format and under the same key name
// (tg.usession): { v: 2, fp, salt, iv, ct }, the DC states sealed with AES-256-GCM under
// HMAC-SHA256(api_hash + "\naccount:" + api_id, "tg.usession\n" + salt). The fingerprint holds no secret. Nothing of it
// is ever logged. Plugins are isolated, so this is Sync-Gram Cuenta's own session, not the Library's.
//
// Restores: the manifest declares `storageLarge`, so nothing of this plugin's kino.storage is in any backup (and storage
// is never synced). A session can therefore never reach another device, where Telegram would end a key used on two
// connections (AUTH_KEY_DUPLICATED); should one be ended anyway, the round drops it and asks for a new QR login.
const { TelegramClient } = __mod_src_mtproto_client;
const { TELEGRAM_PUBLIC_KEYS } = __mod_src_mtproto_keys;
const { mtError } = __mod_src_mtproto_errors;

// The fake Telegram of the tests has its own RSA key: test/account-harness.mjs swaps exactly this line in the bundle.
const PUBLIC_KEYS = TELEGRAM_PUBLIC_KEYS;
const FIRST_DC = 2;
const SESSION_KEY = "tg.usession";
const CLOSED_KEY = "tg.closed"; // { fp }: Telegram ended this session (the person closed it in Devices)

function readJson(key) {
  try { const v = kino.storage.get(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function writeJson(key, value) {
  try { kino.storage.set(key, JSON.stringify(value)); return true; } catch (e) { kino.log("storage write refused: " + key + " " + (e && e.code)); return false; }
}
function remove(key) { try { kino.storage.remove(key); } catch { /* nothing to remove */ } }
const store = Object.freeze({ get: (k) => kino.storage.get(k), set: (k, v) => kino.storage.set(k, v) });

/** "not signed in" and friends, with a fixed `reason` the status line reads (never a secret). */
const notReady = (reason, message) => mtError("not_signed_in", message, { reason });

/** api_id and api_hash from the settings (trimmed); never logged, never stored. `complete` when both look right. */
function credentials() {
  const get = (k) => String(kino.config.get(k) ?? "").trim();
  const apiId = get("api_id"), apiHash = get("api_hash");
  return { apiId, apiHash, complete: /^\d{1,10}$/.test(apiId) && Number(apiId) > 0 && apiHash.length > 0 };
}
const digest = (text) => kino.crypto.hash("sha256", text).slice(0, 16);
const sessionFp = (c) => digest("account\n" + c.apiId);
const sealKey = (c, salt) => kino.crypto.hmac("sha256", c.apiHash + "\naccount:" + c.apiId, "tg.usession\n" + salt, { keyEncoding: "utf8", inputEncoding: "utf8", outputEncoding: "hex" });

function seal(key, state) {
  const iv = kino.crypto.randomBytes(12);
  const ct = kino.crypto.encrypt("aes-256-gcm", { key, keyEncoding: "hex", iv, ivEncoding: "hex", data: JSON.stringify(state), inputEncoding: "utf8", outputEncoding: "base64" });
  return { iv, ct };
}
function open(stored, c) {
  if (!stored || stored.v !== 2 || typeof stored.salt !== "string" || typeof stored.iv !== "string" || typeof stored.ct !== "string") return null;
  try {
    const text = kino.crypto.decrypt("aes-256-gcm", { key: sealKey(c, stored.salt), keyEncoding: "hex", iv: stored.iv, ivEncoding: "hex", data: stored.ct, inputEncoding: "base64", outputEncoding: "utf8" });
    const state = JSON.parse(text);
    return state && state.dcs ? state : null;
  } catch {
    kino.log("stored session cannot be opened (other settings or damaged)");
    return null;
  }
}
/** The stored state for these settings (logged in or not), or null. */
function storedState(c) {
  const s = readJson(SESSION_KEY);
  if (!s || s.fp !== sessionFp(c)) return null;
  const state = open(s, c);
  return state ? { state, salt: s.salt } : null;
}
const loggedInState = (st) => { const home = st && st.state.dcs[String(st.state.homeDc)]; return !!(home && home.loggedIn); };

function newClient(c) {
  return new TelegramClient({
    mode: "sync",
    apiId: Number(c.apiId),
    publicKeys: PUBLIC_KEYS,
    store,
    timeoutMs: 15000,
    device: { deviceModel: "Kino", systemVersion: kino.device === "tv" ? "Android TV" : "Android", appVersion: String(kino.appVersion || "1.0").slice(0, 20), systemLangCode: String(kino.lang || "es").slice(0, 2), langCode: String(kino.lang || "es").slice(0, 2) },
    log: (m) => kino.log("mtproto: " + m),
  });
}

let live = null; // { fp, client, key, salt, saved, ready, dropped? }

/** Writes the client's state, sealed, when it changed (a new salt, a new DC key, the login). */
function saveSession(l = live) {
  if (!l || l.dropped) return;
  const state = l.client.exportState();
  const text = JSON.stringify(state);
  if (text === l.saved) return;
  if (writeJson(SESSION_KEY, { v: 2, fp: l.fp, salt: l.salt, ...seal(l.key, state) })) l.saved = text;
}

/** Whether a sealed, logged-in session for these settings is stored, without connecting. */
function hasSession(c = credentials()) {
  return !!(c.apiId && c.apiHash) && loggedInState(storedState(c));
}

/** Whether this Kino gives the plugin kino.ws (the manifest's socket capability, apiVersion 13). */
const socketsAvailable = () => typeof kino.ws === "object" && kino.ws !== null && typeof kino.ws.open === "function";

/** Why there is no usable session: "unsupported" (no kino.ws), "api_missing", "closed" (Telegram ended it) or "signin" (never signed in here). */
function missingReason(c = credentials()) {
  if (!socketsAvailable()) return "unsupported";
  if (!c.complete) return "api_missing";
  const closed = readJson(CLOSED_KEY);
  return closed && closed.fp === sessionFp(c) ? "closed" : "signin";
}

let connecting = null; // the one round connect in flight: two rounds starting together share it (one client per key)

/**
 * The live client for a round, connected with the stored, logged-in session. Throws `not_signed_in` (with `reason`)
 * when there is none to use: no network is touched in that case, no key exchange, no login.
 */
function connect({ deadline } = {}) {
  if (!connecting) connecting = openRound(deadline).finally(() => { connecting = null; });
  return connecting;
}

async function openRound(deadline) {
  if (!socketsAvailable()) throw notReady("unsupported", "kino.ws is not available");
  const c = credentials();
  if (!c.complete) throw notReady("api_missing", "api_id and api_hash are needed");
  const fp = sessionFp(c);
  if (live && live.fp === fp && live.ready) return live;
  const st = storedState(c);
  if (!loggedInState(st)) throw notReady(missingReason(c), "not signed in to Telegram on this device");
  if (live) await close();
  const client = newClient(c);
  try {
    await client.connect(st.state.homeDc, st.state, { deadline });
  } catch (e) {
    if (e && e.code === "invalid_request") { remove(SESSION_KEY); throw notReady("signin", "stored session unusable"); }
    throw e;
  }
  live = { fp, client, key: sealKey(c, st.salt), salt: st.salt, saved: JSON.stringify(st.state), ready: true };
  return live;
}

/**
 * The live client for the QR login (login.js only): the stored session's key when there is one (an unfinished login of
 * an earlier runtime: no second key exchange), else a new key on the first DC. Never logged in by itself.
 */
async function connectForLogin({ deadline } = {}) {
  if (!socketsAvailable()) throw notReady("unsupported", "kino.ws is not available");
  const c = credentials();
  if (!c.complete) throw notReady("api_missing", "api_id and api_hash are needed");
  const fp = sessionFp(c);
  if (live && live.fp === fp) return live;
  if (live) await close();
  const st = storedState(c);
  const salt = st ? st.salt : kino.crypto.randomBytes(16);
  const client = newClient(c);
  await client.connect(st && st.state.homeDc ? st.state.homeDc : FIRST_DC, st ? st.state : undefined, { deadline });
  live = { fp, client, key: sealKey(c, salt), salt, saved: st ? JSON.stringify(st.state) : null, ready: !client.needsLogin() };
  saveSession(); // the new auth key outlives this runtime: the next refresh reuses it
  return live;
}

/** The QR login (or its password) succeeded: the live client is the session, stored now. */
function markLoggedIn() {
  if (!live) return;
  live.ready = true;
  remove(CLOSED_KEY);
  saveSession();
}

/** Telegram ended the session (SESSION_REVOKED, a key it no longer knows): drop it, remember why, never log in again by itself. */
async function sessionClosed() {
  const c = credentials();
  kino.log("account session ended by Telegram: sign in again");
  if (live) live.dropped = true; // a round's last save must not write it back
  await close();
  remove(SESSION_KEY);
  writeJson(CLOSED_KEY, { fp: sessionFp(c) });
}

/** The person signed out: auth.logOut was tried; the session and its records go from this device. */
async function forgetSession() {
  if (live) live.dropped = true;
  await close();
  remove(SESSION_KEY);
  remove(CLOSED_KEY);
}

async function close() {
  const l = live;
  live = null;
  if (l) { try { await l.client.close(); } catch { /* already closed */ } }
}
return { SESSION_KEY, CLOSED_KEY, readJson, writeJson, remove, store, notReady, credentials, sessionFp, newClient, saveSession, hasSession, socketsAvailable, missingReason, connect, connectForLogin, markLoggedIn, sessionClosed, forgetSession, close };
})();

// ---- src/account/text.js ----
const __mod_src_account_text = (() => {
// Account mode's texts for the person, in Spanish (neutral, tuteo) and English. `t(key, vars)` picks kino.lang's.
// Two kinds: status lines and action messages (shown as the plugin's own text, may name Telegram) and the round errors'
// userMessage (Kino shows those only under its rules: no brand names, no "kino"), the `say.*` keys.
const ES = {
  "status.ready": "Conectado con tu cuenta: la copia está en tus Mensajes guardados, fijada y en silencio.",
  "status.empty": "Conectado con tu cuenta. Aún no hay copia guardada: Kino la crea en la próxima sincronización.",
  "status.signin": "Falta iniciar sesión en este aparato: escribe tu número con el código de país y toca Enviar código.",
  "status.signin.tv": "Toca Iniciar sesión de Telegram con QR y escanea el código con Telegram en tu teléfono.",
  "status.closed": "Telegram cerró la sesión de este aparato (Ajustes ▸ Dispositivos). Vuelve a iniciar sesión con tu número: toca Enviar código.",
  "status.closed.tv": "Telegram cerró la sesión de esta TV (Ajustes ▸ Dispositivos). Toca Iniciar sesión de Telegram con QR para entrar otra vez.",
  "status.api_missing.phone": "Escribe tu api_id y tu api_hash de my.telegram.org y toca Guardar. Luego inicia sesión con tu número.",
  "status.api_missing.tv": "Recibe la configuración desde otro aparato: en el otro toca Enviar configuración y aquí Recibir configuración.",
  "status.nokey.tv": "Recibe la configuración desde otro aparato: en el otro toca Enviar configuración y aquí Recibir configuración.",
  "status.nokey": "Falta la clave: Kino la crea sola al activar la sincronización, o recíbela desde otro aparato.",
  "status.unsupported": "Esta versión de Kino no deja que el plugin se conecte con Telegram: actualiza Kino.",
  "status.wait": "Telegram pidió esperar {s} s. Kino sigue solo después.",
  "status.waitShort": "Telegram pidió esperar. Kino sigue solo después.",
  "status.unreachable": "No se pudo consultar Telegram ahora. Kino lo intentará de nuevo.",
  "status.password": "Tu cuenta tiene contraseña de dos pasos: escríbela arriba, toca Guardar y luego Confirmar la contraseña.",
  "status.password.tv": "Tu cuenta tiene contraseña de dos pasos: envíala desde tu celular con Enviar configuración; esta TV la usa sola.",
  "qr.already": "Ya iniciaste sesión con tu cuenta en este aparato.",
  "qr.scan": "En tu teléfono abre Telegram ▸ Ajustes ▸ Dispositivos ▸ Vincular un dispositivo y escanea el código.",
  "qr.scan.tv": "Escanea este código con Telegram en tu teléfono: Ajustes ▸ Dispositivos ▸ Vincular un dispositivo.",
  "qr.waiting": "Esperando que escanees el código con Telegram en tu teléfono.",
  "qr.waiting.tv": "Escanea este código con Telegram en tu teléfono: Ajustes ▸ Dispositivos ▸ Vincular un dispositivo.",
  "qr.phone": "En el celular inicia sesión con tu número: escríbelo y toca Enviar código.",
  "phone.sent": "Listo: Telegram te manda el código a tu app de Telegram en otro aparato o por SMS. Escríbelo en Código y toca Iniciar sesión.",
  "phone.enterCode": "Escribe el código que te mandó Telegram y toca Iniciar sesión.",
  "phone.done": "Listo: sesión iniciada. Ya puedes llevar la configuración a tu TV con Enviar configuración.",
  "phone.invalid": "Ese número no es válido: escríbelo con el código de país, por ejemplo +57 300 1234567.",
  "phone.noAccount": "Ese número no tiene cuenta de Telegram: créala primero en la app de Telegram.",
  "phone.unavailable": "Telegram no puede mandarte un código ahora: vuelve a intentarlo más tarde.",
  "phone.email": "Telegram quiere mandarle el código de esta cuenta a tu correo, y eso no se puede aquí: inicia sesión en la app de Telegram y vuelve a intentarlo.",
  "code.wrong": "El código no es correcto: revísalo y vuelve a tocar Iniciar sesión.",
  "code.expired": "El código venció: toca Enviar código otra vez.",
  "code.none": "Primero toca Enviar código: Telegram te manda uno nuevo.",
  "code.empty": "Escribe el código que te mandó Telegram y toca Iniciar sesión.",
  "pw.wrong.tv": "La contraseña de dos pasos que recibiste no es correcta: escríbela de nuevo en tu celular y vuelve a tocar Enviar configuración.",
  "qr.expired": "El código venció: toca Iniciar sesión de Telegram con QR otra vez.",
  "qr.done": "Listo: sesión iniciada. Kino solo usa tus Mensajes guardados para la copia.",
  "qr.failed": "No se pudo iniciar sesión ahora; vuelve a intentarlo.",
  "qr.budget": "Demasiados intentos de inicio de sesión en este aparato: vuelve a intentarlo en {min}.",
  "qr.flood": "Telegram pidió esperar: vuelve a intentarlo en {min}.",
  "qr.apiId": "Telegram no aceptó tu api_id o tu api_hash: revísalos en my.telegram.org.",
  "pw.notNeeded": "Telegram no está pidiendo una contraseña ahora.",
  "pw.empty": "Escribe primero la contraseña arriba y toca Guardar.",
  "pw.wrong": "La contraseña no es correcta: escríbela de nuevo, toca Guardar y luego Confirmar la contraseña.",
  "pw.budget": "Demasiados intentos de contraseña: vuelve a intentarlo en {min}.",
  "logout.done": "Listo: se cerró la sesión de tu cuenta en este aparato.",
  "logout.none": "No hay una sesión de tu cuenta en este aparato.",
  "minutes.one": "1 minuto",
  "minutes.many": "{n} minutos",
  "say.signin": "Falta iniciar sesión con tu cuenta en este aparato: ve a Configurar.",
  "say.closed": "Se cerró la sesión de tu cuenta en este aparato: vuelve a iniciarla en Configurar.",
  "say.api_missing": "Faltan el api_id y el api_hash de tu cuenta: ve a Configurar.",
  "say.wait": "Hay que esperar {s} s antes de la próxima copia. Se intentará solo.",
  "say.unsupported": "Esta versión no deja conectar este plugin: actualiza la app.",
  "field.apiId": "El api_id es un número: cópialo de my.telegram.org.",
  "field.apiHash": "El api_hash son 32 letras y números: cópialo de my.telegram.org.",
  "field.syncKey": "Esta clave la crea Kino sola: no la escribas tú, o recíbela desde otro aparato.",
  "field.code": "El código son solo números: cópialo del mensaje de Telegram.",
  "field.loginOk": "Esto lo llena Iniciar sesión: no lo cambies.",
  "say.big": "La copia es demasiado grande para guardarla.",
  "say.down": "No se pudo llegar al servicio ahora. Se intentará de nuevo.",
};
const EN = {
  "status.ready": "Connected to your account: the copy is in your Saved Messages, pinned and silent.",
  "status.empty": "Connected to your account. No copy saved yet: Kino makes it at the next sync.",
  "status.signin": "You still need to sign in on this device: enter your number with its country code and tap Send the code.",
  "status.signin.tv": "Tap Sign in to Telegram with QR and scan the code with Telegram on your phone.",
  "status.closed": "Telegram closed this device's session (Settings ▸ Devices). Sign in again with your number: tap Send the code.",
  "status.closed.tv": "Telegram closed this TV's session (Settings ▸ Devices). Tap Sign in to Telegram with QR to sign in again.",
  "status.api_missing.phone": "Enter your api_id and api_hash from my.telegram.org and tap Save. Then sign in with your number.",
  "status.api_missing.tv": "Get the setup from another device: on the other one tap Send settings, and here Receive settings.",
  "status.nokey.tv": "Get the setup from another device: on the other one tap Send settings, and here Receive settings.",
  "status.nokey": "The key is missing: Kino makes it by itself when you turn sync on, or receive it from another device.",
  "status.unsupported": "This Kino version does not let the plugin connect to Telegram: update Kino.",
  "status.wait": "Telegram asked to wait {s} s. Kino goes on by itself afterwards.",
  "status.waitShort": "Telegram asked to wait. Kino goes on by itself afterwards.",
  "status.unreachable": "Could not ask Telegram right now. Kino will try again.",
  "status.password": "Your account has a two-step password: type it above, tap Save, then Confirm the password.",
  "status.password.tv": "Your account has a two-step password: send it from your phone with Send settings; this TV uses it by itself.",
  "qr.already": "You are already signed in with your account on this device.",
  "qr.scan": "On your phone open Telegram ▸ Settings ▸ Devices ▸ Link Desktop Device and scan the code.",
  "qr.scan.tv": "Scan this code with Telegram on your phone: Settings ▸ Devices ▸ Link Desktop Device.",
  "qr.waiting": "Waiting for you to scan the code with Telegram on your phone.",
  "qr.waiting.tv": "Scan this code with Telegram on your phone: Settings ▸ Devices ▸ Link Desktop Device.",
  "qr.phone": "On the phone sign in with your number: enter it and tap Send the code.",
  "phone.sent": "Done: Telegram sends the code to your Telegram app on another device or by SMS. Type it in Code and tap Sign in.",
  "phone.enterCode": "Type the code Telegram sent you and tap Sign in.",
  "phone.done": "Done: signed in. You can now take the setup to your TV with Send settings.",
  "phone.invalid": "That number is not valid: enter it with its country code, for example +57 300 1234567.",
  "phone.noAccount": "That number has no Telegram account: create one in the Telegram app first.",
  "phone.unavailable": "Telegram cannot send you a code right now: try again later.",
  "phone.email": "Telegram wants to send this account's code to your email, which cannot be done here: sign in on the Telegram app and try again.",
  "code.wrong": "The code is not right: check it and tap Sign in again.",
  "code.expired": "The code expired: tap Send the code again.",
  "code.none": "First tap Send the code: Telegram sends you a new one.",
  "code.empty": "Type the code Telegram sent you and tap Sign in.",
  "pw.wrong.tv": "The two-step password you received is not right: type it again on your phone and tap Send settings again.",
  "qr.expired": "The code expired: tap Sign in to Telegram with QR again.",
  "qr.done": "Done: signed in. Kino only uses your Saved Messages for the copy.",
  "qr.failed": "Could not sign in now; try again.",
  "qr.budget": "Too many sign-in attempts on this device: try again in {min}.",
  "qr.flood": "Telegram asked to wait: try again in {min}.",
  "qr.apiId": "Telegram did not accept your api_id or api_hash: check them at my.telegram.org.",
  "pw.notNeeded": "Telegram is not asking for a password now.",
  "pw.empty": "Type the password above and tap Save first.",
  "pw.wrong": "The password is not right: type it again, tap Save, then Confirm the password.",
  "pw.budget": "Too many password attempts: try again in {min}.",
  "logout.done": "Done: your account's session on this device is closed.",
  "logout.none": "There is no session of your account on this device.",
  "minutes.one": "1 minute",
  "minutes.many": "{n} minutes",
  "say.signin": "You still need to sign in with your account on this device: go to Set up.",
  "say.closed": "Your account's session on this device was closed: sign in again in Set up.",
  "say.api_missing": "Your account's api_id and api_hash are missing: go to Set up.",
  "say.wait": "It has to wait {s} s before the next copy. It will try again by itself.",
  "say.unsupported": "This version cannot connect this plugin: update the app.",
  "field.apiId": "The api_id is a number: copy it from my.telegram.org.",
  "field.apiHash": "The api_hash is 32 letters and digits: copy it from my.telegram.org.",
  "field.syncKey": "Kino makes this key by itself: do not type it, or receive it from another device.",
  "field.code": "The code is digits only: copy it from Telegram's message.",
  "field.loginOk": "Sign in fills this in: do not change it.",
  "say.big": "The copy is too large to save.",
  "say.down": "Could not reach the service right now. It will try again.",
};
const CATALOG = Object.freeze({ es: ES, en: EN });

const english = () => String(kino.lang || "es").toLowerCase().startsWith("en");
function t(key, vars = {}) {
  const table = english() ? EN : ES;
  const text = table[key] ?? ES[key];
  if (text === undefined) throw new Error("no text " + key);
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
}
const minutes = (seconds) => {
  const n = Math.max(1, Math.ceil((Number(seconds) || 60) / 60));
  return n === 1 ? t("minutes.one") : t("minutes.many", { n });
};
/** The status line for a missing session, by reason; the api line depends on the device (the TV has no api fields). */
const missingLine = (reason) => {
  const tv = kino.device === "tv";
  if (reason === "api_missing") return t(tv ? "status.api_missing.tv" : "status.api_missing.phone");
  if (tv && (reason === "signin" || reason === "closed")) return t("status." + reason + ".tv");
  return t("status." + reason);
};
/** The missing-key line: on the TV the same "receive the setup" sentence as Kino's, never a setting's name. */
const noKeyLine = () => t(kino.device === "tv" ? "status.nokey.tv" : "status.nokey");
return { CATALOG, t, minutes, missingLine, noKeyLine };
})();

// ---- src/account/sync.js ----
const __mod_src_account_sync = (() => {
// Account mode's provider exports: syncPull / syncPush / syncStatus through the person's own Telegram account (Saved
// Messages), on the stored session of this device. A round never signs in: without a session it fails at once with
// auth_required and `reason` "signin" | "closed" | "api_missing" (no network touched), which the status line turns into
// words with the next step (text.js). FLOOD_WAIT is never retried inside a call: it is recorded (tg.wait) and every round
// before that time fails at once with rate_limited, while syncStatus answers ready: false so Kino quietly waits for its
// next period.
const { pull, push, peek, checkBlob } = __mod_src_account_round;
const { connect, saveSession, sessionClosed, hasSession, missingReason, credentials } = __mod_src_account_session;
const { describeError } = __mod_src_mtproto_errors;
const { t, missingLine, noKeyLine } = __mod_src_account_text;

const WAIT_KEY = "tg.wait"; // { until }: Telegram asked this device to wait (FLOOD_WAIT_n)
const ROUND_MS = 55000;     // Kino gives syncPull / syncPush 60 s
const STATUS_MS = 13000;    // and syncStatus 15 s

function kinoFail(code, detail, say, reason) {
  const d = String(detail || "").slice(0, 200);
  const e = say ? kino.error(code, d, { userMessage: say }) : kino.error(code, d);
  try { e.say = say || null; e.reason = reason || null; } catch { /* a frozen error just has neither */ }
  return e;
}

function readWait() {
  try { const w = JSON.parse(kino.storage.get(WAIT_KEY) || "null"); return w && Number(w.until) > Date.now() ? Number(w.until) : 0; } catch { return 0; }
}
const waitLeft = () => { const until = readWait(); return until ? Math.max(1, Math.ceil((until - Date.now()) / 1000)) : 0; };
function waiting() {
  const s = waitLeft();
  return s ? kinoFail("rate_limited", "flood wait: " + s + " s left", t("say.wait", { s }), "wait") : null;
}

/** Any failure of a round as what Kino understands. Telegram's own text never reaches the person. */
async function mapped(e) {
  const code = e && e.code;
  if (code === "conflict") return kino.error("conflict", String(e.message || "conflict").slice(0, 200));
  if (code === "not_signed_in") return kinoFail("auth_required", "not signed in: " + e.reason, t("say." + e.reason), e.reason);
  if (code === "auth_key_unregistered") { await sessionClosed(); return kinoFail("auth_required", "not signed in: closed", t("say.closed"), "closed"); }
  if (code === "flood_wait") {
    const s = Math.max(1, Math.min(86400, Number(e.seconds) || 60));
    try { kino.storage.set(WAIT_KEY, JSON.stringify({ until: Date.now() + s * 1000 })); } catch { /* the next call meets FLOOD_WAIT again */ }
    return kinoFail("rate_limited", "flood wait " + s + " s", t("say.wait", { s }), "wait");
  }
  if (code === "too_large") return kinoFail("unavailable", "too large", t("say.big"), "too_large");
  if (code === "invalid_request") return kino.error("invalid_request", String(e.message || "invalid request").slice(0, 200));
  return kinoFail("unavailable", describeError(e), t("say.down"), "unavailable");
}

async function round(fn) {
  const w = waiting();
  if (w) throw w;
  const deadline = Date.now() + ROUND_MS;
  let l = null;
  try {
    l = await connect({ deadline });
    return await fn(l.client, deadline);
  } catch (e) {
    throw await mapped(e);
  } finally {
    if (l) { try { saveSession(l); } catch { /* the next round saves it */ } }
  }
}

function accountPull({ maxBlobBytes } = {}) {
  return round((client, deadline) => pull(client, { maxBlobBytes, deadline }));
}

async function accountPush({ blob, expectedVersion, maxBlobBytes } = {}) {
  try { checkBlob(blob, maxBlobBytes); } catch (e) { throw await mapped(e); } // a bad blob never opens a connection
  return round((client, deadline) => push(client, { blob, expectedVersion, maxBlobBytes, deadline }));
}

/** { ready, message }: the status line, with the next step when something is missing. Never downloads. */
async function accountStatus() {
  const s = waitLeft();
  if (s) return { ready: false, message: t("status.wait", { s }) };
  const c = credentials();
  // A TV signs in only with everything the phone sends (its key and login_ok too): until then, receive the setup.
  const tvIncomplete = kino.device === "tv" && !(c.complete && String(kino.config.get("syncKey") ?? "") && String(kino.config.get("login_ok") ?? ""));
  if (tvIncomplete && missingReason(c) !== "unsupported" && !hasSession(c)) return { ready: false, message: noKeyLine() };
  if (!hasSession(c)) return { ready: false, message: missingLine(missingReason(c)) };
  // Kino runs no round while the key is empty: say how to get one (created here, or received from another device).
  if (!String(kino.config.get("syncKey") ?? "")) return { ready: false, message: noKeyLine() };
  const deadline = Date.now() + STATUS_MS;
  let l = null;
  try {
    l = await connect({ deadline });
    const snap = await peek(l.client, { deadline });
    return { ready: true, message: t(snap ? "status.ready" : "status.empty") };
  } catch (e) {
    const k = await mapped(e);
    if (["signin", "closed", "api_missing", "unsupported"].includes(k.reason)) return { ready: false, message: missingLine(k.reason) };
    if (k.reason === "wait") return { ready: false, message: t("status.waitShort") };
    return { ready: false, message: t("status.unreachable") };
  } finally {
    if (l) { try { saveSession(l); } catch { /* next time */ } }
  }
}
return { accountPull, accountPush, accountStatus };
})();

// ---- src/account/login.js ----
const __mod_src_account_login = (() => {
// Sync-Gram Cuenta's sign-in, from the settings form only (a sync round never signs in). One Telegram session per
// device, so every device signs in on its own (1.1.0, owner, 2026-10-25):
//   - THE PHONE signs in with its number and a code (a phone cannot scan its own QR): "Enviar código" (send_code,
//     auth.sendCode with the person's api_id and api_hash; PHONE_MIGRATE/NETWORK_MIGRATE followed by the client), then
//     "Iniciar sesión" (sign_in, auth.signIn with the code from `login_code`). Only that success writes `login_ok` ("1",
//     through setSettings), which the manifest's provision lists: Kino offers "Enviar configuración" only on a phone whose
//     sign-in worked. The number (`phone`) and the code (`login_code`) are device-only passwords ("sync": false): never
//     synced, never in a backup, never provisioned; the code is cleared after every attempt.
//   - THE TV only receives the configuration (api_id, api_hash, syncKey, login_ok, the 2FA password). With all of it and
//     no session, its page starts the QR login by itself (from settingsStatus, while the page is shown): auth.exportLoginToken,
//     shown as tg://login?token=<base64url> in the `qr` setting for the phone's Telegram app (Settings ▸ Devices ▸ Link
//     Desktop Device). The code is renewed while the page is open and restarted after its 150 s window, within the budget
//     (5 logins an hour per device) and never while Telegram asked to wait; past that, "Iniciar sesión de Telegram con QR" shows as
//     the manual retry.
//   - THE 2FA PASSWORD (SESSION_PASSWORD_NEEDED, then SRP and auth.checkPassword). On the phone it is typed in
//     `tg_password` ("sync": false) and confirmed with check_password. TRADE-OFF (owner's call): the TV cannot type, so
//     after the phone's successful sign-in the password is NOT cleared there: it stays sealed, device-only and out of
//     backups on the phone, so "Enviar configuración" can carry it once to the TV, until Cerrar sesión or until a password
//     check fails. On the TV the received password is used by itself, once per value (a keyed mark of the value tried,
//     tg.pwTried, so the same value is never sent twice); settingsStatus cannot clear a setting, so the TV's next action
//     answer clears it (every TV action does).
//   - "Cerrar sesión" (logout): auth.logOut (best effort), then the session goes from this device, with login_ok, the
//     code and the 2FA password.
// Never logged, stored by the plugin or answered: the number, the code, the 2FA password, the login token; logs carry
// error codes only. tg.qr keeps { fp, stage, until }, tg.phone { fp, hash, until } (the code hash, a server token).
const { credentials, connectForLogin, socketsAvailable, markLoggedIn, hasSession, sessionFp, forgetSession, readJson, writeJson, remove, store, saveSession } = __mod_src_account_session;
const { loginBudget } = __mod_src_mtproto_client;
const { toBase64 } = __mod_src_mtproto_bytes;
const { PHONE_DIGITS } = __mod_src_mtproto_phone_requests;
const { t, minutes } = __mod_src_account_text;

const QR_KEY = "tg.qr";
const PHONE_KEY = "tg.phone";       // { fp, hash, until }: a code was sent to the phone's number
const AUTO_KEY = "tg.autoQr";       // { fp }: the TV's automatic QR login stopped (expired past the budget, or failed)
const PW_TRIED_KEY = "tg.pwTried";  // { fp, mark }: the received 2FA password value the TV already tried
const WAIT_KEY = "tg.loginWait";    // { fp, until }: Telegram asked to wait before another login (FLOOD_WAIT)
const QR_WINDOW_MS = 150000;        // how long a QR login stays open
const CODE_WINDOW_MS = 600000;      // how long the sent code is offered for Iniciar sesión
const POLL_MS = 10000;              // ask Telegram again at least this often while the QR is shown
const RENEW_MS = 8000;              // ...and when the token has less than this left
const CALL_MS = 7000;               // one poll inside settingsStatus
const ACTION_MS = 20000;            // one action inside its 30 s
/** Logins per device and hour (each QR login, automatic or pressed, and each code sent). */
const ACCOUNT_BUDGET = Object.freeze({ key: "mtproto.accountLogins", max: 5, what: "account logins" });

let qr = null; // { fp, url, expiresAt, lastAt } of this runtime: the token itself lives only here
const clock = () => (typeof kino.now === "function" ? kino.now() : Date.now()); // a test may give kino a clock
const isTv = () => kino.device === "tv";
const has = (k) => String(kino.config.get(k) ?? "") !== "";

const b64url = (u8) => toBase64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const errCode = (e) => (e && typeof e.code === "string" ? e.code : "error");
const rpcOf = (e) => (e && typeof e.rpc === "string" && /^[A-Z_0-9]{1,40}$/.test(e.rpc) ? e.rpc : "");
const logStop = (what, e) => kino.log(what + " stopped: " + errCode(e) + (rpcOf(e) ? " " + rpcOf(e) : ""));

const TV_CLEAR = Object.freeze(["tg_password"]);
const mine = (key, c) => { const v = readJson(key); return v && v.fp === sessionFp(c) ? v : null; };

/** The TV holds everything the phone sends (api_id, api_hash, the key, login_ok): its own sign-in may start. */
function received() {
  return credentials().complete && has("syncKey") && has("login_ok");
}
/** The number from the `phone` setting as Telegram takes it (digits, country code first), or null. */
function phoneDigits() {
  const raw = String(kino.config.get("phone") ?? "").trim();
  if (!/^\+?[\d\s().-]+$/.test(raw)) return null;
  const d = raw.replace(/\D/g, "");
  return PHONE_DIGITS.test(d) ? d : null;
}

function waitLeft(c) {
  const w = mine(WAIT_KEY, c);
  return w && Number(w.until) > clock() ? Math.ceil((Number(w.until) - clock()) / 1000) : 0;
}
const recordWait = (c, e) => writeJson(WAIT_KEY, { fp: sessionFp(c), until: clock() + Math.max(1, Number(e.seconds) || 60) * 1000 });

/** What a QR login step answered: a token to show, or the login done. */
function took(c, step, now) {
  if (step && step.token) {
    // The server's expiry is in its clock; the token lives ~30 s: count from now with the time it says is left.
    const left = Math.max(5000, Math.min(60000, (Number(step.expires) - Math.floor(now / 1000)) * 1000));
    qr = { fp: sessionFp(c), url: "tg://login?token=" + b64url(step.token), expiresAt: now + (Number.isFinite(left) ? left : 30000), lastAt: now };
    saveSession();
    return "token";
  }
  if (step && step.userId !== undefined) { done(); return "done"; }
  throw new Error("unexpected login step");
}
function done() {
  qr = null;
  for (const k of [QR_KEY, PHONE_KEY, WAIT_KEY, AUTO_KEY, PW_TRIED_KEY]) remove(k);
  markLoggedIn();
}
/** A QR login (or its password step) that stopped: the line to show. */
function failed(c, e) {
  qr = null;
  const code = errCode(e);
  if (code === "password_needed") { writeJson(QR_KEY, { fp: sessionFp(c), stage: "password" }); saveSession(); return passwordLine(); }
  remove(QR_KEY);
  logStop("account login", e);
  if (code === "flood_wait") { recordWait(c, e); return t("qr.flood", { min: minutes(e.seconds) }); }
  if (code === "api_id_invalid") return t("qr.apiId");
  return t("qr.failed");
}

/** The 2FA line: on the phone the field is right there; the TV has none, the password comes from the phone. */
const passwordLine = () => t(isTv() ? "status.password.tv" : "status.password");

// ---------------------------------------------------------------------------------------------------------------- QR (TV)

/** One QR login start (budgeted). Answers the line; `qr` holds the code when there is one. */
async function qrStart(c) {
  if (!socketsAvailable()) return t("status.unsupported");
  if (!c.complete) return t(isTv() ? "status.api_missing.tv" : "status.api_missing.phone");
  if (hasSession(c)) return t("qr.already");
  const wait = waitLeft(c);
  if (wait) return t("qr.flood", { min: minutes(wait) });
  try {
    loginBudget(store, clock(), ACCOUNT_BUDGET).record();
  } catch (e) {
    return t("qr.budget", { min: minutes(e.seconds) });
  }
  const now = clock();
  try {
    const live = await connectForLogin({ deadline: now + ACTION_MS });
    const step = await live.client.qrLoginStep({ apiHash: c.apiHash, deadline: now + ACTION_MS });
    if (took(c, step, clock()) === "done") return t("qr.done");
    writeJson(QR_KEY, { fp: sessionFp(c), stage: "qr", until: now + QR_WINDOW_MS });
    return t(isTv() ? "qr.scan.tv" : "qr.scan");
  } catch (e) {
    return failed(c, e);
  }
}

/**
 * The qr_login action, the TV's manual retry. While Telegram asks for the 2FA password it is the password step instead
 * (the received password). Every TV answer clears the 2FA password field. On the phone it only points to the number.
 */
async function startQr() {
  if (!isTv()) return { message: t("qr.phone") };
  const c = credentials();
  remove(AUTO_KEY);
  const st = c.complete ? mine(QR_KEY, c) : null;
  if (st && st.stage === "password") return has("tg_password") ? confirmPassword() : { message: passwordLine(), clearSettings: TV_CLEAR };
  return { message: await qrStart(c), clearSettings: TV_CLEAR };
}

/** The TV's automatic start (only while every received value is there and nothing stopped it): the page's lines, or null. */
async function autoStart(c) {
  if (mine(AUTO_KEY, c)) return null;
  const stop = () => writeJson(AUTO_KEY, { fp: sessionFp(c) });
  if (waitLeft(c)) { stop(); return { status: t("qr.flood", { min: minutes(waitLeft(c)) }) }; }
  if (!loginBudget(store, clock(), ACCOUNT_BUDGET).allowed) { stop(); return null; }
  const line = await qrStart(c);
  if (qr) return { qr: qr.url, status: t("qr.waiting.tv") };
  if (hasSession(c)) return { status: line };
  const st = mine(QR_KEY, c);
  if (st && st.stage === "password") return tvPassword(c);
  stop();
  return { status: line };
}

/** The TV's password step from the page: the received 2FA password, once per value. */
async function tvPassword(c) {
  if (!has("tg_password")) return { status: passwordLine() };
  const typed = String(kino.config.get("tg_password"));
  const mark = kino.crypto.hmac("sha256", c.apiHash, "tg.pw\n" + typed, { keyEncoding: "utf8", inputEncoding: "utf8", outputEncoding: "hex" }).slice(0, 32);
  const tried = mine(PW_TRIED_KEY, c);
  if (tried && tried.mark === mark) return { status: t("pw.wrong.tv") };
  writeJson(PW_TRIED_KEY, { fp: sessionFp(c), mark });
  const now = clock();
  try {
    const live = await connectForLogin({ deadline: now + ACTION_MS });
    await live.client.checkPassword(typed, { deadline: now + ACTION_MS });
    done();
    return { status: t("qr.done") };
  } catch (e) {
    logStop("password check", e);
    if (errCode(e) === "password_invalid") return { status: t("pw.wrong.tv") };
    if (errCode(e) === "flood_wait") { recordWait(c, e); return { status: t("qr.flood", { min: minutes(e.seconds) }) }; }
    return { status: t("qr.failed") };
  }
}

/**
 * The TV page's lines from settingsStatus: the QR to draw and its line while a login is under way (started by itself
 * when everything was received), the password step, or {} when there is nothing to say. Never throws.
 */
async function tvPage() {
  const c = credentials();
  if (!c.complete || !socketsAvailable() || hasSession(c)) return {};
  const auto = received();
  const st = mine(QR_KEY, c);
  if (st && st.stage === "password") return auto ? tvPassword(c) : { status: passwordLine() };
  if (!st) { qr = null; return auto ? (await autoStart(c)) || {} : {}; }
  const now = clock();
  if (!(st.until > now)) {
    remove(QR_KEY);
    qr = null;
    if (auto) { const again = await autoStart(c); if (again) return again; }
    return { status: t("qr.expired") };
  }
  const due = !qr || qr.fp !== st.fp || qr.expiresAt - now < RENEW_MS || now - qr.lastAt >= POLL_MS;
  if (due) {
    try {
      const live = await connectForLogin({ deadline: now + CALL_MS });
      const step = await live.client.qrLoginStep({ apiHash: c.apiHash, deadline: now + CALL_MS });
      if (took(c, step, clock()) === "done") return { status: t("qr.done") };
    } catch (e) {
      const code = errCode(e);
      if (code === "timeout" || code === "closed") { kino.log("qr poll: " + code); if (qr) qr.lastAt = now; }
      else {
        const line = failed(c, e);
        if (code === "password_needed") return auto ? tvPassword(c) : { status: line };
        if (auto) writeJson(AUTO_KEY, { fp: sessionFp(c) });
        return { status: line };
      }
    }
  }
  return qr ? { qr: qr.url, status: t(auto ? "qr.waiting.tv" : "qr.waiting") } : { status: t("qr.waiting") };
}

/** Whether the TV's automatic QR login stopped (so "Iniciar sesión de Telegram con QR" shows as the manual retry). */
function autoStopped() {
  const c = credentials();
  return !!(c.complete && mine(AUTO_KEY, c));
}

// ------------------------------------------------------------------------------------------------------------- the phone

const CODE_CLEAR = Object.freeze(["login_code"]);
const phoneAnswer = (message, extra = {}) => ({ message, clearSettings: CODE_CLEAR, ...extra });

/** A phone sign-in step that stopped: the line to show (the stage is left as the error says). */
function phoneFailed(c, e) {
  const code = errCode(e), rpc = rpcOf(e);
  logStop("phone sign-in", e);
  if (code === "flood_wait") { recordWait(c, e); return t("qr.flood", { min: minutes(e.seconds) }); }
  if (code === "api_id_invalid") return t("qr.apiId");
  if (code === "email_required") return t("phone.email");
  if (code === "sign_up_required") { remove(PHONE_KEY); return t("phone.noAccount"); }
  if (rpc === "PHONE_NUMBER_INVALID" || rpc === "PHONE_NUMBER_BANNED") { remove(PHONE_KEY); return t("phone.invalid"); }
  if (rpc === "SEND_CODE_UNAVAILABLE") { remove(PHONE_KEY); return t("phone.unavailable"); }
  if (rpc === "PHONE_CODE_INVALID" || rpc === "PHONE_CODE_EMPTY") return t("code.wrong");
  if (rpc === "PHONE_CODE_EXPIRED") { remove(PHONE_KEY); return t("code.expired"); }
  return t("qr.failed");
}

/** The send_code action: Telegram sends the sign-in code (budgeted, never retried, FLOOD_WAIT kept). */
async function sendPhoneCode() {
  const c = credentials();
  if (!socketsAvailable()) return phoneAnswer(t("status.unsupported"));
  if (!c.complete) return phoneAnswer(t("status.api_missing.phone"));
  if (hasSession(c)) return phoneAnswer(t("qr.already"));
  const phone = phoneDigits();
  if (!phone) return phoneAnswer(t("phone.invalid"));
  const wait = waitLeft(c);
  if (wait) return phoneAnswer(t("qr.flood", { min: minutes(wait) }));
  try {
    loginBudget(store, clock(), ACCOUNT_BUDGET).record();
  } catch (e) {
    return phoneAnswer(t("qr.budget", { min: minutes(e.seconds) }));
  }
  const now = clock();
  try {
    const live = await connectForLogin({ deadline: now + ACTION_MS });
    const sent = await live.client.phoneSendCode({ phone, apiHash: c.apiHash, deadline: now + ACTION_MS });
    if (sent.userId !== undefined) { done(); return phoneAnswer(t("phone.done"), { setSettings: { login_ok: "1" } }); }
    writeJson(PHONE_KEY, { fp: sessionFp(c), hash: sent.hash, until: now + CODE_WINDOW_MS });
    saveSession(); // the DC's auth key (a migration made a new one) outlives this runtime
    return phoneAnswer(t("phone.sent"));
  } catch (e) {
    return phoneAnswer(phoneFailed(c, e));
  }
}

/** The sign_in action: the code from `login_code`, used once and always cleared. */
async function signInWithCode() {
  const c = credentials();
  if (!socketsAvailable()) return phoneAnswer(t("status.unsupported"));
  if (!c.complete) return phoneAnswer(t("status.api_missing.phone"));
  if (hasSession(c)) return phoneAnswer(t("qr.already"));
  const st = mine(PHONE_KEY, c);
  if (!st || !(Number(st.until) > clock())) { remove(PHONE_KEY); return phoneAnswer(t("code.none")); }
  const phone = phoneDigits();
  if (!phone) return phoneAnswer(t("phone.invalid"));
  const code = String(kino.config.get("login_code") ?? "").replace(/\s/g, "");
  if (!/^\d{3,8}$/.test(code)) return phoneAnswer(t("code.empty"));
  const now = clock();
  try {
    const live = await connectForLogin({ deadline: now + ACTION_MS });
    await live.client.phoneSignIn({ phone, hash: st.hash, code, deadline: now + ACTION_MS });
    done();
    return phoneAnswer(t("phone.done"), { setSettings: { login_ok: "1" } });
  } catch (e) {
    if (errCode(e) === "password_needed") {
      remove(PHONE_KEY);
      writeJson(QR_KEY, { fp: sessionFp(c), stage: "password" });
      saveSession();
      return phoneAnswer(passwordLine());
    }
    return phoneAnswer(phoneFailed(c, e));
  }
}

/** The phone's lines from settingsStatus while a sign-in is under way, or {}. */
function phonePage() {
  const c = credentials();
  if (!c.complete || hasSession(c)) return {};
  const st = mine(QR_KEY, c);
  if (st && st.stage === "password") return { status: passwordLine() };
  const code = mine(PHONE_KEY, c);
  if (code && Number(code.until) > clock()) return { status: t("phone.enterCode") };
  return {};
}

// ------------------------------------------------------------------------------------------------------ shared steps

/**
 * Where this device's sign-in stands: "noApi", "signedIn", "password" (Telegram asked for the two-step password),
 * "code" (the phone waits for the code), "qr" (a QR login under way) or "signedOut".
 */
function loginStage() {
  const c = credentials();
  if (!c.complete) return "noApi";
  if (hasSession(c)) return "signedIn";
  const st = mine(QR_KEY, c);
  if (st) return st.stage === "password" ? "password" : "qr";
  const code = mine(PHONE_KEY, c);
  if (code && Number(code.until) > clock()) return "code";
  return "signedOut";
}

/**
 * The check_password action (and the TV's qr_login password step). On the TV the field is always cleared. On the phone
 * it is cleared only when the check failed: after a success it stays (sealed, device-only) for Enviar configuración.
 */
async function confirmPassword() {
  const tv = isTv();
  const clear = (failedCheck) => (tv || failedCheck ? { clearSettings: TV_CLEAR } : {});
  const c = credentials();
  if (!c.complete) return { message: t(tv ? "status.api_missing.tv" : "status.api_missing.phone"), ...clear(false) };
  const st = mine(QR_KEY, c);
  if (!st || st.stage !== "password") return { message: t(hasSession(c) ? "qr.already" : "pw.notNeeded"), ...clear(false) };
  const typed = kino.config.get("tg_password");
  if (typeof typed !== "string" || !typed) return { message: t("pw.empty"), ...clear(false) };
  const now = clock();
  try {
    const live = await connectForLogin({ deadline: now + ACTION_MS });
    await live.client.checkPassword(typed, { deadline: now + ACTION_MS });
    done();
    return tv ? { message: t("qr.done"), ...clear(false) } : { message: t("phone.done"), setSettings: { login_ok: "1" } };
  } catch (e) {
    const code = errCode(e);
    logStop("password check", e);
    if (code === "password_invalid") return { message: t("pw.wrong"), ...clear(true) };
    if (code === "login_budget") return { message: t("pw.budget", { min: minutes(e.seconds) }), ...clear(true) };
    if (code === "flood_wait") { failed(c, e); return { message: t("qr.flood", { min: minutes(e.seconds) }), ...clear(true) }; }
    return { message: t("qr.failed"), ...clear(true) };
  }
}

/** The logout action: auth.logOut when there is a session (best effort), then the session, login_ok, the code and the 2FA password go. */
async function logout() {
  const clear = { clearSettings: ["tg_password", "login_code", "login_ok"] };
  const c = credentials();
  const had = !!readJson("tg.usession");
  if (c.complete && hasSession(c)) {
    try {
      const live = await connectForLogin({ deadline: clock() + 8000 });
      await live.client.logOut({ deadline: clock() + 8000 });
    } catch (e) {
      kino.log("logout on Telegram failed (" + errCode(e) + "): the session is deleted here anyway");
    }
  }
  qr = null;
  for (const k of [QR_KEY, PHONE_KEY, AUTO_KEY, PW_TRIED_KEY]) remove(k);
  await forgetSession();
  return { message: t(had ? "logout.done" : "logout.none"), ...clear };
}
return { ACCOUNT_BUDGET, received, startQr, tvPage, autoStopped, sendPhoneCode, signInWithCode, phonePage, loginStage, confirmPassword, logout };
})();

// ---- src/account/key.js ----
const __mod_src_account_key = (() => {
// The sync key (manifest: sync.keySecret = "syncKey", sync.generateKey = true): Kino makes it by itself (apiVersion 13),
// 32 random bytes as 64 lower-case hex characters, when the person switches the provider on or presses Enviar
// configuración, and derives the snapshot's encryption key from it on every device. The other devices receive it with
// Recibir configuración, together with api_id and api_hash. Kino never draws the field; this plugin never makes,
// stores, shows or logs the key, and only checks its shape (validateSettings).
const KEY_SHAPE = /^[0-9a-f]{64}$/;
return { KEY_SHAPE };
})();

// ---- src/plugin.js (entry) ----
// Sync-Gram Cuenta (unofficial, not affiliated with Telegram): Kino's cross-device sync through the person's own Telegram
// account, no bot. The phone signs in with its number and a code; the TV only receives the configuration and shows a QR
// for the phone's Telegram app by itself (account/login.js). The copy is pinned in Saved Messages over MTProto, through
// the vendored client in its `sync` mode, which can touch Saved Messages only. The bot variant is its own plugin,
// Sync-Gram (docs/plugins/examples/sync-telegram).
//
// This file is the entry: scripts/build.mjs bundles it with everything it imports into plugin/plugin.js, the one file
// Kino loads. Edit src/ and rebuild; never edit plugin/plugin.js.
const { accountPull, accountPush, accountStatus } = __mod_src_account_sync;
const { startQr, tvPage, phonePage, confirmPassword, logout, loginStage, autoStopped, received, sendPhoneCode, signInWithCode } = __mod_src_account_login;
const { credentials, hasSession } = __mod_src_account_session;
const { KEY_SHAPE } = __mod_src_account_key;
const { t } = __mod_src_account_text;

const API_HASH = /^[0-9a-fA-F]{32}$/;
const API_ID = /^[1-9]\d{0,9}$/;
const isTv = () => kino.device === "tv";

export async function syncPull(ctx = {}) {
  return accountPull(ctx || {});
}

export async function syncPush(ctx = {}) {
  return accountPush(ctx || {});
}

export async function syncStatus() {
  return accountStatus();
}

/**
 * What the form hides (Kino 0.9.74+, apiVersion 13 `hide`; an older Kino draws everything). `login_ok` always: only the
 * sign-in writes it. The phone, by stage: signed out, the number and Enviar código; waiting for the code, the code and
 * Iniciar sesión too; the password step, only the 2FA field and its button; signed in, everything but the api fields,
 * Cerrar sesión and the status. The TV: just the status until everything was received or once it is connected; while it
 * signs in, the QR (the "Iniciar sesión de Telegram con QR" button only after the automatic attempt stopped).
 */
const PHONE_LOGIN = ["phone", "send_code", "login_code", "sign_in", "tg_password", "check_password"];
const ALWAYS = ["qr_login", "login_qr", "login_ok"];
export const PHONE_HIDE = Object.freeze({
  noApi: [...ALWAYS, "login_code", "sign_in", "tg_password", "check_password", "logout"],
  signedOut: [...ALWAYS, "login_code", "sign_in", "tg_password", "check_password", "logout"],
  code: [...ALWAYS, "tg_password", "check_password", "logout"],
  password: [...ALWAYS, "phone", "send_code", "login_code", "sign_in", "logout"],
  qr: [...ALWAYS, "login_code", "sign_in", "tg_password", "check_password", "logout"],
  signedIn: [...ALWAYS, "tg3", ...PHONE_LOGIN],
});
const TV_ONLY_STATUS = ["qr_login", "login_qr", "logout", "login_ok"];

function hideNow() {
  const stage = loginStage();
  if (!isTv()) return PHONE_HIDE[stage];
  if (stage === "signedIn" || !received()) return TV_ONLY_STATUS;
  const out = ["logout", "login_ok"];
  if (!autoStopped()) out.push("qr_login");
  if (stage === "password") out.push("login_qr");
  return out;
}

/** The form's lines: the sign-in's own while one is under way (the TV's QR and its line), else the sync status; and what to hide. */
export async function settingsStatus() {
  const page = isTv() ? await tvPage() : phonePage();
  const hide = hideNow();
  if (page.status) return { status: page.status, ...(page.qr ? { login_qr: page.qr } : {}), hide };
  return { status: (await accountStatus()).message, hide };
}

/** A phone that holds login_ok but whose session is gone clears it with any action, so it stops offering Enviar. */
function withLoginOk(answer) {
  if (isTv() || hasSession(credentials()) || !String(kino.config.get("login_ok") ?? "")) return answer;
  if (answer.setSettings && "login_ok" in answer.setSettings) return answer;
  const clear = new Set(answer.clearSettings || []);
  clear.add("login_ok");
  return { ...answer, clearSettings: [...clear] };
}

export async function action(key) {
  if (key === "qr_login") return withLoginOk(await startQr());
  if (key === "send_code") return withLoginOk(await sendPhoneCode());
  if (key === "sign_in") return withLoginOk(await signInWithCode());
  if (key === "check_password") return withLoginOk(await confirmPassword());
  if (key === "logout") return logout();
  return { message: t("qr.failed") };
}

export async function validateSettings(values) {
  const out = {};
  const id = String(values.api_id || "").trim(), hash = String(values.api_hash || "").trim(), key = String(values.syncKey || "");
  const phone = String(values.phone || "").trim(), code = String(values.login_code || "").replace(/\s/g, ""), ok = String(values.login_ok || "");
  if (id && !API_ID.test(id)) out.api_id = t("field.apiId");
  if (hash && !API_HASH.test(hash)) out.api_hash = t("field.apiHash");
  if (key && !KEY_SHAPE.test(key)) out.syncKey = t("field.syncKey");
  if (phone && !(/^\+?[\d\s().-]+$/.test(phone) && /^[1-9]\d{6,14}$/.test(phone.replace(/\D/g, "")))) out.phone = t("phone.invalid");
  if (code && !/^\d{3,8}$/.test(code)) out.login_code = t("field.code");
  if (ok && ok !== "1") out.login_ok = t("field.loginOk");
  return Object.keys(out).length ? out : null;
}
