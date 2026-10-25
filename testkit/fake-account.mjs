// A fake Telegram ACCOUNT for the account-mode tests (0.3.0), plugged into the fake cluster as `tg.account = acct`
// (and `tg.api = acct` for channels.getMessages / messages.getMessages). It is the server side of the QR login
// (auth.exportLoginToken, the official app's scan as `scan()`, auth.loginTokenMigrateTo + auth.importLoginToken on the
// account's DC), the 2FA password (account.getPassword and auth.checkPassword with a real SRP verification written here
// with node:crypto and BigInt, independent of src/mtproto/srp.js), auth.logOut, a revoked session (SESSION_REVOKED), and
// the read-only library calls: messages.getDialogs and messages.search with the video and document filters. Answers
// are built with the independent test serializer (tl-serializer.mjs). Every method that reaches it is recorded in
// `calls` (by name), and every method id the cluster saw in `tg.methodIds`.
import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import * as S from "./tl-serializer.mjs";
import { TELEGRAM_PRIME } from "./fake-dc.mjs";

const { u32, i32, i64, tlBytes, str, vec } = S.raw;
const cat = (...p) => Buffer.concat(p.filter(Boolean));
const bit = (on, n) => (on ? 1 << n : 0) >>> 0;
const H = (...b) => createHash("sha256").update(Buffer.concat(b.map((x) => Buffer.from(x)))).digest();
const big = (b) => BigInt("0x" + (Buffer.from(b).toString("hex") || "0"));
const pad256 = (n) => Buffer.from(n.toString(16).padStart(512, "0"), "hex");
function modPow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = (r * b) % m; e >>= 1n; b = (b * b) % m; } return r; }
const CHANNEL_BASE = 1000000000000n;

// The account-mode methods, from their layer-198 TL lines.
export const M = Object.freeze({
  exportLoginToken: 0xb7e085fe, importLoginToken: 0x95ac5ce4, getPassword: 0x548a30f5, checkPassword: 0xd18b4d16,
  logOut: 0x3e72ba19, getDialogs: 0xa0f4cb4f, search: 0x29ee847a,
});
const FILTER_VIDEO = 0x9fc00e65, FILTER_DOCUMENT = 0x9eddf188;

// user#4b46c37e flags:# self:flags.10?true ... bot:flags.14?true ... flags2:# id:long access_hash:flags.0?long first_name:flags.1?string
const selfUser = (id, firstName) => cat(u32(0x4b46c37e), u32(bit(true, 0) | bit(true, 1) | bit(true, 10)), u32(0), i64(id), i64(77n), str(firstName));
// auth.authorization#2ea2c0d4 flags:# ... user:User
const authorization = (user) => cat(u32(0x2ea2c0d4), u32(0), user);
// auth.loginToken#629f1980 expires:int token:bytes   auth.loginTokenMigrateTo#068e9916 dc_id:int token:bytes
// auth.loginTokenSuccess#390d5c5e authorization:auth.Authorization   auth.loggedOut#c3a2835f flags:#
const loginToken = (expires, token) => cat(u32(0x629f1980), i32(expires), tlBytes(token));
const loginMigrate = (dc, token) => cat(u32(0x068e9916), i32(dc), tlBytes(token));
const loginSuccess = (auth) => cat(u32(0x390d5c5e), auth);
const loggedOut = () => cat(u32(0xc3a2835f), u32(0));
// account.password#957b50fb flags:# has_recovery:flags.0?true has_secure_values:flags.1?true has_password:flags.2?true
//   current_algo:flags.2?PasswordKdfAlgo srp_B:flags.2?bytes srp_id:flags.2?long hint:flags.3?string ...
//   new_algo:PasswordKdfAlgo new_secure_algo:SecurePasswordKdfAlgo secure_random:bytes
// passwordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow#3a912d4a salt1:bytes salt2:bytes g:int p:bytes
// passwordKdfAlgoUnknown#d45ab096   securePasswordKdfAlgoUnknown#4a8537
const algoBytes = (a) => cat(u32(0x3a912d4a), tlBytes(a.salt1), tlBytes(a.salt2), i32(a.g), tlBytes(a.p));
// chat#41cbf256 flags:# ... id:long title:string photo:ChatPhoto participants_count:int date:int version:int
const basicGroup = ({ id, title }) => cat(u32(0x41cbf256), u32(0), i64(id), str(title), u32(0x37c1011c), i32(3), i32(1700000000), i32(1));
// messages.dialogs#15ba6c40 dialogs messages chats users   messages.dialogsSlice#71e094f3 count:int ...
const dialogs = ({ count, slice, list, messages, chats, users }) => cat(u32(slice ? 0x71e094f3 : 0x15ba6c40), slice && i32(count), vec(list), vec(messages), vec(chats), vec(users));

