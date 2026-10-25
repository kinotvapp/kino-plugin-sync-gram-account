// Saved Messages for the fake account (Sync-Gram Cuenta). Not vendored: Sync-Gram Cuenta's own test code, written to plug
// into the vendored fake cluster without changing it. `new FakeSaved(account).install(tg)` puts it in front of the
// FakeAccount: the fake DC hands every method to `tg.account.rpc` first, so the methods the `sync` client mode sends are
// answered here (upload.saveFilePart, messages.sendMedia, messages.updatePinnedMessage, messages.deleteMessages,
// messages.search with the pinned filter and min_id/max_id) and everything else (the QR login, the 2FA password,
// logOut) goes on to the FakeAccount. upload.getFile stays the fake DC's own: a sent snapshot becomes one of its files.
//
// Answers are built with the independent test serializer (tl-serializer.mjs), from the layer-198 TL lines quoted in
// src/mtproto/sync-requests.js; every request is recorded in `log` ({ method, ...fields }) so a test can count a round's
// requests and check each one's flags and peer. Message ids are shared by every private chat and basic group of the
// account (as in Telegram), so a delete of an id that is not in Saved Messages removes it from whichever chat has it,
// and `log` says so (`chats`): the tests assert that never happens.
import { randomBytes } from "node:crypto";
import * as S from "./tl-serializer.mjs";

const { u32, i32, i64, str, vec } = S.raw;
const cat = (...p) => Buffer.concat(p.filter(Boolean));
const bit = (on, n) => (on ? 1 << n : 0) >>> 0;

export const SYNC_METHODS = Object.freeze({
  saveFilePart: 0xb304a621, sendMedia: 0x7852834e, updatePinnedMessage: 0xd2aaf7ec, deleteMessages: 0xe58e95d2,
  search: 0x29ee847a,
});
const NAME_OF = Object.fromEntries(Object.entries(SYNC_METHODS).map(([k, v]) => [v, k]));
// The phone sign-in, layer 198 (TL lines in src/mtproto/phone-requests.js): auth.sendCode and auth.signIn.
export const PHONE_METHODS = Object.freeze({ sendCode: 0xa677244f, signIn: 0x8d52a951 });
const PHONE_NAME_OF = Object.fromEntries(Object.entries(PHONE_METHODS).map(([k, v]) => [v, k]));
const digitsOf = (s) => String(s).replace(/\D/g, "");
const FILTER_PINNED = 0x1bb00451;

function readInputPeer(r) {
  const c = r.int();
  if (c === 0x7da07ec9) return { kind: "self" };
  if (c === 0x7f3b18ea) return { kind: "empty" };
  if (c === 0x35a95cb9) return { kind: "chat", id: r.long() };
  if (c === 0x27bcbbfc) return { kind: "channel", id: r.long(), accessHash: r.long() };
  if (c === 0xdde8a54c) return { kind: "user", id: r.long(), accessHash: r.long() };
  throw { rpc: [400, "PEER_ID_INVALID"] };
}

export class FakeSaved {
  constructor(account) {
    this.account = account;
    this.log = [];
    this.uploads = new Map(); // file id -> Map(part -> Buffer)
    this.pts = 100;
    this.failures = [];       // { method, rpc: [code, message] } consumed by the next request of that method
    this.accessCounter = 1n;
    // The phone sign-in: the account's number, the codes sent (code hash -> { code, dc, expired }), the last code (what
    // the person reads in their Telegram app), and switches for the refusals Telegram may answer.
    this.phone = "+57 300 123 4567";
    this.codes = new Map();
    this.lastCode = null;
    this.unregistered = false;   // the number has no account: auth.authorizationSignUpRequired
    this.sendUnavailable = false; // SEND_CODE_UNAVAILABLE
  }
  /** Every code sent so far expires (Telegram's codes live a few minutes). */
  expireCodes() { for (const c of this.codes.values()) c.expired = true; }
  install(tg) {
    this.account.install(tg); // the QR login's scan() needs tg
    this.tg = tg;
    tg.account = this;
    tg.api = this;
    return this;
  }
  get saved() { return this.account.chats.get(this.account.selfKey); }
  /** The next request of `method` fails with this rpc error (FLOOD_WAIT_30, ...). */
  failNext(method, code, message) { this.failures.push({ method, rpc: [code, message] }); }
  /** The next request of `method` is carried out, then the connection drops before its answer leaves. */
  closeAfter(method) { this.failures.push({ method, close: true }); }
  /** A message the person wrote or pinned in Saved Messages by hand (text, or a document with a file name). */
  personPosts({ text = "", fileName, pinned = false, data = Buffer.from("not ours") } = {}) {
    const doc = fileName === undefined ? undefined : this.newDoc(data, fileName);
    const id = this.account.nextCommonId++;
    this.saved.messages.set(id, { id, date: ++this.account.now, text, doc, pinned, out: true });
    return id;
  }
  /** Ids of the pinned snapshots (kino-sync.bin) in Saved Messages, newest first. */
  pinnedSnapshots() {
    return [...this.saved.messages.values()].filter((m) => m.pinned && m.doc && m.doc.fileName === "kino-sync.bin").map((m) => m.id).sort((a, b) => b - a);
  }
  snapshotData(id) { const m = this.saved.messages.get(id); return m && this.tg.files.get(String(m.doc.id)).data; }

