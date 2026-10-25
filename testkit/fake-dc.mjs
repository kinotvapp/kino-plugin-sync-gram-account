// A fake Telegram cluster for the tests: no network, no real Telegram, no credentials. It implements the server side of
// what the plugin speaks: the obfuscated transport (server-transport.mjs, node:crypto streaming CTR), the DH auth key
// exchange (req_pq_multi, req_DH_params with RSA_PAD decrypted by its own RSA key pair, set_client_DH_params) and the
// encrypted MTProto 2.0 layer (msg_key checks, new_session_created in a container, gzip_packed results,
// bad_server_salt, bad_msg_notification) answering invokeWithLayer/initConnection, auth.importBotAuthorization,
// auth.exportAuthorization/importAuthorization and upload.getFile. Crypto here is node:crypto and BigInt, independent of
// the client's kino.crypto calls. TL framing reuses the library's Writer/Reader (checked against the spike separately).
import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, generatePrimeSync, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { installFakeWebSocket } from "./fake-ws.mjs";
import { ServerTransport } from "./server-transport.mjs";
import { Writer, Reader, CTOR } from "../src/mtproto/tl.js";

export const TELEGRAM_PRIME = BigInt("0xc71caeb9c6b1c9048e6c522f70f13f73980d40238e3e21c14934d037563d930f48198a0aa7c14058229493d22530f4dbfa336f6e0ac925139543aed44cce7c3720fd51f69458705ac68cd4fe6b6b13abdc9746512969328454f18faf8c595f642477fe96bb2a941d5bcd1d4ac8cc49880708fa9b378e3c4f3a9060bee67cf9a4a4a695811051907e162753b56b0f6b410dba74d8a84b2a14b3144e0ef1284754fd17ed950d5965b4b9dd46582db1178d169c6bc465b0d6ff9ca3928fef5b9ae4e418fc15e83ebea0f87fa9ff5eed70050ded2849f47bf959d956850ce929851f0d8115f635b105ee2e4e15d04b2454bf6f4fadf034b10403119cd8e3b92fcc5b");
const HOST_DC = { pluto: 1, venus: 2, aurora: 3, vesta: 4, flora: 5 };

const sha1 = (...b) => createHash("sha1").update(Buffer.concat(b)).digest();
const sha256 = (...b) => createHash("sha256").update(Buffer.concat(b)).digest();
const big = (b) => (b.length ? BigInt("0x" + Buffer.from(b).toString("hex")) : 0n);
const bytesOf = (n, len) => { let h = n.toString(16); if (h.length % 2) h = "0" + h; const b = Buffer.from(h, "hex"); return len ? Buffer.concat([Buffer.alloc(len - b.length), b]) : b; };
function modPow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = (r * b) % m; e >>= 1n; b = (b * b) % m; } return r; }
const flip = (b) => { const c = Buffer.from(b); c[c.length - 1] ^= 1; return c; };
const xor = (a, b) => Buffer.from(a.map((v, i) => v ^ b[i]));
function ige(data, key, iv, encrypt) {
  const c = (encrypt ? createCipheriv : createDecipheriv)("aes-256-ecb", key, null);
  c.setAutoPadding(false);
  let y = iv.subarray(0, 16), x = iv.subarray(16, 32);
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 16) {
    const blk = data.subarray(i, i + 16);
    if (encrypt) { const o = xor(c.update(xor(blk, y)), x); o.copy(out, i); y = o; x = blk; }
    else { const o = xor(c.update(xor(blk, x)), y); o.copy(out, i); x = o; y = blk; }
  }
  return out;
}
function kdf(authKey, msgKey, x) {
  const a = sha256(msgKey, authKey.subarray(x, x + 36)), b = sha256(authKey.subarray(40 + x, 76 + x), msgKey);
  return { key: Buffer.concat([a.subarray(0, 8), b.subarray(8, 24), a.subarray(24, 32)]), iv: Buffer.concat([b.subarray(0, 8), a.subarray(8, 24), b.subarray(24, 32)]) };
}
const tlBytes = (b) => Buffer.from(new Writer().bytes(b).done());

/** The Telegram fingerprint of an RSA public key: low 64 bits of sha1(TL bytes(n) + TL bytes(e)), as a signed decimal. */
export function fingerprintOf(n, e) {
  const h = sha1(tlBytes(bytesOf(n)), tlBytes(bytesOf(e)));
  return h.readBigInt64LE(12).toString();
}