function readInputPeer(r) {
  const c = r.int();
  if (c === 0x7da07ec9) return { kind: "self" };
  if (c === 0x7f3b18ea) return { kind: "empty" };
  if (c === 0x35a95cb9) return { kind: "chat", id: r.long() };
  if (c === 0x27bcbbfc) return { kind: "channel", id: r.long(), accessHash: r.long() };
  if (c === 0xdde8a54c) return { kind: "user", id: r.long(), accessHash: r.long() };
  throw { rpc: [400, "PEER_ID_INVALID"] };
}

export class FakeAccount {
  /** `homeDc`: the account's DC (a QR token exported elsewhere migrates there); `password`: a 2FA password, or none. */
  constructor({ userId = 55501n, firstName = "Ana", homeDc = 2, password = null, date = 1729700000 } = {}) {
    this.userId = BigInt(userId);
    this.firstName = firstName;
    this.homeDc = homeDc;
    this.now = date;
    this.calls = [];
    this.stats = { exportLoginToken: 0, importLoginToken: 0, getPassword: 0, checkPassword: 0, badPasswords: 0, logOuts: 0, getDialogs: 0, search: 0 };
    this.tokens = new Map(); // token hex -> { dc, entry (the auth key that exported it), accepted, forImport, expires }
    this.lastExport = null;
    this.chats = new Map();  // chat id (Bot API style) -> chat
    this.order = [];         // dialog order (newest first is computed from the messages)
    this.nextCommonId = 1;
    this.nextDocId = 50000n;
    this.refCounter = 1;
    this.revoked = false;
    this.dialogPage = 100;
    this.setPassword(password);
    this.chats.set(String(this.userId), { kind: "self", id: this.userId, title: "Saved Messages", messages: new Map() });
  }
  install(tg) { tg.account = this; tg.api = this; this.tg = tg; return this; }

  setPassword(password) {
    this.password = password;
    if (!password) { this.algo = null; return; }
    this.algo = { salt1: randomBytes(40), salt2: randomBytes(16), g: 3, p: pad256(TELEGRAM_PRIME) };
    // The verifier, as the server keeps it: v = g^x, x = PH2(password) (written here independently of srp.js).
    const sh = (d, s) => H(s, d, s);
    const ph1 = sh(sh(Buffer.from(password, "utf8"), this.algo.salt1), this.algo.salt2);
    const x = big(sh(pbkdf2Sync(ph1, this.algo.salt1, 100000, 64, "sha512"), this.algo.salt2));
    this.v = modPow(3n, x, TELEGRAM_PRIME);
  }

  // ---- the person's chats ----
  doc(fields) { const id = this.nextDocId++; return { id, accessHash: -(id * 31n), fileReference: Buffer.from([this.refCounter & 255, (this.refCounter++ >> 8) & 255, 0xac, 0xc0]), dcId: 2, ...fields }; }
  addChannel({ id, accessHash, title, megagroup = false }) {
    const key = String(-(CHANNEL_BASE + BigInt(id)));
    this.chats.set(key, { kind: "channel", id: BigInt(id), accessHash: BigInt(accessHash), title, megagroup, messages: new Map(), nextId: 1 });
    return key;
  }
  addGroup({ id, title }) {
    const key = String(-BigInt(id));
    this.chats.set(key, { kind: "chat", id: BigInt(id), title, messages: new Map() });
    return key;
  }
  get selfKey() { return String(this.userId); }
  /** A message in chat `key`: { text?, doc?, asFile? } (asFile: sent as a file, found by the document filter). Answers its id. */
  post(key, spec) {
    const ch = this.chats.get(key);
    const id = ch.kind === "channel" ? ch.nextId++ : this.nextCommonId++;
    ch.messages.set(id, { id, date: ++this.now, text: "", ...spec });
    return id;
  }
  remove(key) { this.chats.delete(key); }
  peerOf(ch) { return ch.kind === "channel" ? S.peerChannel(ch.id) : ch.kind === "chat" ? S.peerChat(ch.id) : S.peerUser(ch.id); }
  render(ch, m) {
    if (m.doc) return S.messageWithDocument({ id: m.id, peer: this.peerOf(ch), date: m.date, text: m.text, doc: m.doc, post: ch.kind === "channel" && !ch.megagroup });
    return S.message({ id: m.id, peer: this.peerOf(ch), date: m.date, text: m.text });
  }
  chatOf(ch) {
    if (ch.kind === "channel") return S.channel({ id: ch.id, accessHash: ch.accessHash, title: ch.title, broadcast: !ch.megagroup });
    if (ch.kind === "chat") return basicGroup(ch);
    return null;
  }
  top(ch) { let t = null; for (const m of ch.messages.values()) if (!t || m.id > t.id) t = m; return t; }

