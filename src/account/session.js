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
import { TelegramClient } from "../mtproto/client.js";
import { TELEGRAM_PUBLIC_KEYS } from "../mtproto/keys.js";
import { mtError } from "../mtproto/errors.js";

// The fake Telegram of the tests has its own RSA key: test/account-harness.mjs swaps exactly this line in the bundle.
const PUBLIC_KEYS = TELEGRAM_PUBLIC_KEYS;
const FIRST_DC = 2;
export const SESSION_KEY = "tg.usession";
export const CLOSED_KEY = "tg.closed"; // { fp }: Telegram ended this session (the person closed it in Devices)

export function readJson(key) {
  try { const v = kino.storage.get(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
export function writeJson(key, value) {
  try { kino.storage.set(key, JSON.stringify(value)); return true; } catch (e) { kino.log("storage write refused: " + key + " " + (e && e.code)); return false; }
}
export function remove(key) { try { kino.storage.remove(key); } catch { /* nothing to remove */ } }
export const store = Object.freeze({ get: (k) => kino.storage.get(k), set: (k, v) => kino.storage.set(k, v) });

/** "not signed in" and friends, with a fixed `reason` the status line reads (never a secret). */
export const notReady = (reason, message) => mtError("not_signed_in", message, { reason });

/** api_id and api_hash from the settings (trimmed); never logged, never stored. `complete` when both look right. */
export function credentials() {
  const get = (k) => String(kino.config.get(k) ?? "").trim();
  const apiId = get("api_id"), apiHash = get("api_hash");
  return { apiId, apiHash, complete: /^\d{1,10}$/.test(apiId) && Number(apiId) > 0 && apiHash.length > 0 };
}
const digest = (text) => kino.crypto.hash("sha256", text).slice(0, 16);
export const sessionFp = (c) => digest("account\n" + c.apiId);
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

export function newClient(c) {
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
export function saveSession(l = live) {
  if (!l || l.dropped) return;
  const state = l.client.exportState();
  const text = JSON.stringify(state);
  if (text === l.saved) return;
  if (writeJson(SESSION_KEY, { v: 2, fp: l.fp, salt: l.salt, ...seal(l.key, state) })) l.saved = text;
}

/** Whether a sealed, logged-in session for these settings is stored, without connecting. */
export function hasSession(c = credentials()) {
  return !!(c.apiId && c.apiHash) && loggedInState(storedState(c));
}

/** Whether this Kino gives the plugin kino.ws (the manifest's socket capability, apiVersion 13). */
export const socketsAvailable = () => typeof kino.ws === "object" && kino.ws !== null && typeof kino.ws.open === "function";

/** Why there is no usable session: "unsupported" (no kino.ws), "api_missing", "closed" (Telegram ended it) or "signin" (never signed in here). */
export function missingReason(c = credentials()) {
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
export function connect({ deadline } = {}) {
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
export async function connectForLogin({ deadline } = {}) {
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
export function markLoggedIn() {
  if (!live) return;
  live.ready = true;
  remove(CLOSED_KEY);
  saveSession();
}

/** Telegram ended the session (SESSION_REVOKED, a key it no longer knows): drop it, remember why, never log in again by itself. */
export async function sessionClosed() {
  const c = credentials();
  kino.log("account session ended by Telegram: sign in again");
  if (live) live.dropped = true; // a round's last save must not write it back
  await close();
  remove(SESSION_KEY);
  writeJson(CLOSED_KEY, { fp: sessionFp(c) });
}

/** The person signed out: auth.logOut was tried; the session and its records go from this device. */
export async function forgetSession() {
  if (live) live.dropped = true;
  await close();
  remove(SESSION_KEY);
  remove(CLOSED_KEY);
}

export async function close() {
  const l = live;
  live = null;
  if (l) { try { await l.client.close(); } catch { /* already closed */ } }
}