  newDoc(data, fileName) {
    const doc = this.account.doc({ mime: "application/octet-stream", size: data.length, fileName });
    doc.dcId = this.account.homeDc;
    this.tg.addFile({ id: doc.id, accessHash: doc.accessHash, fileReference: doc.fileReference, dc: doc.dcId, data });
    return doc;
  }
  render(m) {
    const self = S.peerUser(this.account.userId);
    const media = m.doc && S.mediaDocument(S.document({ id: m.doc.id, accessHash: m.doc.accessHash, fileReference: m.doc.fileReference, date: m.date, mime: m.doc.mime, size: m.doc.size, dcId: m.doc.dcId, attributes: [S.attrFilename(m.doc.fileName)] }));
    // message#96fdbbe9: out (1), media (9), pinned (24), saved_peer_id (28: Saved Messages answers carry it)
    const flags = bit(m.out, 1) | bit(!!media, 9) | bit(m.pinned, 24) | bit(true, 28);
    return cat(u32(0x96fdbbe9), u32(flags), u32(0), i32(m.id), self, self, i32(m.date), str(m.text), media);
  }
  selfUser() { return S.user({ id: this.account.userId, accessHash: 77n, firstName: this.account.firstName }); }
  updates(list) { return cat(u32(0x74ae4240), vec(list), vec([this.selfUser()]), vec([]), i32(this.account.now), i32(0)); }

  needAccount(entry) { return this.account.needAccount(entry); }
  rpc(ctor, r, ctx) {
    const phoneMethod = PHONE_NAME_OF[ctor];
    if (phoneMethod) {
      const failure = this.failures.findIndex((f) => f.method === phoneMethod);
      if (failure >= 0) { const [f] = this.failures.splice(failure, 1); this.log.push({ method: phoneMethod, failed: f.rpc[1] }); throw { rpc: f.rpc }; }
      return this[phoneMethod](r, ctx);
    }
    const method = NAME_OF[ctor];
    if (!method) return this.account.rpc(ctor, r, ctx);
    this.account.needAccount(ctx.entry);
    const failure = this.failures.findIndex((f) => f.method === method);
    if (failure >= 0) {
      const [f] = this.failures.splice(failure, 1);
      if (f.close) { const answer = this[method](r); ctx.conn.socket.serverClose(); return answer; } // the answer is lost
      this.log.push({ method, failed: f.rpc[1] });
      throw { rpc: f.rpc };
    }
    return this[method](r);
  }

