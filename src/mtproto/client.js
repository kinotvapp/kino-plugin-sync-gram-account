// The high-level client: one auth key per DC, a bot login once per home DC, DC migration, chunked file downloads and
// a JSON-safe state the plugin shell stores encrypted. Calls run one at a time (Kino calls `read` one at a time too).
import { toBase64, fromBase64, toHex, fromHex } from "./bytes.js";
import { sha1 } from "./crypto.js";
import { Transport } from "./transport.js";
import { createAuthKey } from "./authkey.js";
import { Session } from "./session.js";
import {
  CTOR, LAYER, invokeWithLayer, initConnection, importBotAuthorization, exportAuthorization, importAuthorization,
  inputDocumentFileLocation, uploadGetFile, parseUploadFile, parseUploadFileHex, parseAuthorization, parseExportedAuthorization,
  exportLoginToken, importLoginToken, getPassword, checkPassword, logOut,
} from "./tl.js";
import { decode } from "./schema/reader.js";
import { srpCheck } from "./srp.js";
import { mtError } from "./errors.js";
import { BOT_CALLS, ACCOUNT_CALLS, ACCOUNT_AUTH_CALLS } from "./requests.js";
import { SYNC_CALLS, SELF_PEER_OFFSET, INPUT_PEER_SELF, M as SYNC_METHOD } from "./sync-requests.js";
import { PHONE_AUTH_CALLS, sendCode, signIn, parseSentCode } from "./phone-requests.js";
import { describeError, isServerAnswer } from "./errors.js";
import { big } from "./big.js";
import { TELEGRAM_PUBLIC_KEYS } from "./keys.js";

export const CHUNK = 1048576;
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
export function loginBudget(store, now = Date.now(), { key = BUDGET_KEY, max = BUDGET_MAX, what = "bot logins" } = {}) {
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
export const PASSWORD_BUDGET = Object.freeze({ key: "mtproto.passwordTries", max: 5, what: "password attempts" });

const DEFAULT_DEVICE = Object.freeze({ deviceModel: "Kino", systemVersion: "Android", appVersion: "1.0", systemLangCode: "en", langPack: "", langCode: "en" });

function checkRange(offset, limit) {
  if (!Number.isInteger(offset) || offset < 0 || offset % 4096 !== 0) throw mtError("invalid_request", "offset must be a non-negative multiple of 4096");
  if (!Number.isInteger(limit) || limit <= 0 || limit % 4096 !== 0 || CHUNK % limit !== 0) throw mtError("invalid_request", "limit must be a multiple of 4096 that divides 1 MiB");
  if (Math.floor(offset / CHUNK) !== Math.floor((offset + limit - 1) / CHUNK)) throw mtError("invalid_request", "a chunk may not cross a 1 MiB boundary");
}

export class TelegramClient {
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