let cachedRsa = null;
/** A 2048-bit RSA key pair for the fake DC, and the public key table the client is given instead of Telegram's. */
export function fakeRsa() {
  if (cachedRsa) return cachedRsa;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 65537 });
  const jwk = privateKey.export({ format: "jwk" });
  const n = big(Buffer.from(jwk.n, "base64url")), d = big(Buffer.from(jwk.d, "base64url")), e = 65537n;
  const fingerprint = fingerprintOf(n, e);
  cachedRsa = { n, e, d, fingerprint, publicKeys: { [fingerprint]: { n: n.toString(16), e: "65537" } } };
  return cachedRsa;
}

export class FakeTelegram {
  constructor({ rsa = fakeRsa(), prime = TELEGRAM_PRIME, g = 3 } = {}) {
    this.rsa = rsa;
    this.prime = prime;
    this.g = g;
    this.dcs = new Map();
    this.exported = new Map();
    this.files = new Map();
    // `api`: handlers for the update/message methods (testkit/fake-world.mjs or a replay), each (args) -> Buffer, or
    // throwing { rpc: [code, message] }. `requests` records every such call: { method, ...args }.
    this.api = null;
    this.requests = [];
    this.fake = null;
  }
  dc(id) {
    if (!this.dcs.has(id)) this.dcs.set(id, new FakeDc(this, id));
    return this.dcs.get(id);
  }
  /** A file served by DC `dc`: bytes `data`, file reference `fileReference`. */
  addFile({ id, accessHash, fileReference, dc, data, thumbs = {} }) {
    // `thumbs`: the document's thumbnails by type letter ({ m: Buffer }), served by getFile with that thumb_size.
    const t = Object.fromEntries(Object.entries(thumbs).map(([k, v]) => [k, Buffer.from(v)]));
    this.files.set(String(id), { accessHash: BigInt(accessHash), fileReference: Buffer.from(fileReference), dc, data: Buffer.from(data), thumbs: t });
  }
  install() {
    this.fake = installFakeWebSocket((url) => {
      const m = /^wss:\/\/([a-z]+)\.web\.telegram\.org\/apiws$/.exec(url);
      return m && HOST_DC[m[1]] ? this.dc(HOST_DC[m[1]]) : null;
    });
    return this;
  }
  restore() { if (this.fake) this.fake.restore(); this.fake = null; }
}

export class FakeDc {
  constructor(cluster, id) {
    this.cluster = cluster;
    this.id = id;
    this.authKeys = new Map(); // auth key id hex -> { key, authorized }
    this.salt = randomBytes(8);
    this.clockSkew = 0;
    this.userMigrateTo = null;
    this.gzipResults = true;
    this.gzipFiles = false;
    this.gzipMessages = false;
    // Handshake tampering for the security tests (each field breaks one thing the client must check):
    // resPqNonce, dhNonce, dhServerNonce, innerNonce, innerServerNonce, answerHash, prime (BigInt), g (number),
    // dhGen ("retry" | "fail"), dhGenNonce, dhGenServerNonce, newNonceHash.
    this.tamper = {};
    this.hooks = [];
    this.connections = [];
    this.stats = { connections: 0, keyExchanges: 0, botLogins: 0, exportAuth: 0, importAuth: 0, getFile: 0, initConnection: 0, layers: [], badSalts: 0, acks: 0 };
  }
  now() { return Math.floor(Date.now() / 1000) + this.clockSkew; }
  /** A one-shot behaviour for the next request named `method` ("login", "getFile", "any"): fn(ctx) -> reply or undefined. */
  once(method, fn) { this.hooks.push({ method, fn }); }
  rotateSalt() { this.salt = randomBytes(8); }
  /** Drops every open connection (a network change). */
  dropConnections() { for (const c of this.connections) c.socket.serverClose(); }
  forgetKeys() { this.authKeys.clear(); }
  accept(socket) {
    this.stats.connections++;
    const conn = new DcConnection(this, socket);
    this.connections.push(conn);
    return conn.transport;
  }
}

