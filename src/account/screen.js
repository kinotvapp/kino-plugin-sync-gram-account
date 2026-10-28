// Sync-Gram Cuenta's screen (apiVersion 14): the whole setup, as Kino's `steps`, with no settings form at all. Every
// secret is typed in a masked field (`obscureText`) of a Form: its text reaches the event once, is checked here, and is
// written to its password setting by the answer's `config`; it is never in the screen's state, a log or a render. The
// number is a plain field bound to its setting; the sign-in code is a masked field that is never stored.
//
// The phone walks api → number → code → (two-step password) → connected. The TV only receives the configuration: it
// shows the QR for the phone's Telegram app, with Kino's own countdown, and renews the code before it expires.
import { CATALOG, t } from "./text.js";
import { loginStage, received, autoStopped, tvPage, phonePage, startQr, sendPhoneCode, signInWithCode, confirmPassword, logout, forgetCode } from "./login.js";
import { accountStatus } from "./sync.js";
import { credentials, hasSession } from "./session.js";

const isTv = () => kino.device === "tv";
const TICK_MS = 4000;
const API_ID_SHAPE = "^[1-9][0-9]{0,9}$";
const API_HASH_SHAPE = "^[0-9a-fA-F]{32}$";
// Kino's own matcher (a safe subset): the number as people write it, the code as Telegram sends it.
const PHONE_SHAPE = "^\\+?[0-9 ().-]{7,25}$";
const CODE_SHAPE = "^[0-9]{3,8}$";
const has = (k) => String(kino.config.get(k) ?? "") !== "";

/** A text in both languages: Kino picks by its own. */
const pair = (key, vars = {}) => {
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
  return { text: fill(CATALOG.es[key]), textEn: fill(CATALOG.en[key]) };
};
const text = (key, style) => ({ type: "Text", ...pair(key), ...(style ? { style } : {}) });
const named = (key, field) => {
  const p = pair(key);
  return { [field]: p.text, [field + "En"]: p.textEn };
};
const label = (key) => named(key, "labelText");
const hint = (key) => named(key, "hintText");
const errorText = (key) => named(key, "errorText");
const title = (key) => {
  const p = pair(key);
  return { title: p.text, titleEn: p.textEn };
};
const subtitle = (key) => {
  const p = pair(key);
  return { subtitle: p.text, subtitleEn: p.textEn };
};
/** A line that is already in the person's language (a status the login code produced). */
const line = (s) => ({ type: "Text", text: s, style: "body" });
const button = (key, onPressed, extra = {}) => ({ type: "ElevatedButton", ...label(key), ...(onPressed ? { onPressed } : {}), ...extra });
const submit = (key) => ({ type: "ElevatedButton", ...label(key), submit: true });
const form = (key, onSubmitted, children) => ({ type: "Form", key, onSubmitted, children });
const said = (state) => [state.msg, state.line].filter(Boolean).map(line);

