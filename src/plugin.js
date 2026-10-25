// Sync-Gram Cuenta (unofficial, not affiliated with Telegram): Kino's cross-device sync through the person's own Telegram
// account, no bot. The phone signs in with its number and a code; the TV only receives the configuration and shows a QR
// for the phone's Telegram app by itself (account/login.js). The copy is pinned in Saved Messages over MTProto, through
// the vendored client in its `sync` mode, which can touch Saved Messages only. The bot variant is its own plugin,
// Sync-Gram (docs/plugins/examples/sync-telegram).
//
// This file is the entry: scripts/build.mjs bundles it with everything it imports into plugin/plugin.js, the one file
// Kino loads. Edit src/ and rebuild; never edit plugin/plugin.js.
import { accountPull, accountPush, accountStatus } from "./account/sync.js";
import { startQr, tvPage, phonePage, confirmPassword, logout, loginStage, autoStopped, received, sendPhoneCode, signInWithCode } from "./account/login.js";
import { credentials, hasSession } from "./account/session.js";
import { KEY_SHAPE } from "./account/key.js";
import { t } from "./account/text.js";

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
