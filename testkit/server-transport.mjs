// The server side of the obfuscated intermediate transport, written with node:crypto's streaming AES-CTR so the
// client's offset-tracking CtrStream (kino.crypto one-shot calls) is checked against an independent implementation.
import { createCipheriv, createDecipheriv } from "node:crypto";

export class ServerTransport {
  /** `onPacket(Buffer)` gets each client packet; `socket` is the FakeSocket to answer on. */
  constructor(socket, onPacket) {
    this.socket = socket;
    this.onPacket = onPacket;
    this.inBuf = Buffer.alloc(0);
    this.plain = Buffer.alloc(0);
    this.dec = null;
    this.dcFromInit = null;
    this.onClose = null; // set by the fake DC: the socket closed
  }
  onData(u8) {
    let data = Buffer.from(u8);
    if (!this.dec) {
      this.inBuf = Buffer.concat([this.inBuf, data]);
      if (this.inBuf.length < 64) return;
      const init = this.inBuf.subarray(0, 64);
      data = this.inBuf.subarray(64);
      this.dec = createDecipheriv("aes-256-ctr", init.subarray(8, 40), init.subarray(40, 56));
      const decInit = this.dec.update(init);
      if (decInit.readUInt32LE(56) !== 0xeeeeeeee) throw new Error("fake DC: not the intermediate protocol");
      this.dcFromInit = decInit.readInt16LE(60);
      const rev = Buffer.from(init.subarray(8, 56)).reverse();
      this.enc = createCipheriv("aes-256-ctr", rev.subarray(0, 32), rev.subarray(32, 48));
    }
    this.plain = Buffer.concat([this.plain, this.dec.update(data)]);
    while (this.plain.length >= 4) {
      const n = this.plain.readUInt32LE(0);
      if (this.plain.length < 4 + n) break;
      const p = Buffer.from(this.plain.subarray(4, 4 + n));
      this.plain = this.plain.subarray(4 + n);
      this.onPacket(p);
    }
  }
  /** Encrypts `payload` as a packet; `split` cuts the wire bytes into several WebSocket frames. */
  send(payload, { split = 1 } = {}) {
    const len = Buffer.alloc(4);
    len.writeUInt32LE(payload.length);
    const wire = this.enc.update(Buffer.concat([len, payload]));
    this.sendWire(wire, split);
  }
  /** Several packets in one WebSocket frame. */
  sendMany(payloads) {
    const wire = Buffer.concat(payloads.map((p) => { const l = Buffer.alloc(4); l.writeUInt32LE(p.length); return this.enc.update(Buffer.concat([l, p])); }));
    this.sendWire(wire, 1);
  }
  sendWire(wire, split) {
    const step = Math.ceil(wire.length / split);
    for (let i = 0; i < wire.length; i += step) this.socket.deliver(new Uint8Array(wire.subarray(i, i + step)));
  }
  /** Only a packet header announcing `n` bytes, and nothing after it. */
  sendLengthOnly(n) {
    const len = Buffer.alloc(4);
    len.writeUInt32LE(n);
    this.sendWire(this.enc.update(len), 1);
  }
  /** A 4-byte transport error packet. */
  sendError(status) {
    const b = Buffer.alloc(4);
    b.writeInt32LE(status);
    this.send(b);
  }
}