class DcConnection {
  constructor(dc, socket) {
    this.dc = dc;
    this.socket = socket;
    this.transport = new ServerTransport(socket, (p) => this.onPacket(p));
    // upload.getFile requests received and not answered yet on this connection; the most ever seen is in dc.stats.
    this.fileInFlight = 0;
    this.transport.onClose = () => { this.fileInFlight = 0; };
    this.dh = null;
    this.sessions = new Map(); // session id hex -> { seq }
    this.inited = false;
    this.lastMsgId = 0n;
  }
  serverMsgId() {
    let id = (BigInt(this.dc.now()) << 32n) | (BigInt(randomBytes(4).readUInt32LE(0) & 0x7ffffffc) | 1n);
    // Increasing within one second only: a test may jump the fake clock backwards (clockSkew).
    if (id <= this.lastMsgId && id >> 32n === this.lastMsgId >> 32n) id = this.lastMsgId + 4n;
    return (this.lastMsgId = id);
  }
  onPacket(p) {
    if (p.length >= 8 && p.readBigInt64LE(0) === 0n) return this.onPlain(p);
    return this.onEncrypted(p);
  }

  // ---- unencrypted: the DH exchange ----
  plainReply(body) {
    const w = new Writer().long(0n).long(this.serverMsgId()).int(body.length).raw(body).done();
    this.transport.send(Buffer.from(w));
  }
  onPlain(p) {
    const len = p.readUInt32LE(16);
    const r = new Reader(new Uint8Array(p.subarray(20, 20 + len)));
    const ctor = r.int();
    const { rsa, prime, g } = this.dc.cluster;
    if (ctor === CTOR.reqPqMulti) {
      const nonce = Buffer.from(r.int128());
      const P = generatePrimeSync(31, { bigint: true }), Q = generatePrimeSync(31, { bigint: true });
      this.dh = { nonce, serverNonce: randomBytes(16), p: P < Q ? P : Q, q: P < Q ? Q : P };
      this.dh.pq = this.dh.p * this.dh.q;
      this.plainReply(new Writer().int(CTOR.resPQ).raw(this.dc.tamper.resPqNonce ? flip(nonce) : nonce).raw(this.dh.serverNonce).bytes(bytesOf(this.dh.pq)).vectorLong([BigInt(rsa.fingerprint), 42n]).done());
    } else if (ctor === CTOR.reqDHParams) {
      const s = this.dh;
      if (!Buffer.from(r.int128()).equals(s.nonce) || !Buffer.from(r.int128()).equals(s.serverNonce)) throw new Error("fake DC: nonce");
      if (big(r.bytes()) !== s.p || big(r.bytes()) !== s.q) throw new Error("fake DC: p/q");
      if (r.long().toString() !== rsa.fingerprint) throw new Error("fake DC: fingerprint");
      const encrypted = Buffer.from(r.bytes());
      // RSA_PAD, reversed
      const keyAesEncrypted = bytesOf(modPow(big(encrypted), rsa.d, rsa.n), 256);
      const tempKey = xor(keyAesEncrypted.subarray(0, 32), sha256(keyAesEncrypted.subarray(32)));
      const dataWithHash = ige(keyAesEncrypted.subarray(32), tempKey, Buffer.alloc(32), false);
      const dataWithPadding = Buffer.from(dataWithHash.subarray(0, 192)).reverse();
      if (!sha256(tempKey, dataWithPadding).equals(dataWithHash.subarray(192))) throw new Error("fake DC: RSA_PAD hash");
      const ir = new Reader(new Uint8Array(dataWithPadding));
      if (ir.int() !== CTOR.pqInnerDataDc) throw new Error("fake DC: inner ctor");
      if (big(ir.bytes()) !== s.pq || big(ir.bytes()) !== s.p || big(ir.bytes()) !== s.q) throw new Error("fake DC: inner pq");
      if (!Buffer.from(ir.int128()).equals(s.nonce) || !Buffer.from(ir.int128()).equals(s.serverNonce)) throw new Error("fake DC: inner nonce");
      s.newNonce = Buffer.from(ir.int256());
      if (ir.int() !== this.dc.id) throw new Error("fake DC: inner dc");
      s.a = big(randomBytes(256));
      const t = this.dc.tamper;
      const useG = t.g !== undefined ? t.g : g, usePrime = t.prime !== undefined ? t.prime : prime;
      const gA = this.dc.forceGa !== undefined ? this.dc.forceGa : modPow(BigInt(useG), s.a, usePrime);
      const answer = Buffer.from(new Writer().int(CTOR.serverDHInnerData).raw(t.innerNonce ? flip(s.nonce) : s.nonce).raw(t.innerServerNonce ? flip(s.serverNonce) : s.serverNonce)
        .int(useG).bytes(bytesOf(usePrime)).bytes(bytesOf(gA)).int(this.dc.now()).done());
      s.prime = usePrime;
      const withHash = Buffer.concat([t.answerHash ? flip(sha1(answer)) : sha1(answer), answer]);
      const padded = Buffer.concat([withHash, randomBytes((16 - (withHash.length % 16)) % 16)]);
      s.tmpKey = Buffer.concat([sha1(s.newNonce, s.serverNonce), sha1(s.serverNonce, s.newNonce).subarray(0, 12)]);
      s.tmpIv = Buffer.concat([sha1(s.serverNonce, s.newNonce).subarray(12), sha1(s.newNonce, s.newNonce), s.newNonce.subarray(0, 4)]);
      this.plainReply(new Writer().int(CTOR.serverDHParamsOk).raw(t.dhNonce ? flip(s.nonce) : s.nonce).raw(t.dhServerNonce ? flip(s.serverNonce) : s.serverNonce).bytes(ige(padded, s.tmpKey, s.tmpIv, true)).done());
    } else if (ctor === CTOR.setClientDHParams) {
      const s = this.dh;
      r.int128(); r.int128();
      const dec = ige(Buffer.from(r.bytes()), s.tmpKey, s.tmpIv, false);
      const ir = new Reader(new Uint8Array(dec.subarray(20)));
      if (ir.int() !== CTOR.clientDHInnerData) throw new Error("fake DC: client inner");
      ir.int128(); ir.int128(); ir.long();
      const gB = big(ir.bytes());
      if (!sha1(dec.subarray(20, 20 + ir.o)).equals(dec.subarray(0, 20))) throw new Error("fake DC: client inner hash");
      const authKey = bytesOf(modPow(gB, s.a, s.prime), 256);
      const authKeyId = sha1(authKey).subarray(12, 20);
      const hash1 = sha1(s.newNonce, Buffer.from([1]), sha1(authKey).subarray(0, 8)).subarray(4, 20);
      this.dc.authKeys.set(authKeyId.toString("hex"), { key: authKey, authorized: false });
      this.dc.salt = xor(s.newNonce.subarray(0, 8), s.serverNonce.subarray(0, 8));
      this.dc.stats.keyExchanges++;
      const t = this.dc.tamper;
      const genCtor = t.dhGen === "retry" ? CTOR.dhGenRetry : t.dhGen === "fail" ? CTOR.dhGenFail : CTOR.dhGenOk;
      this.plainReply(new Writer().int(genCtor).raw(t.dhGenNonce ? flip(s.nonce) : s.nonce).raw(t.dhGenServerNonce ? flip(s.serverNonce) : s.serverNonce)
        .raw(t.newNonceHash ? flip(hash1) : hash1).done());
    } else {
      throw new Error("fake DC: unexpected plain ctor 0x" + ctor.toString(16));
    }
  }