  // ---- the official app ----
  /** The person scans the last QR shown with the official Telegram app and confirms. false when there is none. */
  scan() {
    const t = this.lastExport && this.tokens.get(this.lastExport);
    if (!t || t.expires < this.tg.dc(t.dc).now()) return false;
    t.accepted = true;
    return true;
  }
  /** The person ends this session from Telegram's Settings > Devices. */
  revoke() { this.revoked = true; }

  // ---- the server ----
  authorize(entry) { entry.authorized = true; entry.account = true; entry.passwordPending = false; return authorization(selfUser(this.userId, this.firstName)); }
  finish(entry) {
    if (this.password) { entry.passwordPending = true; throw { rpc: [401, "SESSION_PASSWORD_NEEDED"] }; }
    return this.authorize(entry);
  }
  needAccount(entry) {
    if (this.revoked && entry.account) { entry.authorized = false; throw { rpc: [401, "SESSION_REVOKED"] }; }
    if (!entry.authorized || !entry.account) throw { rpc: [401, "AUTH_KEY_UNREGISTERED"] };
  }

  /** The fake DC hands every method to this first; undefined means "not an account method". */
  rpc(ctor, r, { dc, entry }) {
    switch (ctor) {
      case M.exportLoginToken: {
        this.calls.push("exportLoginToken"); this.stats.exportLoginToken++;
        r.int(); r.string(); r.vectorLong();
        for (const [hex, t] of this.tokens) {
          if (t.entry !== entry || !t.accepted || t.forImport) continue;
          this.tokens.delete(hex);
          if (dc.id !== this.homeDc) {
            const token = randomBytes(32);
            this.tokens.set(token.toString("hex"), { dc: this.homeDc, forImport: true, expires: dc.now() + 30 });
            return loginMigrate(this.homeDc, token);
          }
          return loginSuccess(this.finish(entry));
        }
        const token = randomBytes(32);
        this.tokens.set(token.toString("hex"), { dc: dc.id, entry, accepted: false, expires: dc.now() + 30 });
        this.lastExport = token.toString("hex");
        return loginToken(dc.now() + 30, token);
      }
      case M.importLoginToken: {
        this.calls.push("importLoginToken"); this.stats.importLoginToken++;
        const hex = Buffer.from(r.bytes()).toString("hex");
        const t = this.tokens.get(hex);
        if (!t || !t.forImport || t.dc !== dc.id) throw { rpc: [400, "AUTH_TOKEN_INVALID"] };
        this.tokens.delete(hex);
        return loginSuccess(this.finish(entry));
      }
      case M.getPassword: {
        this.calls.push("getPassword"); this.stats.getPassword++;
        const unknownSecure = u32(0x004a8537);
        if (!this.password) return cat(u32(0x957b50fb), u32(0), u32(0xd45ab096), unknownSecure, tlBytes(randomBytes(32)));
        const b = big(randomBytes(256)) % TELEGRAM_PRIME;
        const k = big(H(this.algo.p, pad256(3n)));
        const B = ((k * this.v) + modPow(3n, b, TELEGRAM_PRIME)) % TELEGRAM_PRIME;
        this.srp = { id: BigInt.asIntN(64, big(randomBytes(8))), b, B };
        return cat(u32(0x957b50fb), u32(bit(true, 2)), algoBytes(this.algo), tlBytes(pad256(B)), i64(this.srp.id), algoBytes(this.algo), unknownSecure, tlBytes(randomBytes(32)));
      }
      case M.checkPassword: {
        this.calls.push("checkPassword"); this.stats.checkPassword++;
        if (r.int() !== 0xd27ff082) throw { rpc: [400, "PASSWORD_HASH_INVALID"] };
        const srpId = r.long(), A = Buffer.from(r.bytes()), M1 = Buffer.from(r.bytes());
        if (!entry.passwordPending) throw { rpc: [400, "PASSWORD_HASH_INVALID"] };
        if (!this.srp || this.srp.id !== srpId) throw { rpc: [400, "SRP_ID_INVALID"] };
        const p = TELEGRAM_PRIME, a = big(A);
        if (a <= 1n || a >= p - 1n) throw { rpc: [400, "PASSWORD_HASH_INVALID"] };
        const Bb = pad256(this.srp.B);
        const u = big(H(pad256(a), Bb));
        // The server's side of SRP: S = (A * v^u)^b
        const Ss = modPow((a * modPow(this.v, u, p)) % p, this.srp.b, p);
        const K = H(pad256(Ss));
        const hp = H(this.algo.p), hg = H(pad256(3n));
        const expect = H(Buffer.from(hp.map((x, i) => x ^ hg[i])), H(this.algo.salt1), H(this.algo.salt2), pad256(a), Bb, K);
        this.srp = null; // one try per round, as Telegram
        if (!expect.equals(M1)) { this.stats.badPasswords++; throw { rpc: [400, "PASSWORD_HASH_INVALID"] }; }
        return this.authorize(entry);
      }
      case M.logOut: {
        this.calls.push("logOut"); this.stats.logOuts++;
        entry.authorized = false;
        return loggedOut();
      }
      case M.getDialogs: {
        this.calls.push("getDialogs"); this.stats.getDialogs++;
        this.needAccount(entry);
        const flags = r.int();
        if (flags & 2) r.int();
        r.int32(); r.int32();
        const offsetPeer = readInputPeer(r);
        const limit = r.int32(); r.long();
        const all = [...this.chats.entries()].filter(([, c]) => c.messages.size).sort((x, y) => this.top(y[1]).date - this.top(x[1]).date);
        let start = 0;
        if (offsetPeer.kind !== "empty") {
          const at = all.findIndex(([, c]) => (offsetPeer.kind === "self" ? c.kind === "self" : c.kind === offsetPeer.kind && c.id === offsetPeer.id));
          start = at + 1;
        }
        const page = all.slice(start, start + Math.min(limit, this.dialogPage));
        const list = page.map(([, c]) => S.dialog({ peer: this.peerOf(c), topMessage: this.top(c).id, pts: c.kind === "channel" ? 1 : undefined }));
        const messages = page.map(([, c]) => this.render(c, this.top(c)));
        const chats = page.map(([, c]) => this.chatOf(c)).filter(Boolean);
        return dialogs({ count: all.length, slice: start + page.length < all.length, list, messages, chats, users: [selfUser(this.userId, this.firstName)] });
      }
      case M.search: {
        this.calls.push("search"); this.stats.search++;
        this.needAccount(entry);
        const flags = r.int();
        const peer = readInputPeer(r);
        r.string();
        if (flags & 1) readInputPeer(r);
        if (flags & 4) readInputPeer(r);
        if (flags & 8) throw { rpc: [400, "NOT_IN_FAKE"] };
        if (flags & 2) r.int();
        const filter = r.int();
        r.int(); r.int();
        const offsetId = r.int32(); r.int32();
        const limit = r.int32(), maxId = r.int32(), minId = r.int32(); r.long();
        const key = peer.kind === "self" ? this.selfKey : peer.kind === "chat" ? String(-peer.id) : peer.kind === "channel" ? String(-(CHANNEL_BASE + peer.id)) : null;
        const ch = key && this.chats.get(key);
        if (!ch) throw { rpc: [400, "PEER_ID_INVALID"] };
        if (ch.kind === "channel" && ch.accessHash !== peer.accessHash) throw { rpc: [400, "CHANNEL_INVALID"] };
        if (filter !== FILTER_VIDEO && filter !== FILTER_DOCUMENT) throw { rpc: [400, "FILTER_NOT_IN_FAKE"] };
        const match = (m) => m.doc && (filter === FILTER_VIDEO ? !!m.doc.video && !m.asFile : !!m.asFile);
        const hits = [...ch.messages.values()].filter(match).filter((m) => (!offsetId || m.id < offsetId) && (!maxId || m.id <= maxId) && m.id > minId).sort((x, y) => y.id - x.id);
        const page = hits.slice(0, limit).map((m) => this.render(ch, m));
        const chats = [this.chatOf(ch)].filter(Boolean);
        if (ch.kind === "channel") return S.channelMessages({ pts: 1, count: hits.length, messages: page, chats });
        return S.messagesSlice({ count: hits.length, messages: page, chats, users: [selfUser(this.userId, this.firstName)] });
      }
      default: return undefined;
    }
  }

  // tg.api (the fake DC's generic path, after its own authorization check)
  channelsGetMessages(req) {
    this.calls.push("channelsGetMessages");
    const key = String(-(CHANNEL_BASE + req.channelId));
    const ch = this.chats.get(key);
    if (!ch || ch.accessHash !== req.accessHash) throw { rpc: [400, "CHANNEL_INVALID"] };
    const messages = req.ids.map((id) => (ch.messages.has(id) ? this.render(ch, ch.messages.get(id)) : S.messageEmpty(id)));
    return S.channelMessages({ pts: 1, count: messages.length, messages, chats: [this.chatOf(ch)] });
  }
  messagesGetMessages(req) {
    this.calls.push("messagesGetMessages");
    const messages = req.ids.map((id) => {
      for (const ch of this.chats.values()) if (ch.kind !== "channel" && ch.messages.has(id)) return this.render(ch, ch.messages.get(id));
      return S.messageEmpty(id);
    });
    return S.messagesMessages({ messages, users: [selfUser(this.userId, this.firstName)] });
  }
}
