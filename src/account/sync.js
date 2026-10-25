// Account mode's provider exports: syncPull / syncPush / syncStatus through the person's own Telegram account (Saved
// Messages), on the stored session of this device. A round never signs in: without a session it fails at once with
// auth_required and `reason` "signin" | "closed" | "api_missing" (no network touched), which the status line turns into
// words with the next step (text.js). FLOOD_WAIT is never retried inside a call: it is recorded (tg.wait) and every round
// before that time fails at once with rate_limited, while syncStatus answers ready: false so Kino quietly waits for its
// next period.
import { pull, push, peek, checkBlob } from "./round.js";
import { connect, saveSession, sessionClosed, hasSession, missingReason, credentials } from "./session.js";
import { describeError } from "../mtproto/errors.js";
import { t, missingLine, noKeyLine } from "./text.js";

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

export function accountPull({ maxBlobBytes } = {}) {
  return round((client, deadline) => pull(client, { maxBlobBytes, deadline }));
}

export async function accountPush({ blob, expectedVersion, maxBlobBytes } = {}) {
  try { checkBlob(blob, maxBlobBytes); } catch (e) { throw await mapped(e); } // a bad blob never opens a connection
  return round((client, deadline) => push(client, { blob, expectedVersion, maxBlobBytes, deadline }));
}

/** { ready, message }: the status line, with the next step when something is missing. Never downloads. */
export async function accountStatus() {
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
