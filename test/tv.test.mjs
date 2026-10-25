// The TV (1.1.0, owner: "on the TV it only receives the configuration and does nothing else there"): a TV needs its own
// session, so once the received configuration is in place (api_id, api_hash, syncKey, login_ok) and it holds no
// session, its page starts the QR login by itself from settingsStatus (never from a sync round), draws the QR and the
// scan line, and, when Telegram asks for the two-step password, uses the one received from the phone, once. The
// budget (5 logins an hour) and FLOOD_WAIT still hold; "Iniciar sesión de Telegram con QR" shows only after the automatic attempt
// expired or failed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cluster, device, API, blobOf } from "./harness.mjs";

const PASSWORD = "contraseña-de-prueba 2FA";
const RECEIVED = Object.freeze({ ...API, login_ok: "1" }); // what "Recibir configuración" leaves on the TV
const SCAN = "Escanea este código con Telegram en tu teléfono: Ajustes ▸ Dispositivos ▸ Vincular un dispositivo.";

function rig() {
  const c = cluster();
  const d = device();
  let skew = 0;
  const now = () => Date.now() + skew;
  const tv = (values = RECEIVED, opts = {}) => d.runtime(values, { now, device: "tv", ...opts });
  return { c, d, tv, tick: (ms) => { skew += ms; }, close: () => { d.close(); c.close(); } };
}
const logins = (r) => r.c.account.stats.exportLoginToken;

test("with the received configuration and no session the TV page starts the QR login by itself and shows the scan line", async () => {
  const r = rig();
  try {
    const st = await (await r.tv()).settingsStatus();
    assert.match(st.login_qr, /^tg:\/\/login\?token=[A-Za-z0-9_-]{43}$/);
    assert.equal(st.status, SCAN);
    assert.ok(st.hide.includes("qr_login"), "no button while the automatic attempt runs");
    assert.ok(!st.hide.includes("login_qr"));
    assert.equal(logins(r), 1);
    // The person scans with the phone's Telegram; the next refresh signs in.
    assert.ok(r.c.account.scan());
    r.tick(11000);
    const done = await (await r.tv()).settingsStatus();
    assert.match(done.status, /sesión iniciada|Conectado/);
    const after = await (await r.tv()).settingsStatus();
    assert.match(after.status, /Conectado con tu cuenta/);
    for (const k of ["qr_login", "login_qr", "logout"]) assert.ok(after.hide.includes(k), "connected: only the status, hides " + k);
    const en = await (await r.tv(RECEIVED, { lang: "en" })).settingsStatus();
    assert.match(en.status, /Connected to your account/);
  } finally { r.close(); }
});

test("the English scan line", async () => {
  const r = rig();
  try {
    const st = await (await r.tv(RECEIVED, { lang: "en" })).settingsStatus();
    assert.equal(st.status, "Scan this code with Telegram on your phone: Settings ▸ Devices ▸ Link Desktop Device.");
  } finally { r.close(); }
});

test("no automatic login without every received value, on the phone, or from a sync round", async () => {
  const r = rig();
  try {
    for (const missing of ["api_id", "api_hash", "syncKey", "login_ok"]) {
      const v = { ...RECEIVED };
      delete v[missing];
      const st = await (await r.tv(v)).settingsStatus();
      assert.equal(st.login_qr, undefined, "missing " + missing);
    }
    // The phone never shows a QR and never starts one by itself.
    const phone = await (await r.d.runtime(RECEIVED, {})).settingsStatus();
    assert.equal(phone.login_qr, undefined);
    // A sync round (no form on screen) never logs in.
    const p = await r.tv();
    await assert.rejects(p.syncPull({}), (e) => e.code === "auth_required");
    await assert.rejects(p.syncPush({ blob: blobOf(10, 1), expectedVersion: null }), (e) => e.code === "auth_required");
    await p.syncStatus(null);
    assert.equal(logins(r), 0);
    assert.equal(r.c.tg.dc(2).stats.connections, 0);
  } finally { r.close(); }
});

