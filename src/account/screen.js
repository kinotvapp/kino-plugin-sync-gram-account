// Sync-Gram Cuenta's screen (apiVersion 14): the sign-in as steps instead of Kino's settings form. The form stays for a
// Kino that cannot open screens. The values that must stay secrets keep Kino's own fields (a `settings` node: api_id,
// api_hash, the 2FA password and its button, Cerrar sesión); the number and the one-time code are plain fields of the
// screen, handed to the login code as typed (a screen never writes a password setting).
//
// The screen draws from `loginStage()` and from `state` (the last line each press produced and, on the TV, the QR). A
// timer re-renders it while it is open: on the TV it also drives the automatic QR login that the form's refresh drove.
import { CATALOG, t } from "./text.js";
import { loginStage, received, autoStopped, tvPage, phonePage, startQr, sendPhoneCode, signInWithCode, forgetCode } from "./login.js";
import { accountStatus } from "./sync.js";
import { credentials, hasSession } from "./session.js";

const isTv = () => kino.device === "tv";
const TICK_MS = 4000;

/** A text in both languages: Kino picks by its own. */
const pair = (key, vars = {}) => {
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
  return { text: fill(CATALOG.es[key]), textEn: fill(CATALOG.en[key]) };
};
const text = (key, style, extra = {}) => ({ type: "Text", ...pair(key), ...(style ? { style } : {}), ...extra });
const label = (key) => {
  const p = pair(key);
  return { labelText: p.text, labelTextEn: p.textEn };
};
const hint = (key) => {
  const p = pair(key);
  return { hintText: p.text, hintTextEn: p.textEn };
};
const errorText = (key) => {
  const p = pair(key);
  return { errorText: p.text, errorTextEn: p.textEn };
};
// Kino's own matcher (a safe subset): the number as people write it, the code as Telegram sends it.
const PHONE_SHAPE = "^\\+?[0-9 ().-]{7,25}$";
const CODE_SHAPE = "^[0-9]{3,8}$";
const settings = (...keys) => ({ type: "settings", keys });
const card = (children) => ({ type: "Card", variant: "outlined", children: [{ type: "Column", padding: 16, gap: 12, children }] });
/** A line that is already in the person's language (a status the login code produced). */
const line = (s) => ({ type: "Text", text: s, style: "body" });

function phoneBody(stage, state) {
  const status = [state.msg, state.line].filter(Boolean).map(line);
  if (stage === "noApi") {
    return [
      card([
        text("scr.api.step", "h3"),
        text("scr.api.how"),
        {
          type: "ElevatedButton",
          ...label("scr.api.open"),
          onPressed: { go: { url: { href: "https://my.telegram.org/apps", title: "my.telegram.org" } } },
        },
        settings("api_id", "api_hash"),
        ...status,
      ]),
      text("scr.scope", "caption"),
    ];
  }
  if (stage === "signedIn") {
    return [
      card([text("scr.done.step", "h3"), ...[state.msg, state.line].filter(Boolean).map(line), text("scr.done.how"), settings("logout")]),
      card([
        text("scr.status", "h3"),
        { type: "ElevatedButton", ...label("scr.check"), onPressed: "check" },
      ]),
    ];
  }
  if (stage === "password") {
    return [card([text("scr.password.step", "h3"), text("scr.password.how"), settings("tg_password", "check_password"), ...status])];
  }
  const phoneField = {
    type: "TextField", key: "phone", bind: "phone", kind: "text", maxLength: 30, required: true,
    pattern: PHONE_SHAPE, ...errorText("phone.invalid"), ...label("scr.phone.label"), ...hint("scr.phone.hint"),
  };
  if (stage === "code") {
    return [
      card([
        text("scr.code.step", "h3"),
        {
          type: "Form", onSubmitted: "sign_in", children: [
            { type: "TextField", key: "code", kind: "number", maxLength: 8, required: true, pattern: CODE_SHAPE, ...errorText("field.code"), ...label("scr.code.label"), ...hint("scr.code.hint") },
            { type: "ElevatedButton", submit: true, ...label("scr.signin") },
          ],
        },
        { type: "TextButton", ...label("scr.other"), onPressed: "other" },
        ...status,
      ]),
    ];
  }
  // signedOut and qr: the number, and the button that asks Telegram for the code.
  return [
    card([
      text("scr.phone.step", "h3"),
      { type: "Form", onSubmitted: "send_code", children: [phoneField, { type: "ElevatedButton", submit: true, ...label("scr.send") }] },
      ...status,
    ]),
    text("scr.scope", "caption"),
  ];
}