/** "+57 300 1234567" → "+57 300 ••••567": the number is not read back in full. */
function maskedNumber() {
  const raw = String(kino.config.get("phone") ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return (raw.startsWith("+") ? "+" : "") + digits.slice(0, 2) + " ••••" + digits.slice(-3);
}

/** Only the current step draws children: any other step's would be dropped (and logged) by Kino. */
const onlyCurrentOpen = (item) => {
  if (item.state === "current") return item;
  const { children, ...rest } = item;
  return rest;
};

// ----------------------------------------------------------------------------------------------------------- the phone

const ORDER = ["api", "number", "code", "password", "ready"];
const AT = { noApi: 0, signedOut: 1, qr: 1, code: 2, password: 3, signedIn: 4 };

function stepStates(stage, state) {
  let at = AT[stage];
  // A step already done can be opened again (onStepTap): the api details or the number, before the session exists.
  if (state.edit && stage !== "signedIn" && ORDER.indexOf(state.edit) !== -1 && ORDER.indexOf(state.edit) < at) at = ORDER.indexOf(state.edit);
  return ORDER.map((key, i) => ({ key, state: i < at ? "done" : i === at ? "current" : "pending" }));
}

function phoneSteps(stage, state) {
  const states = Object.fromEntries(stepStates(stage, state).map((s) => [s.key, s.state]));
  const withPw = has("tg_password");
  const items = [
    {
      key: "api", ...title("scr.step.api"), ...subtitle("scr.sub.saved"), state: states.api,
      children: [
        text("scr.api.how"),
        button("scr.api.open", { go: { url: { href: "https://my.telegram.org/apps", title: "my.telegram.org" } } }),
        form("apiForm", "save_api", [
          { type: "TextField", key: "api_id", obscureText: true, maxLength: 10, required: true, pattern: API_ID_SHAPE, ...errorText("field.apiId"), ...label("scr.apiId.label"), ...hint("scr.apiId.hint") },
          { type: "TextField", key: "api_hash", obscureText: true, maxLength: 32, required: true, pattern: API_HASH_SHAPE, ...errorText("field.apiHash"), ...label("scr.apiHash.label"), ...hint("scr.apiHash.hint") },
          submit("scr.save"),
        ]),
        ...said(state),
        text("scr.scope", "caption"),
      ],
    },
    {
      key: "number", ...title("scr.step.number"), ...(maskedNumber() ? { subtitle: maskedNumber(), subtitleEn: maskedNumber() } : subtitle("scr.sub.sent")), state: states.number,
      children: [
        form("numberForm", "send_code", [
          { type: "TextField", key: "phone", bind: "phone", kind: "text", maxLength: 30, required: true, pattern: PHONE_SHAPE, ...errorText("phone.invalid"), ...label("scr.phone.label"), ...hint("scr.phone.hint") },
          submit("scr.send"),
        ]),
        ...said(state),
        text("scr.scope", "caption"),
      ],
    },
    {
      key: "code", ...title("scr.step.code"), ...subtitle("scr.sub.saved"), state: states.code,
      children: [
        text("scr.code.how"),
        form("codeForm", "sign_in", [
          { type: "TextField", key: "code", obscureText: true, kind: "number", maxLength: 8, required: true, pattern: CODE_SHAPE, ...errorText("field.code"), ...label("scr.code.label"), ...hint("scr.code.hint") },
          submit("scr.signin"),
        ]),
        { type: "TextButton", ...label("scr.other"), onPressed: "other" },
        ...said(state),
      ],
    },
    {
      key: "password", ...title("scr.step.password"), ...subtitle(withPw ? "scr.sub.saved" : "scr.sub.nopw"), state: states.password,
      children: [
        text("scr.password.how"),
        form("pwForm", "check_password", [
          { type: "TextField", key: "password", obscureText: true, maxLength: 200, required: true, ...label("scr.pw.label"), ...hint("scr.pw.hint") },
          submit("scr.confirm"),
        ]),
        ...said(state),
      ],
    },
    {
      key: "ready", ...title("scr.step.ready"), state: states.ready,
      children: [
        ...said(state),
        text("scr.done.how"),
        { type: "ElevatedButton", ...label("scr.check"), onPressed: "check" },
        ...(state.confirmLogout
          ? [text("scr.logout.ask"), button("scr.logout.yes", "logout"), { type: "TextButton", ...label("scr.cancel"), onPressed: "cancel_logout" }]
          : [{ type: "TextButton", ...label("scr.logout"), onPressed: "ask_logout" }]),
      ],
    },
  ];
  return { type: "steps", key: "setup", onStepTap: "go_back", items: items.map(onlyCurrentOpen) };
}

// ------------------------------------------------------------------------------------------------------------- the TV

function tvSteps(stage, state) {
  const got = received();
  const signedIn = stage === "signedIn";
  const items = [
    {
      key: "recv", ...title("scr.tv.recv"), ...subtitle("scr.tv.recv.sub"), state: got ? "done" : "current",
      children: [text("scr.tv.recv.how"), ...said(state)],
    },
    {
      key: "scan", ...title("scr.tv.scan"), state: signedIn ? "done" : got ? "current" : "pending",
      children: [
        text("scr.tv.scan.how"),
        ...(state.qr
          ? [{ type: "QrImage", value: state.qr, size: "large", ...label("scr.qr.label"), expiresInMs: 30000, renewBeforeMs: 6000, onExpire: "renew" }]
          : []),
        ...said(state),
        ...(autoStopped() ? [button("scr.tv.retry", "qr_login")] : []),
      ],
    },
    {
      key: "ready", ...title("scr.step.ready"), state: signedIn ? "current" : "pending",
      children: [...said(state), { type: "TextButton", ...label("scr.logout"), onPressed: "logout" }],
    },
  ];
  return { type: "steps", key: "setup", items: items.map(onlyCurrentOpen) };
}

// ------------------------------------------------------------------------------------------------------------ the screen

export async function screen({ state = {} } = {}) {
  const stage = loginStage();
  // The page scrolls: on a TV a tall step (the QR, its countdown and a button) would otherwise end under the screen's edge,
  // out of the remote's reach.
  return {
    type: "SingleChildScrollView",
    key: "page",
    every: { ms: TICK_MS, event: "tick" },
    children: [{
      type: "Column",
      padding: { compact: 16, expanded: 32 },
      gap: 12,
      children: [text("scr.title", "h1"), text("scr.sub"), isTv() ? tvSteps(stage, state) : phoneSteps(stage, state)],
    }],
  };
}

/**
 * What a login answer leaves on the screen: its message, and the settings it asked to write that a screen may write. A
 * phone that holds login_ok but whose session is gone clears it with any press, so Kino stops offering Enviar configuración.
 */
function fromAnswer(a, extra = {}, write = {}) {
  const config = { ...write };
  for (const [k, v] of Object.entries(a.setSettings || {})) if (k === "login_ok") config[k] = v;
  for (const k of a.clearSettings || []) if (k === "login_ok") config[k] = null;
  if (!isTv() && !("login_ok" in config) && !hasSession(credentials()) && has("login_ok")) config.login_ok = null;
  return { state: { msg: a.message || "", edit: null, ...extra }, ...(Object.keys(config).length ? { config } : {}) };
}

const clean = (v) => (typeof v === "string" ? v.trim() : "");

export async function screenEvent({ name, value, arg, state = {} } = {}) {
  const typed = state.inputs || {};
  const form = value && typeof value === "object" ? value : {};
  if (name === "open" || name === "check") {
    // The one place that asks Telegram (a signed-in device's copy): the ambient line, on this press only.
    return { state: { line: (await accountStatus()).message, msg: "" } };
  }
  if (name === "tick" || name === "renew") {
    const stage = loginStage();
    if (isTv()) {
      const page = await tvPage();
      const next = { qr: page.qr || null, line: page.status || (stage === "signedIn" ? state.line || (await accountStatus()).message : (await accountStatus()).message) };
      // The TV used the password the phone sent: it is cleared once the session exists (a screen may clear a password).
      return { state: next, ...(stage === "signedIn" && has("tg_password") ? { config: { tg_password: null } } : {}) };
    }
    // A signed-in device asks Telegram once (when it has no line yet), then keeps the line its last open or check produced.
    return { state: { line: phonePage().status || (stage === "signedIn" ? state.line || (await accountStatus()).message : (await accountStatus()).message) } };
  }
  if (name === "go_back") {
    if (arg === "number" && loginStage() === "code") forgetCode();
    return { state: { edit: arg === "api" || arg === "number" ? arg : null, msg: "" } };
  }
  if (name === "save_api") {
    const id = clean(form.api_id), hash = clean(form.api_hash);
    if (!new RegExp(API_ID_SHAPE).test(id)) return { state: { msg: t("field.apiId") } };
    if (!new RegExp(API_HASH_SHAPE).test(hash)) return { state: { msg: t("field.apiHash") } };
    return { state: { msg: "", edit: null }, config: { api_id: id, api_hash: hash } };
  }
  if (name === "send_code") {
    const phone = clean(form.phone) || clean(typed.phone);
    const a = await sendPhoneCode({ phone });
    // The number is kept on this device (a text setting that never syncs) so the code step needs no field for it.
    return fromAnswer(a, {}, phone ? { phone } : {});
  }
  if (name === "sign_in") {
    const a = await signInWithCode({ code: clean(form.code) });
    return fromAnswer(a);
  }
  if (name === "check_password") {
    const password = typeof form.password === "string" ? form.password : "";
    const a = await confirmPassword({ password });
    // On success the password is kept (sealed, device-only) so Enviar configuración can carry it once to the TV.
    return fromAnswer(a, {}, a.keepPassword !== undefined ? { tg_password: a.keepPassword } : {});
  }
  if (name === "other") {
    forgetCode();
    return { state: { msg: "", edit: null } };
  }
  if (name === "qr_login") {
    return fromAnswer(await startQr());
  }
  if (name === "ask_logout") return { state: { confirmLogout: true } };
  if (name === "cancel_logout") return { state: { confirmLogout: false } };
  if (name === "logout") {
    const a = await logout();
    return { state: { msg: a.message || "", line: "", confirmLogout: false, edit: null, qr: null }, config: { login_ok: null, tg_password: null } };
  }
  return null;
}