  // auth.sendCode#a677244f phone_number:string api_id:int api_hash:string settings:CodeSettings = auth.SentCode
  // codeSettings#ad253d78 flags:# ...   auth.sentCode#5e002502 flags:# type:auth.SentCodeType phone_code_hash:string ...
  // auth.sentCodeTypeApp#3dbb5986 length:int
  sendCode(r, ctx) {
    const phone = r.string(); r.int(); r.string();
    if (r.int() !== 0xad253d78) throw { rpc: [400, "SETTINGS_INVALID"] };
    if (r.int() !== 0) throw { rpc: [400, "CODE_SETTINGS_NOT_IN_FAKE"] };
    this.log.push({ method: "sendCode", dc: ctx.dc.id }); // never the number
    if (digitsOf(phone) !== digitsOf(this.phone)) throw { rpc: [400, "PHONE_NUMBER_INVALID"] };
    if (ctx.dc.id !== this.account.homeDc) throw { rpc: [303, "PHONE_MIGRATE_" + this.account.homeDc] };
    if (this.sendUnavailable) throw { rpc: [400, "SEND_CODE_UNAVAILABLE"] };
    const code = String(10000 + randomBytes(2).readUInt16LE(0) % 90000);
    const hash = randomBytes(8).toString("hex");
    this.codes.set(hash, { code, dc: ctx.dc.id, expired: false });
    this.lastCode = code;
    return cat(u32(0x5e002502), u32(0), u32(0x3dbb5986), i32(code.length), str(hash));
  }

  // auth.signIn#8d52a951 flags:# phone_number:string phone_code_hash:string phone_code:flags.0?string
  //   email_verification:flags.1?EmailVerification = auth.Authorization
  // auth.authorizationSignUpRequired#44747e9a flags:# terms_of_service:flags.0?help.TermsOfService
  signIn(r, ctx) {
    const flags = r.int();
    const phone = r.string(), hash = r.string(), code = flags & 1 ? r.string() : "";
    this.log.push({ method: "signIn", dc: ctx.dc.id });
    const sent = this.codes.get(hash);
    if (digitsOf(phone) !== digitsOf(this.phone)) throw { rpc: [400, "PHONE_NUMBER_INVALID"] };
    if (!sent || sent.expired || sent.dc !== ctx.dc.id) throw { rpc: [400, "PHONE_CODE_EXPIRED"] };
    if (code !== sent.code) throw { rpc: [400, "PHONE_CODE_INVALID"] };
    this.codes.delete(hash);
    if (this.unregistered) return cat(u32(0x44747e9a), u32(0));
    return this.account.finish(ctx.entry); // SESSION_PASSWORD_NEEDED for a 2FA account, then auth.checkPassword
  }

  // upload.saveFilePart#b304a621 file_id:long file_part:int bytes:bytes = Bool
  saveFilePart(r) {
    const fileId = r.long().toString(), part = r.int32(), bytes = Buffer.from(r.bytes());
    this.log.push({ method: "saveFilePart", fileId, part, size: bytes.length });
    if (part < 0 || part >= 4000) throw { rpc: [400, "FILE_PART_INVALID"] };
    if (bytes.length > 524288) throw { rpc: [400, "FILE_PART_TOO_BIG"] };
    if (!this.uploads.has(fileId)) this.uploads.set(fileId, new Map());
    this.uploads.get(fileId).set(part, bytes);
    return u32(0x997275b5);
  }

