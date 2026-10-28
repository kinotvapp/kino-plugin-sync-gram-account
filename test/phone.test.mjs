// The phone's sign-in (1.1.0): a phone cannot scan its own QR, so it signs in with its number and the code Telegram sends
// (auth.sendCode, auth.signIn), the 2FA password when the account has one, and only then holds `login_ok`, which the
// manifest's provision lists, so Kino offers "Enviar configuración" only after a sign-in that worked. The number, the
// code and the 2FA password never reach storage, logs, status lines or errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cluster, device, API, SYNC_KEY, shown } from "./harness.mjs";
import { openSession } from "../testkit/session-open.mjs";
import { checkScreenTree } from "../sdk/screen.mjs";

const PHONE = "+57 300 123 4567";
const PASSWORD = "contraseña-de-prueba 2FA";

function rig({ lang = "es-CO" } = {}) {
  const c = cluster();
  const d = device({ lang });
  let skew = 0;
  const now = () => Date.now() + skew;
  let values = { ...API, phone: PHONE };
  const run = (v = values, opts = {}) => d.runtime(v, { now, ...opts });
  /** Applies an action's answer the way Kino's form does: setSettings, then clearSettings. */
  const apply = (answer) => {
    values = { ...values, ...(answer.setSettings || {}) };
    for (const k of answer.clearSettings || []) delete values[k];
    return answer;
  };
  const act = async (key, extra = {}) => { values = { ...values, ...extra }; return apply(await (await run()).action(key)); };
  return { c, d, run, act, values: () => values, tick: (ms) => { skew += ms; }, close: () => { d.close(); c.close(); } };
}

/** Everything the plugin could leak, joined. */
const hay = (r, ...answers) => [r.d.storageDump(), r.d.logs.join("\n"), JSON.stringify(answers)].join("\n");
const secrets = (r) => [PHONE, PHONE.replace(/\D/g, ""), r.c.saved.lastCode, PASSWORD].filter(Boolean);

test("success: Enviar código, the code from Telegram, Iniciar sesión; login_ok is set, the code cleared, the session sealed", async () => {
  const r = rig();
  try {
    const sent = await r.act("send_code");
    assert.match(sent.message, /Telegram te manda el código a tu app de Telegram en otro aparato o por SMS/);
    assert.equal(sent.setSettings, undefined);
    const st = await (await r.run()).settingsStatus();
    assert.match(st.status, /Escribe el código que te mandó Telegram y toca Iniciar sesión/);
    const signed = await r.act("sign_in", { login_code: r.c.saved.lastCode });
    assert.match(signed.message, /Listo: sesión iniciada/);
    assert.deepEqual(signed.setSettings, { login_ok: "1" });
    const state = openSession(r.d.base.storage.get("tg.usession"), { api_hash: API.api_hash, api_id: API.api_id, account: true });
    assert.equal(state.dcs["2"].loggedIn, true);
    assert.match((await (await r.run()).event("open")).state.line, /Conectado con tu cuenta/);
    assert.deepEqual(r.c.saved.log.filter((e) => /sendCode|signIn/.test(e.method)).map((e) => e.method), ["sendCode", "signIn"]);
    for (const s of secrets(r)) assert.ok(!hay(r, sent, signed, st).includes(s), "leaked a secret");
  } finally { r.close(); }
});

test("a wrong code: the code is cleared, the sign-in can be tried again with the same code request; no login_ok", async () => {
  const r = rig();
  try {
    await r.act("send_code");
    const wrong = await r.act("sign_in", { login_code: "00000" });
    assert.match(wrong.message, /El código no es correcto/);
    assert.equal(wrong.setSettings, undefined);
    const right = await r.act("sign_in", { login_code: r.c.saved.lastCode });
    assert.deepEqual(right.setSettings, { login_ok: "1" });
    assert.equal(r.c.saved.log.filter((e) => e.method === "sendCode").length, 1, "one code request");
  } finally { r.close(); }
});

