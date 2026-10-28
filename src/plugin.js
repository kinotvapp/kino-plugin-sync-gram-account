// Sync-Gram Cuenta (unofficial, not affiliated with Telegram): Kino's cross-device sync through the person's own Telegram
// account, no bot. The phone signs in with its number and a code; the TV only receives the configuration and shows a QR
// for the phone's Telegram app by itself (account/login.js). The copy is pinned in Saved Messages over MTProto, through
// the vendored client in its `sync` mode, which can touch Saved Messages only. The bot variant is its own plugin,
// Sync-Gram (docs/plugins/examples/sync-telegram).
//
// This file is the entry: scripts/build.mjs bundles it with everything it imports into plugin/plugin.js, the one file
// Kino loads. Edit src/ and rebuild; never edit plugin/plugin.js.
import { accountPull, accountPush, accountStatus } from "./account/sync.js";
import { KEY_SHAPE } from "./account/key.js";
import { t } from "./account/text.js";
import { screen as drawScreen, screenEvent as handleScreenEvent } from "./account/screen.js";

const API_HASH = /^[0-9a-fA-F]{32}$/;
const API_ID = /^[1-9]\d{0,9}$/;

export async function syncPull(ctx = {}) {
  return accountPull(ctx || {});
}

export async function syncPush(ctx = {}) {
  return accountPush(ctx || {});
}

export async function screen(ctx = {}) {
  return drawScreen(ctx || {});
}

export async function screenEvent(ctx = {}) {
  return handleScreenEvent(ctx || {});
}

export async function syncStatus() {
  return accountStatus();
}

export async function validateSettings(values) {
  const out = {};
  const id = String(values.api_id || "").trim(), hash = String(values.api_hash || "").trim(), key = String(values.syncKey || "");
  const phone = String(values.phone || "").trim(), ok = String(values.login_ok || "");
  if (id && !API_ID.test(id)) out.api_id = t("field.apiId");
  if (hash && !API_HASH.test(hash)) out.api_hash = t("field.apiHash");
  if (key && !KEY_SHAPE.test(key)) out.syncKey = t("field.syncKey");
  if (phone && !(/^\+?[\d\s().-]+$/.test(phone) && /^[1-9]\d{6,14}$/.test(phone.replace(/\D/g, "")))) out.phone = t("phone.invalid");
  if (ok && ok !== "1") out.login_ok = t("field.loginOk");
  return Object.keys(out).length ? out : null;
}