test("an expired code restarts by itself while the page is open, within the budget; past it the button shows", async () => {
  const r = rig();
  try {
    await (await r.tv()).settingsStatus();
    for (let i = 2; i <= 5; i++) {
      r.tick(151000);
      const st = await (await r.tv()).settingsStatus();
      assert.match(st.login_qr || "", /^tg:\/\/login/, "restart " + i);
      assert.equal(logins(r), i);
    }
    r.tick(151000);
    const stopped = await (await r.tv()).settingsStatus();
    assert.equal(stopped.login_qr, undefined);
    assert.match(stopped.status, /El código venció: toca Iniciar sesión de Telegram con QR/);
    assert.ok(!stopped.hide.includes("qr_login"), "the manual retry shows");
    assert.equal(logins(r), 5, "never past the budget");
    // The next hour, the manual button starts a new one.
    r.tick(3600000);
    const manual = await (await r.tv()).action("qr_login");
    assert.match(manual.message, /escanea el código|Escanea este código/);
    assert.equal(logins(r), 6);
  } finally { r.close(); }
});

test("a FLOOD_WAIT on the automatic login is recorded: nothing more is sent while it lasts, and the button shows", async () => {
  const r = rig();
  try {
    r.c.tg.dc(2).once("any", () => ({ error: [420, "FLOOD_WAIT_600"] }));
    const st = await (await r.tv()).settingsStatus();
    assert.equal(st.login_qr, undefined);
    assert.match(st.status, /pidió esperar/);
    const n = (r.c.tg.methodIds || []).length;
    for (let i = 0; i < 3; i++) await (await r.tv()).settingsStatus();
    assert.equal((r.c.tg.methodIds || []).length, n);
    assert.ok(!(await (await r.tv()).settingsStatus()).hide.includes("qr_login"));
  } finally { r.close(); }
});

test("an exhausted budget: the TV does not start a login by itself", async () => {
  const r = rig();
  try {
    const p = await r.tv({ ...API }); // no login_ok: manual presses only
    for (let i = 0; i < 5; i++) await p.action("qr_login");
    r.tick(151000); // the last manual code's window is over
    const before = logins(r);
    const st = await (await r.tv()).settingsStatus();
    assert.equal(st.login_qr, undefined);
    assert.equal(logins(r), before);
    assert.ok(!st.hide.includes("qr_login"));
  } finally { r.close(); }
});

test("2FA: the received password is used by itself, once; a wrong one is not tried again until a new one arrives", async () => {
  const r = rig();
  try {
    r.c.account.setPassword(PASSWORD);
    await (await r.tv({ ...RECEIVED, tg_password: "mala" })).settingsStatus();
    r.c.account.scan();
    r.tick(11000);
    const wrong = await (await r.tv({ ...RECEIVED, tg_password: "mala" })).settingsStatus();
    assert.match(wrong.status, /La contraseña de dos pasos que recibiste no es correcta/);
    assert.equal(r.c.account.stats.checkPassword, 1);
    // The same value is never sent twice.
    for (let i = 0; i < 3; i++) await (await r.tv({ ...RECEIVED, tg_password: "mala" })).settingsStatus();
    assert.equal(r.c.account.stats.checkPassword, 1);
    // A new one arrives from the phone: used once, and it signs in.
    const right = await (await r.tv({ ...RECEIVED, tg_password: PASSWORD })).settingsStatus();
    assert.match(right.status, /sesión iniciada/);
    assert.equal(r.c.account.stats.checkPassword, 2);
    const hay = [r.d.storageDump(), r.d.logs.join("\n"), JSON.stringify([wrong, right])].join("\n");
    assert.ok(!hay.includes(PASSWORD) && !hay.includes("mala"));
    // The TV's next action clears it.
    const out = await (await r.tv({ ...RECEIVED, tg_password: PASSWORD })).action("qr_login");
    assert.ok(out.clearSettings.includes("tg_password"));
  } finally { r.close(); }
});

test("without a received password the TV asks for it from the phone, and the button runs it once it is there", async () => {
  const r = rig();
  try {
    r.c.account.setPassword(PASSWORD);
    await (await r.tv()).settingsStatus();
    r.c.account.scan();
    r.tick(11000);
    const asks = await (await r.tv()).settingsStatus();
    assert.match(asks.status, /envíala desde tu celular con Enviar configuración/);
  } finally { r.close(); }
});
