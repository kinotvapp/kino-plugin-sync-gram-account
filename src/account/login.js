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
import { credentials, connectForLogin, socketsAvailable, markLoggedIn, hasSession, sessionFp, forgetSession, readJson, writeJson, remove, store, saveSession } from "./session.js";
import { loginBudget } from "../mtproto/client.js";
import { toBase64 } from "../mtproto/bytes.js";
import { PHONE_DIGITS } from "../mtproto/phone-requests.js";
import { t, minutes } from "./text.js";

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
export const ACCOUNT_BUDGET = Object.freeze({ key: "mtproto.accountLogins", max: 5, what: "account logins" });

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
export function received() {
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
export async function startQr() {
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
export async function tvPage() {
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
export function autoStopped() {
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
export async function sendPhoneCode() {
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
export async function signInWithCode() {
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
export function phonePage() {
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
export function loginStage() {
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
export async function confirmPassword() {
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
export async function logout() {
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