  // ---- encrypted MTProto 2.0 ----
  onEncrypted(p) {
    const entry = this.dc.authKeys.get(p.subarray(0, 8).toString("hex"));
    if (!entry) return this.transport.sendError(-404);
    const authKey = entry.key;
    const msgKey = p.subarray(8, 24);
    const { key, iv } = kdf(authKey, msgKey, 0);
    const plain = ige(p.subarray(24), key, iv, false);
    if (!sha256(authKey.subarray(88, 120), plain).subarray(8, 24).equals(msgKey)) throw new Error("fake DC: client msg_key");
    const salt = plain.subarray(0, 8), sessionId = plain.subarray(8, 16).toString("hex");
    const msgId = plain.readBigInt64LE(16), seqno = plain.readInt32LE(24), len = plain.readUInt32LE(28);
    const body = plain.subarray(32, 32 + len);
    const padding = plain.length - 32 - len;
    if (padding < 12 || padding > 1024) throw new Error("fake DC: padding " + padding);
    if (msgId % 4n !== 0n) throw new Error("fake DC: client msg_id not divisible by 4");
    const out = { entry, authKey, sessionId, pending: [] };
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { seq: 0 });
      out.pending.push(new Writer().int(CTOR.newSessionCreated).long(msgId).long(BigInt(randomBytes(8).readBigInt64LE(0))).raw(this.dc.salt).done());
    }
    const ctor = body.readUInt32LE(0);
    if (ctor === CTOR.msgsAck) { this.dc.stats.acks++; return; }
    if ((seqno & 1) === 0) throw new Error("fake DC: a request with an even seqno");
    // Telegram's msg_id time window: at most 300 s in the past (16, too low) or 30 s in the future (17, too high).
    const msgTime = Number(msgId >> 32n);
    const timeCode = msgTime < this.dc.now() - 300 ? 16 : msgTime > this.dc.now() + 30 ? 17 : 0;
    if (timeCode) {
      this.dc.stats.badTimes = (this.dc.stats.badTimes || 0) + 1;
      out.pending.push(new Writer().int(CTOR.badMsgNotification).long(msgId).int(seqno).int(timeCode).done());
      return this.flush(out);
    }
    if (!salt.equals(this.dc.salt)) {
      this.dc.stats.badSalts++;
      out.pending.push(new Writer().int(CTOR.badServerSalt).long(msgId).int(seqno).int(48).raw(this.dc.salt).done());
      return this.flush(out);
    }
    if (methodName(body) === "getFile") {
      this.fileInFlight++;
      this.dc.stats.maxFileInFlight = Math.max(this.dc.stats.maxFileInFlight || 0, this.fileInFlight);
      out.isFile = true;
    }
    const hookIndex = this.dc.hooks.findIndex((h) => h.method === "any" || h.method === methodName(body));
    if (hookIndex >= 0) {
      const [hook] = this.dc.hooks.splice(hookIndex, 1);
      const reply = hook.fn({ msgId, body, conn: this });
      this.answer(reply, out, msgId, seqno, body, entry);
      return;
    }
    this.answer(null, out, msgId, seqno, body, entry);
  }
  /** The answer to one request, after a hook's `reply` (`delayMs` answers that much later, then as `reply` says). */
  answer(reply, out, msgId, seqno, body, entry) {
    if (reply && reply.delayMs) {
      const rest = { ...reply, delayMs: 0 };
      setTimeout(() => { if (this.socket.readyState === 1) this.answer(rest, out, msgId, seqno, body, entry); }, reply.delayMs);
      return;
    }
    // Answered from here on (a silent request stays in flight; a bundled one counts as answered when its bundle goes).
    if (out.isFile && !(reply && reply.silent) && !(this.dc.bundleFiles && !(reply && (reply.error || reply.garbage || reply.close || reply.transportError || reply.badMsg || reply.hugeLength)))) this.fileInFlight = Math.max(0, this.fileInFlight - 1);
    {
      if (reply && reply.badMsg) {
        out.pending.push(new Writer().int(CTOR.badMsgNotification).long(msgId).int(seqno).int(reply.badMsg).done());
        return this.flush(out);
      }
      if (reply && reply.silent) return;
      // Fault injection: a packet of random bytes instead of the answer (the client cannot decrypt it).
      if (reply && reply.garbage) { this.transport.send(randomBytes(reply.garbage === true ? 96 : reply.garbage)); return; }
      if (reply && reply.close) { this.socket.serverClose(); return; }
      if (reply && reply.hugeLength) { this.transport.sendLengthOnly(reply.hugeLength); return; }
      if (reply && reply.transportError) { this.transport.sendError(reply.transportError); return; }
      if (reply && reply.tamper) out.tamper = reply.tamper;
      // Fault injection: the server starts a new session whose first_msg_id is after this request, and loses it.
      if (reply && reply.sessionReset) {
        out.pending.push(new Writer().int(CTOR.newSessionCreated).long(msgId + 4n).long(BigInt(randomBytes(8).readBigInt64LE(0))).raw(this.dc.salt).done());
        if (out.isFile) this.fileInFlight = Math.max(0, this.fileInFlight - 1);
        return this.flush(out);
      }
      if (reply && reply.error) { out.pending.push(rpcResult(msgId, rpcError(...reply.error))); return this.flush(out); }
    }
    let result;
    try { result = this.rpc(new Reader(new Uint8Array(body)), entry); } catch (e) { if (e.rpc) result = rpcError(...e.rpc); else throw e; }
    const head = Buffer.from(result).readUInt32LE(0);
    const gzip = head === CTOR.rpcError ? false : head === CTOR.uploadFile ? this.dc.gzipFiles : this.dc.gzipResults;
    // dc.bundleFiles = { count, pad?, once? }: upload.file answers wait until `count` of them are ready and go out in ONE
    // container packet (plus, with `pad`, a filler message of that many bytes), the way Telegram may pack the answers of
    // several requests in flight.
    if (this.dc.bundleFiles && head === CTOR.uploadFile) {
      const b = this.dc.bundleFiles;
      this.bundle = this.bundle || { msgs: [], files: 0 };
      this.bundle.msgs.push(...out.pending, rpcResult(msgId, result, gzip));
      this.bundle.files++;
      if (this.bundle.files >= b.count) {
        const msgs = this.bundle.msgs;
        this.fileInFlight = Math.max(0, this.fileInFlight - this.bundle.files);
        this.bundle = null;
        if (b.pad) msgs.push(new Writer().int(0x1badf00d).raw(Buffer.alloc(b.pad)).done());
        if (b.once) this.dc.bundleFiles = null;
        this.flush({ ...out, pending: msgs });
      }
      return;
    }
    out.pending.push(rpcResult(msgId, result, gzip));
    this.flush(out);
    // Fault injection: the same answer once more (a duplicate for a request already answered).
    if (reply && reply.duplicate) this.flush({ ...out, pending: [rpcResult(msgId, result, gzip)] });
  }
  flush({ authKey, sessionId, pending, tamper }) {
    if (!pending.length) return;
    const body = pending.length === 1 ? pending[0] : this.container(sessionId, pending);
    // gzipMessages: the whole message (a container too) inside gzip_packed, as Telegram may send it.
    this.sendEncrypted(authKey, sessionId, this.dc.gzipMessages ? new Writer().int(CTOR.gzipPacked).bytes(gzipSync(Buffer.from(body))).done() : body, tamper);
  }
  nextSeq(sessionId, content = true) {
    const s = this.sessions.get(sessionId);
    return content ? s.seq++ * 2 + 1 : s.seq * 2;
  }
  container(sessionId, bodies) {
    const w = new Writer().int(CTOR.msgContainer).int(bodies.length);
    for (const b of bodies) w.long(this.serverMsgId()).int(this.nextSeq(sessionId)).int(b.length).raw(b);
    return w.done();
  }
  /** `tamper`: "byte" flips one encrypted byte (msg_key no longer matches), "session" answers under another session id. */
  sendEncrypted(authKey, sessionIdHex, body, tamper) {
    const sid = tamper === "session" ? randomBytes(8) : Buffer.from(sessionIdHex, "hex");
    // tamper "padding": the length field claims 16 bytes more than the body, so the padding left is under 12 bytes.
    const lenField = tamper === "padding" ? body.length + 16 : body.length;
    // tamper "evenId": a server msg_id that is even (servers' are odd); "dupId": the previous message's id again.
    const msgId = tamper === "dupId" && this.lastSentId ? this.lastSentId : tamper === "evenId" ? this.serverMsgId() - 1n : this.serverMsgId();
    this.lastSentId = msgId;
    const head = Buffer.from(new Writer().raw(this.dc.salt).raw(sid).long(msgId).int(this.nextSeq(sessionIdHex)).int(lenField).raw(body).done());
    const plain = Buffer.concat([head, randomBytes(12 + ((16 - ((head.length + 12) % 16)) % 16))]);
    const msgKey = sha256(authKey.subarray(96, 128), plain).subarray(8, 24);
    const { key, iv } = kdf(authKey, msgKey, 8);
    const enc = ige(plain, key, iv, true);
    if (tamper === "byte") enc[enc.length - 20] ^= 0x40;
    // tamper "keyId": the packet names another auth key.
    const keyId = tamper === "keyId" ? randomBytes(8) : sha1(authKey).subarray(12, 20);
    const packet = Buffer.concat([keyId, msgKey, enc]);
    // dc.coalesce: the packets of one tick go out together, several in one WebSocket frame; dc.splitFrames: each packet
    // is cut over that many frames.
    if (this.dc.coalesce) {
      if (!this.outQueue) { this.outQueue = []; setImmediate(() => { const q = this.outQueue; this.outQueue = null; if (this.socket.readyState === 1) this.transport.sendMany(q); }); }
      this.outQueue.push(packet);
      return;
    }
    this.transport.send(packet, { split: this.dc.splitFrames || 1 });
  }

  rpc(r, entry) {
    const dc = this.dc;
    const ctor = r.int();
    if (ctor === CTOR.invokeWithLayer) { dc.stats.layers.push(r.int()); return this.rpc(r, entry); }
    if (ctor === CTOR.initConnection) {
      if (r.int() !== 0) throw new Error("fake DC: initConnection flags");
      this.apiId = r.int();
      for (let i = 0; i < 6; i++) r.string();
      dc.stats.initConnection++;
      this.inited = true;
      return this.rpc(r, entry);
    }
    if (!this.inited) throw { rpc: [400, "CONNECTION_NOT_INITED"] };
    (dc.cluster.methodIds = dc.cluster.methodIds || []).push(ctor); // every method id that reached the cluster
    // Account mode (testkit/fake-account.mjs): the QR login, the 2FA password, the logout and the read-only library calls.
    if (dc.cluster.account) {
      const answer = dc.cluster.account.rpc(ctor, r, { dc, entry, conn: this });
      if (answer !== undefined) return new Uint8Array(answer);
    }
    if (ctor === CTOR.importBotAuthorization) {
      r.int(); r.int();
      const apiHash = r.string(), token = r.string();
      dc.stats.botLogins++;
      dc.lastLogin = { apiHash, token, apiId: this.apiId };
      if (dc.userMigrateTo) throw { rpc: [303, "USER_MIGRATE_" + dc.userMigrateTo] };
      entry.authorized = true;
      return authorization(777001n);
    }
    if (ctor === CTOR.exportAuthorization) {
      const target = r.int();
      if (!entry.authorized) throw { rpc: [401, "AUTH_KEY_UNREGISTERED"] };
      dc.stats.exportAuth++;
      const id = BigInt(randomBytes(8).readBigInt64LE(0));
      const bytes = randomBytes(64);
      dc.cluster.exported.set(id.toString(), { bytes, dc: target });
      return new Writer().int(CTOR.exportedAuthorization).long(id).bytes(bytes).done();
    }
    if (ctor === CTOR.importAuthorization) {
      const id = r.long(), bytes = Buffer.from(r.bytes());
      const e = dc.cluster.exported.get(id.toString());
      if (!e || !e.bytes.equals(bytes) || e.dc !== dc.id) throw { rpc: [400, "AUTH_BYTES_INVALID"] };
      dc.cluster.exported.delete(id.toString());
      dc.stats.importAuth++;
      entry.authorized = true;
      return authorization(777001n);
    }
    if (ctor === CTOR.uploadGetFile) {
      r.int();
      if (r.int() !== CTOR.inputDocumentFileLocation) throw { rpc: [400, "LOCATION_INVALID"] };
      const id = r.long(), accessHash = r.long(), fileReference = Buffer.from(r.bytes());
      const thumbSize = r.string();
      const offset = Number(r.long()), limit = r.int();
      dc.stats.getFile++;
      if (thumbSize) (dc.stats.thumbs = dc.stats.thumbs || []).push(thumbSize);
      (dc.stats.getFileOffsets = dc.stats.getFileOffsets || []).push(offset);
      if (!entry.authorized) throw { rpc: [401, "AUTH_KEY_UNREGISTERED"] };
      if (dc.cluster.account && entry.account) dc.cluster.account.needAccount(entry);
      const f = dc.cluster.files.get(id.toString());
      if (!f || f.accessHash !== accessHash) throw { rpc: [400, "FILE_ID_INVALID"] };
      if (f.dc !== dc.id) throw { rpc: [303, "FILE_MIGRATE_" + f.dc] };
      if (!f.fileReference.equals(fileReference)) throw { rpc: [400, "FILE_REFERENCE_EXPIRED"] };
      if (offset % 4096 || limit % 4096 || 1048576 % limit || Math.floor(offset / 1048576) !== Math.floor((offset + limit - 1) / 1048576)) throw { rpc: [400, "LIMIT_INVALID"] };
      const source = thumbSize ? f.thumbs[thumbSize] : f.data;
      if (!source) throw { rpc: [400, "LOCATION_INVALID"] };
      return new Writer().int(CTOR.uploadFile).int(0xb3cea0e4).int(dc.now()).bytes(source.subarray(offset, offset + limit)).done();
    }
    const call = readApiCall(ctor, r);
    if (call) {
      if (!entry.authorized) throw { rpc: [401, "AUTH_KEY_UNREGISTERED"] };
      dc.cluster.requests.push(call);
      if (call.method === "messagesGetHistory") throw { rpc: [400, "BOT_METHOD_INVALID"] };
      if (dc.cluster.account && entry.account) dc.cluster.account.needAccount(entry);
      const api = dc.cluster.api;
      if (!api || typeof api[call.method] !== "function") throw { rpc: [400, "METHOD_NOT_IN_FAKE_DC"] };
      return new Uint8Array(api[call.method](call));
    }
    throw { rpc: [400, "METHOD_NOT_IN_FAKE_DC"] };
  }
}