test("an expired code: back to Enviar código; the next code works", async () => {
  const r = rig();
  try {
    await r.act("send_code");
    const old = r.c.saved.lastCode;
    r.c.saved.expireCodes();
    const expired = await r.act("sign_in", { login_code: old });
    assert.match(expired.message, /El código venció: toca Enviar código otra vez/);
    assert.match((await (await r.run()).settingsStatus()).status, /escribe tu número con el código de país y toca Enviar código/);
    await r.act("send_code");
    assert.deepEqual((await r.act("sign_in", { login_code: r.c.saved.lastCode })).setSettings, { login_ok: "1" });
  } finally { r.close(); }
});

test("2FA: the password step, a wrong password clears it, the right one signs in and is KEPT for the TV", async () => {
  const r = rig();
  try {
    r.c.account.setPassword(PASSWORD);
    await r.act("send_code");
    const needs = await r.act("sign_in", { login_code: r.c.saved.lastCode });
    assert.match(needs.message, /contraseña de dos pasos: escríbela arriba, toca Guardar y luego Confirmar la contraseña/);
    assert.equal(needs.setSettings, undefined);
    const wrong = await r.act("check_password", { tg_password: "mala" });
    assert.match(wrong.message, /no es correcta/);
    assert.deepEqual(wrong.clearSettings, ["tg_password"], "a password that failed is cleared");
    const right = await r.act("check_password", { tg_password: PASSWORD });
    assert.match(right.message, /sesión iniciada/);
    assert.deepEqual(right.setSettings, { login_ok: "1" });
    assert.ok(!(right.clearSettings || []).includes("tg_password"), "kept: the TV cannot type it");
    assert.equal(r.values().tg_password, PASSWORD);
    for (const s of secrets(r)) assert.ok(!hay(r, needs, wrong, right).includes(s), "leaked a secret");
    // Cerrar sesión clears it, and login_ok.
    const out = await r.act("logout");
    assert.ok(out.clearSettings.includes("tg_password") && out.clearSettings.includes("login_ok"));
  } finally { r.close(); }
});

test("an account on another DC: PHONE_MIGRATE moves the sign-in there and the session's home DC follows", async () => {
  const r = rig();
  try {
    r.c.account.homeDc = 4;
    await r.act("send_code");
    assert.deepEqual(r.c.saved.log.filter((e) => e.method === "sendCode").map((e) => e.dc), [2, 4]);
    const signed = await r.act("sign_in", { login_code: r.c.saved.lastCode });
    assert.deepEqual(signed.setSettings, { login_ok: "1" });
    assert.deepEqual(r.c.saved.log.filter((e) => e.method === "signIn").map((e) => e.dc), [4]);
    assert.equal(openSession(r.d.base.storage.get("tg.usession"), { api_hash: API.api_hash, api_id: API.api_id, account: true }).homeDc, 4);
  } finally { r.close(); }
});

test("FLOOD_WAIT on Enviar código is recorded: pressing again sends nothing while it lasts, never retried in the call", async () => {
  const r = rig();
  try {
    r.c.saved.failNext("sendCode", 420, "FLOOD_WAIT_600");
    assert.match((await r.act("send_code")).message, /pidió esperar: vuelve a intentarlo en 10 minutos/);
    const n = r.c.saved.log.length;
    for (let i = 0; i < 3; i++) assert.match((await r.act("send_code")).message, /pidió esperar/);
    assert.equal(r.c.saved.log.length, n);
  } finally { r.close(); }
});

test("a number with no Telegram account, an invalid number, and Telegram unable to send a code: clear messages", async () => {
  const r = rig();
  try {
    r.c.saved.unregistered = true;
    await r.act("send_code");
    const signUp = await r.act("sign_in", { login_code: r.c.saved.lastCode });
    assert.match(signUp.message, /Ese número no tiene cuenta de Telegram/);
    assert.equal(signUp.setSettings, undefined);
    assert.equal(r.d.base.storage.get("tg.usession") ? openSession(r.d.base.storage.get("tg.usession"), { api_hash: API.api_hash, api_id: API.api_id, account: true }).dcs["2"].loggedIn : false, false);
    assert.match((await r.act("send_code", { phone: "+1 555 000 0000" })).message, /Ese número no es válido: escríbelo con el código de país/);
    assert.match((await r.act("send_code", { phone: "12ab" })).message, /Ese número no es válido/);
    r.c.saved.sendUnavailable = true;
    assert.match((await r.act("send_code", { phone: PHONE })).message, /Telegram no puede mandarte un código ahora/);
  } finally { r.close(); }
});