function tvBody(stage, state) {
  if (stage === "signedIn") return [card([text("scr.done.step", "h3"), ...[state.msg, state.line].filter(Boolean).map(line), settings("logout")])];
  if (!received()) return [card([text("scr.tv.step", "h3"), line(state.line || state.msg || t("status.api_missing.tv"))])];
  if (stage === "password") return [card([text("scr.password.step", "h3"), line(state.line || state.msg || t("status.password.tv"))])];
  const children = [text("scr.tv.step", "h3")];
  if (state.qr) children.push({ type: "QrImage", value: state.qr, size: "large" });
  for (const l of [state.msg, state.line]) if (l) children.push(line(l));
  if (autoStopped()) children.push({ type: "ElevatedButton", ...label("scr.tv.retry"), onPressed: "qr_login" });
  return [card(children)];
}

export async function screen({ state = {} } = {}) {
  const stage = loginStage();
  const body = isTv() ? tvBody(stage, state) : phoneBody(stage, state);
  return {
    type: "Column",
    padding: { compact: 16, expanded: 32 },
    gap: 12,
    every: { ms: TICK_MS, event: "tick" },
    children: [text("scr.title", "h1"), text("scr.sub"), ...body],
  };
}

/**
 * What a login answer leaves on the screen: its message, and the settings it asked to write that a screen may write. A phone
 * that holds login_ok but whose session is gone clears it with any press, so Kino stops offering Enviar configuración.
 */
function fromAnswer(a, extra = {}, write = {}) {
  const config = { ...write };
  for (const [k, v] of Object.entries(a.setSettings || {})) if (k === "login_ok") config[k] = v;
  for (const k of a.clearSettings || []) if (k === "login_ok") config[k] = null;
  if (!isTv() && !("login_ok" in config) && !hasSession(credentials()) && String(kino.config.get("login_ok") ?? "")) config.login_ok = null;
  return { state: { msg: a.message || "", ...extra }, ...(Object.keys(config).length ? { config } : {}) };
}

export async function screenEvent({ name, state = {}, device } = {}) {
  const typed = state.inputs || {};
  if (name === "open" || name === "check") {
    // The one place that asks Telegram (a signed-in device's copy): the ambient line, on this press only.
    return { state: { line: (await accountStatus()).message, msg: "" } };
  }
  if (name === "tick") {
    const stage = loginStage();
    if (isTv()) {
      const page = await tvPage();
      return { state: { qr: page.qr || null, line: page.status || (stage === "signedIn" ? state.line || (await accountStatus()).message : (await accountStatus()).message) } };
    }
    // A signed-in device asks Telegram once (when it has no line yet), then keeps the line its last open or check produced.
    return { state: { line: phonePage().status || (stage === "signedIn" ? state.line || (await accountStatus()).message : (await accountStatus()).message) } };
  }
  if (name === "send_code") {
    const a = await sendPhoneCode({ phone: typed.phone });
    // The number is kept on this device (a text setting that never syncs) so the code step needs no field for it.
    return fromAnswer(a, {}, typeof typed.phone === "string" && typed.phone.trim() ? { phone: typed.phone.trim() } : {});
  }
  if (name === "sign_in") {
    const a = await signInWithCode({ phone: typed.phone, code: typed.code });
    return { ...fromAnswer(a), state: { msg: a.message || "", inputs: { code: "" } } };
  }
  if (name === "other") {
    forgetCode();
    return { state: { msg: "", inputs: { code: "" } } };
  }
  if (name === "qr_login") {
    const a = await startQr();
    return fromAnswer(a);
  }
  return null;
}