// The update/message methods the discovery sends, read field by field from their layer-198 TL lines:
// updates.getState#edd4882a = updates.State
// updates.getDifference#19c2f763 flags:# pts:int pts_limit:flags.1?int pts_total_limit:flags.0?int date:int qts:int qts_limit:flags.2?int
// updates.getChannelDifference#3173d78 flags:# force:flags.0?true channel:InputChannel filter:ChannelMessagesFilter pts:int limit:int
// channels.getMessages#ad8c9a23 channel:InputChannel id:Vector<InputMessage>
// messages.getMessages#63c66506 id:Vector<InputMessage>
// messages.getHistory#4423e6c5 (bots: BOT_METHOD_INVALID)
// inputChannel#f35aec28 channel_id:long access_hash:long   inputMessageID#a676a322 id:int   channelMessagesFilterEmpty#94d42ee7
const API = { getState: 0xedd4882a, getDifference: 0x19c2f763, getChannelDifference: 0x03173d78, channelsGetMessages: 0xad8c9a23, messagesGetMessages: 0x63c66506, messagesGetHistory: 0x4423e6c5 };
function readInputChannel(r) {
  const c = r.int();
  if (c !== 0xf35aec28) throw { rpc: [400, "CHANNEL_INVALID"] };
  return { channelId: r.long(), accessHash: r.long() };
}
function readInputMessageIds(r) {
  const n = r.vectorHeader();
  const ids = [];
  for (let i = 0; i < n; i++) {
    if (r.int() !== 0xa676a322) throw { rpc: [400, "MESSAGE_IDS_EMPTY"] };
    ids.push(r.int32());
  }
  return ids;
}
function readApiCall(ctor, r) {
  switch (ctor) {
    case API.getState: return { method: "getState" };
    case API.getDifference: {
      const flags = r.int();
      const pts = r.int32();
      if (flags & 2) r.int();
      if (flags & 1) r.int();
      const date = r.int32(), qts = r.int32();
      if (flags & 4) r.int();
      return { method: "getDifference", pts, date, qts };
    }
    case API.getChannelDifference: {
      const flags = r.int();
      const ch = readInputChannel(r);
      const filter = r.int();
      if (filter !== 0x94d42ee7) throw { rpc: [400, "FILTER_NOT_SUPPORTED"] };
      return { method: "getChannelDifference", force: (flags & 1) !== 0, ...ch, pts: r.int32(), limit: r.int32() };
    }
    case API.channelsGetMessages: { const ch = readInputChannel(r); return { method: "channelsGetMessages", ...ch, ids: readInputMessageIds(r) }; }
    case API.messagesGetMessages: return { method: "messagesGetMessages", ids: readInputMessageIds(r) };
    case API.messagesGetHistory: return { method: "messagesGetHistory" };
    default: return null;
  }
}

function methodName(body) {
  let r = new Reader(new Uint8Array(body));
  for (;;) {
    const c = r.int();
    if (c === CTOR.invokeWithLayer) { r.int(); continue; }
    if (c === CTOR.initConnection) { r.int(); r.int(); for (let i = 0; i < 6; i++) r.string(); continue; }
    if (c === CTOR.importBotAuthorization) return "login";
    if (c === CTOR.uploadGetFile) return "getFile";
    if (c === CTOR.exportAuthorization) return "exportAuth";
    if (c === CTOR.importAuthorization) return "importAuth";
    for (const [name, id] of Object.entries(API)) if (c === id) return name;
    return "other";
  }
}
const rpcError = (code, message) => new Writer().int(CTOR.rpcError).int(code).string(message).done();
function rpcResult(reqMsgId, result, gzip = false) {
  const inner = gzip ? new Writer().int(CTOR.gzipPacked).bytes(gzipSync(Buffer.from(result))).done() : result;
  return new Writer().int(CTOR.rpcResult).long(reqMsgId).raw(inner).done();
}
const authorization = (userId) =>
  new Writer().int(CTOR.authAuthorization).int(0).int(CTOR.user).int(1 << 14).int(0).long(userId).done();