test("Enviar código and Iniciar sesión are budgeted with the QR logins (5 an hour per device)", async () => {
  const r = rig();
  try {
    for (let i = 0; i < 5; i++) assert.match((await r.act("send_code")).message, /Telegram te manda el código/);
    assert.match((await r.act("send_code")).message, /Demasiados intentos/);
  } finally { r.close(); }
});

test("the phone's screen by stage: number first, then the code, then the password, then just signed in; never the QR", async () => {
  const r = rig();
  try {
    const view = async () => {
      const tree = await (await r.run()).screen({ state: {} });
      assert.deepEqual(checkScreenTree(tree, "es", undefined, { settings: undefined }).dropped, [], "Kino keeps every node of the tree");
      return shown(tree);
    };
    let v = await view();
    assert.deepEqual([v.fields, v.buttons], [["phone"], ["Enviar código"]], "signed out: the number and Enviar código");
    assert.deepEqual(v.qr, []);
    r.c.account.setPassword(PASSWORD);
    await r.act("send_code");
    v = await view();
    assert.deepEqual([v.fields, v.buttons], [["code"], ["Iniciar sesión", "Usar otro número"]], "code stage: the code, Iniciar sesión, another number");
    await r.act("sign_in", { login_code: r.c.saved.lastCode });
    v = await view();
    assert.deepEqual([v.fields, v.buttons, v.settings], [[], [], ["tg_password", "check_password"]], "password stage: Kino's own secret field and its button");
    await r.act("check_password", { tg_password: PASSWORD });
    v = await view();
    assert.deepEqual([v.fields, v.settings], [[], ["logout"]], "signed in: just Cerrar sesión");
    assert.deepEqual(v.qr, []);
  } finally { r.close(); }
});

test("Usar otro número drops the code that was sent: the screen asks for the number again", async () => {
  const r = rig();
  try {
    await r.act("send_code");
    const p = await r.run();
    assert.deepEqual(shown(await p.screen({ state: {} })).fields, ["code"]);
    await p.screenEvent({ name: "other", state: { inputs: {} } });
    assert.deepEqual(shown(await (await r.run()).screen({ state: {} })).fields, ["phone"]);
  } finally { r.close(); }
});

test("a phone whose session died clears login_ok at its next action, so it stops offering Enviar configuración", async () => {
  const r = rig();
  try {
    await r.act("send_code");
    await r.act("sign_in", { login_code: r.c.saved.lastCode });
    assert.equal(r.values().login_ok, "1");
    r.c.account.revoke();
    await assert.rejects((await r.run()).syncPull({}), (e) => e.code === "auth_required" && /closed/.test(e.message));
    const next = await r.act("send_code");
    assert.ok(next.clearSettings.includes("login_ok"));
    assert.equal(r.values().login_ok, undefined);
  } finally { r.close(); }
});

test("validateSettings: the number with its country code, the code digits only; never echoing them", async () => {
  const r = rig();
  try {
    const p = await r.run();
    assert.equal(await p.validateSettings({ ...API, phone: PHONE, login_ok: "1" }), null);
    const bad = await p.validateSettings({ phone: "12ab", login_ok: "yes" });
    assert.deepEqual(Object.keys(bad).sort(), ["login_ok", "phone"]);
    assert.ok(!JSON.stringify(bad).includes("12ab"));
  } finally { r.close(); }
});

test("the key is untouched by the phone sign-in: no action sets or clears syncKey", async () => {
  const r = rig();
  try {
    const answers = [await r.act("send_code"), await r.act("sign_in", { login_code: r.c.saved.lastCode }), await r.act("logout")];
    for (const a of answers) {
      assert.ok(!Object.keys(a.setSettings || {}).includes("syncKey"));
      assert.ok(!(a.clearSettings || []).includes("syncKey"));
    }
    assert.ok(!hay(r, ...answers).includes(SYNC_KEY));
  } finally { r.close(); }
});