  sendMedia(r) {
    const flags = r.int();
    const peer = readInputPeer(r);
    const entry = { method: "sendMedia", silent: (flags & (1 << 5)) !== 0, peer: peer.kind, flags };
    this.log.push(entry);
    if (peer.kind !== "self") throw { rpc: [400, "NOT_SAVED_MESSAGES_IN_FAKE"] };
    if (flags & ~(1 << 5)) throw { rpc: [400, "FLAGS_NOT_IN_FAKE"] };
    if (r.int() !== 0x037c9330) throw { rpc: [400, "MEDIA_INVALID"] };
    const mflags = r.int();
    entry.forceFile = (mflags & (1 << 4)) !== 0;
    if (mflags & ~(1 << 4)) throw { rpc: [400, "MEDIA_FLAGS_NOT_IN_FAKE"] };
    if (r.int() !== 0xf52ff27f) throw { rpc: [400, "FILE_INVALID"] };
    const fileId = r.long().toString(), parts = r.int32(), name = r.string();
    r.string(); // md5_checksum
    const mime = r.string();
    const nAttrs = r.vectorHeader();
    let fileName = name;
    for (let i = 0; i < nAttrs; i++) {
      if (r.int() !== 0x15590068) throw { rpc: [400, "ATTRIBUTE_NOT_IN_FAKE"] };
      fileName = r.string();
    }
    entry.caption = r.string();
    const randomId = r.long();
    const up = this.uploads.get(fileId);
    if (!up || up.size !== parts) throw { rpc: [400, "FILE_PARTS_INVALID"] };
    const chunks = [];
    for (let i = 0; i < parts; i++) {
      const c = up.get(i);
      if (!c) throw { rpc: [400, "FILE_PARTS_INVALID"] };
      const size = up.get(0).length;
      if (i < parts - 1 && (c.length !== size || size % 1024 || 524288 % size)) throw { rpc: [400, "FILE_PART_SIZE_INVALID"] };
      chunks.push(c);
    }
    this.uploads.delete(fileId);
    const doc = this.newDoc(Buffer.concat(chunks), fileName);
    doc.mime = mime;
    const id = this.account.nextCommonId++;
    const m = { id, date: ++this.account.now, text: entry.caption, doc, pinned: false, out: true };
    this.saved.messages.set(id, m);
    entry.id = id;
    entry.size = doc.size;
    this.pts++;
    // updateMessageID#4e90bfd6 id:int random_id:long   updateNewMessage#1f2b0afd message:Message pts:int pts_count:int
    return this.updates([cat(u32(0x4e90bfd6), i32(id), i64(randomId)), S.updateNewMessage(this.render(m), this.pts, 1)]);
  }

  updatePinnedMessage(r) {
    const flags = r.int();
    const peer = readInputPeer(r);
    const id = r.int32();
    this.log.push({ method: "updatePinnedMessage", silent: (flags & 1) !== 0, unpin: (flags & 2) !== 0, peer: peer.kind, id });
    if (peer.kind !== "self") throw { rpc: [400, "NOT_SAVED_MESSAGES_IN_FAKE"] };
    const m = this.saved.messages.get(id);
    if (!m) throw { rpc: [400, "MESSAGE_ID_INVALID"] };
    m.pinned = (flags & 2) === 0;
    this.pts++;
    // updatePinnedMessages#ed85eab5 flags:# pinned:flags.0?true peer:Peer messages:Vector<int> pts:int pts_count:int
    return this.updates([cat(u32(0xed85eab5), u32(bit(m.pinned, 0)), S.peerUser(this.account.userId), vec([i32(id)]), i32(this.pts), i32(1))]);
  }

  deleteMessages(r) {
    const flags = r.int();
    const n = r.vectorHeader();
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(r.int32());
    const chats = [];
    let count = 0;
    for (const id of ids) {
      for (const [key, ch] of this.account.chats) {
        if (ch.kind !== "channel" && ch.messages.delete(id)) { count++; chats.push(key === this.account.selfKey ? "saved" : key); }
      }
    }
    this.log.push({ method: "deleteMessages", revoke: (flags & 1) !== 0, ids, chats });
    this.pts += count;
    return cat(u32(0x84d19185), i32(this.pts), i32(count));
  }

  search(r) {
    const flags = r.int();
    const peer = readInputPeer(r);
    const q = r.string();
    if (flags) throw { rpc: [400, "SEARCH_FLAGS_NOT_IN_FAKE"] };
    const filter = r.int();
    r.int(); r.int();
    const offsetId = r.int32(); r.int32();
    const limit = r.int32(), maxId = r.int32(), minId = r.int32(); r.long();
    this.log.push({ method: "search", peer: peer.kind, pinnedFilter: filter === FILTER_PINNED, limit, minId, maxId });
    if (peer.kind !== "self") throw { rpc: [400, "NOT_SAVED_MESSAGES_IN_FAKE"] };
    if (filter !== FILTER_PINNED || q) throw { rpc: [400, "FILTER_NOT_IN_FAKE"] };
    // min_id and max_id are exclusive here; the client asks id - 1 .. id + 1 and filters, so either reading works.
    const hits = [...this.saved.messages.values()].filter((m) => m.pinned && (!offsetId || m.id < offsetId) && (!maxId || m.id < maxId) && m.id > minId).sort((a, b) => b.id - a.id);
    return S.messagesSlice({ count: hits.length, messages: hits.slice(0, limit).map((m) => this.render(m)), users: [this.selfUser()] });
  }
}
