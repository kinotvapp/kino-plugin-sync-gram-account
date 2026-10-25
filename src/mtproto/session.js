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
import { toHex, fromHex, random, readI32LE } from "./bytes.js";
import { sha256Hex, igeEncryptHex, igeDecryptHex, gunzipHex } from "./crypto.js";
import { Writer, Reader, CTOR, msgsAck, parseRpcError, hexU32, hexBytesAt } from "./tl.js";
import { MsgIds } from "./msgid.js";
import { big } from "./big.js";
import { mtError, fromRpcError, fromTransportError } from "./errors.js";

const MAX_RESENDS = 5;
const ABANDONED_MS = 30000; // an abandoned request still unanswered after this long is taken as lost
const protocol = (m) => mtError("protocol", m);

export class Session {
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
