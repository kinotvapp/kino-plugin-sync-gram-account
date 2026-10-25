// Sync-Gram Cuenta's settings form (1.1.0): the manifest under the kit (a standalone sync provider with socket and
// storageLarge), the form per device (the phone signs in with its number and a code, the TV with a QR it shows by
// itself), the sync key (Kino makes it itself: sync.generateKey, never drawn), the provision list with login_ok (Enviar
// configuración only after a sign-in that worked), the TV's manual QR login (budget, FLOOD_WAIT, expiry, 2FA cleared after
// every attempt), the status line per state, and a Kino without kino.ws. The phone sign-in is test/phone.test.mjs, the
// TV's automatic one test/tv.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { cluster, device, blobOf, API, SYNC_KEY, MANIFEST, ROOT } from "./harness.mjs";
import { openSession } from "../testkit/session-open.mjs";
import { validateManifest, isStandaloneSet } from "../sdk/contract.mjs";
import { validate } from "../sdk/validate.mjs";

const PASSWORD = "contraseña-de-prueba 2FA";
const VALUELESS = ["section", "status", "action", "qr", "link", "help"];
// Kino never draws the key it makes itself (sync.generateKey): the host hides it on every device.
const hostHidden = (s) => MANIFEST.sync.generateKey === true && s.key === MANIFEST.sync.keySecret;
const drawnOn = (dev) => MANIFEST.settings.filter((s) => (!s.devices || s.devices.includes(dev)) && !hostHidden(s)).map((s) => s.key);
const drawnUnder = (dev, answer) => drawnOn(dev).filter((k) => !(answer.hide || []).includes(k));

/** A device and a clock the login reads through kino.now (the fake DC keeps the real one). */
function rig({ lang = "es-CO", manifest } = {}) {
  const c = cluster();
  const d = device({ lang, ...(manifest ? { manifest } : {}) });
  let skew = 0;
  const now = () => Date.now() + skew;
  const run = (values = API, opts = {}) => d.runtime(values, { now, ...opts });
  const tv = (values = API, opts = {}) => run(values, { device: "tv", ...opts });
  return { c, d, run, tv, tick: (ms) => { skew += ms; }, close: () => { d.close(); c.close(); } };
}

/** The TV's QR login pressed by hand (no login_ok: nothing starts by itself), the scan, the next refresh. */
async function qrSignIn(r, values = API) {
  const p = await r.tv(values);
  const started = await p.action("qr_login");
  assert.match(started.message, /Ajustes ▸ Dispositivos ▸ Vincular un dispositivo/);
  const s1 = await p.settingsStatus();
  assert.match(s1.login_qr, /^tg:\/\/login\?token=[A-Za-z0-9_-]{43}$/);
  assert.ok(r.c.account.scan());
  r.tick(11000); // the next form refresh, 10 s later, asks Telegram again
  const s2 = await p.settingsStatus();
  return { p, s1, s2, started };
}

test("the manifest: a standalone sync provider with socket and storageLarge, accepted by the kit's checks", async () => {
  assert.deepEqual([MANIFEST.id, MANIFEST.name, MANIFEST.version, MANIFEST.apiVersion], ["sync-gram-account", "Sync-Gram Cuenta", "1.1.2", 13]);
  assert.deepEqual(MANIFEST.capabilities, ["syncProvider", "socket", "storageLarge"]);
  assert.ok(isStandaloneSet(MANIFEST.capabilities));
  assert.deepEqual(MANIFEST.hosts, ["pluto.web.telegram.org", "venus.web.telegram.org", "aurora.web.telegram.org", "vesta.web.telegram.org", "flora.web.telegram.org"]);
  const r = validateManifest(JSON.stringify(MANIFEST));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  const v = await validate(ROOT);
  assert.equal(v.ok, true, v.problems.join("\n"));
  assert.ok(v.consent.some((l) => l.danger && /podrán leerlos/.test(l.text)), JSON.stringify(v.consent));
  assert.match(MANIFEST.description, /No oficial: sin relación con Telegram/);
  // Kino's limits: 12 settings with a value, 16 others.
  const valued = MANIFEST.settings.filter((s) => !VALUELESS.includes(s.type));
  assert.deepEqual(valued.map((s) => s.key), ["api_id", "api_hash", "phone", "login_code", "tg_password", "syncKey", "login_ok"]);
  assert.ok(MANIFEST.settings.length - valued.length <= 16);
});

test("the sync block: the key Kino makes, and the provision hands over the key, api_id, api_hash, a one-shot 2FA password and login_ok", () => {
  assert.deepEqual(MANIFEST.sync, {
    mode: "poll", pullEveryMs: 600000, pushDebounceMs: 300000, maxBlobBytes: 4194304, keySecret: "syncKey", generateKey: true,
    provision: ["syncKey", "api_id", "api_hash", "tg_password", "login_ok"],
  });
  const of = (k) => MANIFEST.settings.find((s) => s.key === k);
  assert.deepEqual([of("syncKey").type, of("syncKey").default, of("syncKey").sync], ["password", undefined, undefined]);
  // Device-only (never synced, never in a backup): the number, the code and the 2FA password. Only the 2FA password is
  // provisioned (once, to the TV); the number and the code never leave the phone.
  assert.deepEqual(MANIFEST.settings.filter((s) => s.sync === false).map((s) => s.key), ["phone", "login_code", "tg_password"]);
  for (const k of ["login_code", "tg_password", "api_id", "api_hash"]) assert.equal(of(k).type, "password", k);
  // The number is shown as typed (a text, nothing masked) but stays on this device: "sync": false on a text (Kino 13).
  assert.deepEqual([of("phone").type, of("phone").sync, of("phone").hint], ["text", false, "Con código de país, por ejemplo +57 300 1234567"]);
  // Step 3 says the code field and Iniciar sesión come after Enviar código.
  assert.match(of("tg3").hint, /Enviar código\. Después aparecen Código e Iniciar sesión/);
  assert.match(of("tg3").hintEn, /Send the code\. Then Code and Sign in appear/);
  assert.ok(!MANIFEST.sync.provision.includes("phone") && !MANIFEST.sync.provision.includes("login_code"));
  // login_ok: a text the sign-in fills (setSettings), not device-only, so the host's "what must hold a value to send"
  // (every provision name but the device-only ones and the generated key) is exactly api_id, api_hash and login_ok.
  assert.deepEqual([of("login_ok").type, of("login_ok").sync, of("login_ok").default], ["text", undefined, undefined]);
  const deviceOnly = MANIFEST.sync.provision.filter((n) => of(n).type === "password" && of(n).sync === false);
  const neededToSend = MANIFEST.sync.provision.filter((n) => !deviceOnly.includes(n) && n !== MANIFEST.sync.keySecret);
  assert.deepEqual(neededToSend, ["api_id", "api_hash", "login_ok"]);
  const bad = JSON.parse(JSON.stringify(MANIFEST));
  bad.sync.keySecret = "tg_password";
  assert.equal(validateManifest(JSON.stringify(bad)).ok, false);
});

test("the form: my.telegram.org, the api fields, what this device keeps, the phone's sign-in; the TV's QR; status", () => {
  assert.deepEqual(MANIFEST.settings.map((s) => s.key), [
    "tg1", "mytelegram", "tg2", "api_id", "api_hash", "scope", "tg3", "phone", "send_code", "login_code", "sign_in",
    "tg_password", "check_password", "qr_login", "login_qr", "syncKey", "login_ok", "logout", "status",
  ]);
  assert.deepEqual(MANIFEST.settings.filter((s) => s.type === "section").map((s) => [s.label, s.labelEn]), [
    ["1. Abre my.telegram.org", "1. Open my.telegram.org"],
    ["2. Crea una app y copia los datos", "2. Create an app and copy the data"],
    ["Lo que guarda este aparato", "What this device keeps"],
    ["3. Inicia sesión con tu teléfono", "3. Sign in with your phone"],
  ]);
  const of = (k) => MANIFEST.settings.find((s) => s.key === k);
  assert.match(of("tg3").hint, /el código que Telegram te manda \(a tu app de Telegram en otro aparato o por SMS\)/);
  assert.match(of("tg3").hintEn, /the code Telegram sends you \(to your Telegram app on another device or by SMS\)/);
  assert.match(of("scope").hint, /sesión de toda tu cuenta de Telegram; tu sesión de Telegram no entra en las copias de seguridad\..*solo actúa en tus Mensajes guardados.*puede hacer más.*Ajustes ▸ Dispositivos/);
  assert.match(of("scope").hintEn, /session of your whole Telegram account; your Telegram session never goes into backups\..*only acts in your Saved Messages.*can do more.*Settings ▸ Devices/);
  assert.deepEqual([of("send_code").label, of("send_code").labelEn, of("sign_in").label, of("sign_in").labelEn], ["Enviar código", "Send the code", "Iniciar sesión", "Sign in"]);
  assert.deepEqual([of("syncKey").hint, of("syncKey").hintEn], ["La crea Kino sola: no la escribas tú", "Kino makes it by itself: do not type it"]);
  const link = of("mytelegram");
  assert.deepEqual([link.type, link.label, link.labelEn, link.url, link.devices], ["link", "Obtener api_id y api_hash", "Get api_id and api_hash", "https://my.telegram.org/apps", ["phone"]]);
  assert.ok(!MANIFEST.hosts.includes("my.telegram.org"), "a link is opened by Kino, never reached by the plugin: no host");
  assert.equal(of("login_qr").refreshMs, 5000);
});

test("per device: the phone never draws the QR, the TV draws only the QR login and the status", () => {
  assert.deepEqual(drawnOn("tv"), ["qr_login", "login_qr", "status"]);
  for (const k of ["qr_login", "login_qr"]) assert.deepEqual(MANIFEST.settings.find((s) => s.key === k).devices, ["tv"], k);
  for (const s of MANIFEST.settings.filter((x) => x.type === "password")) assert.deepEqual(s.devices, ["phone"], s.key);
  assert.deepEqual(drawnOn("phone"), MANIFEST.settings.map((s) => s.key).filter((k) => !["syncKey", "qr_login", "login_qr"].includes(k)));
});

test("login_ok is hidden on every device in every state; every hidden key is one of the manifest's", async () => {
  const r = rig();
  try {
    const keys = new Set(MANIFEST.settings.map((s) => s.key));
    for (const [values, dev] of [[{}, "phone"], [API, "phone"], [{}, "tv"], [{ ...API, login_ok: "1" }, "tv"]]) {
      const st = await (await r.run(values, { device: dev })).settingsStatus();
      assert.ok(st.hide.includes("login_ok"), dev);
      assert.ok(st.hide.every((k) => keys.has(k)));
    }
  } finally { r.close(); }
});

test("the key Kino makes is never stored by the plugin, logged or shown; no action makes or changes one", async () => {
  const r = rig();
  try {
    const p = await r.run(API);
    for (const k of ["create_key", "change_key"]) assert.equal((await p.action(k)).setSettings, undefined, k);
    const outs = [JSON.stringify(await p.settingsStatus()), JSON.stringify(await p.syncStatus(null))];
    try { await p.syncPull({}); } catch (e) { outs.push(String(e.message), String(e.userMessage)); }
    assert.ok(![r.d.storageDump(), r.d.logs.join("\n"), ...outs].join("\n").includes(SYNC_KEY));
  } finally { r.close(); }
});

test("the phone never starts a QR login: it points to its number and the code", async () => {
  const r = rig();
  try {
    const out = await (await r.run()).action("qr_login");
    assert.match(out.message, /En el celular inicia sesión con tu número/);
    assert.equal(r.c.account.stats.exportLoginToken, 0);
  } finally { r.close(); }
});

test("the TV's QR login by hand: the code refreshes, the scan signs in, the session is its own and sealed; the rounds use it", async () => {
  const r = rig();
  try {
    const { p, s2 } = await qrSignIn(r);
    assert.match(s2.status, /Listo: sesión iniciada/);
    assert.equal(s2.login_qr, undefined);
    assert.equal(r.c.account.stats.exportLoginToken, 2);
    assert.equal(r.d.base.storage.get("tg.qr"), null);
    const raw = r.d.base.storage.get("tg.usession");
    const state = openSession(raw, { api_hash: API.api_hash, api_id: API.api_id, account: true });
    assert.equal(state.dcs["2"].loggedIn, true);
    assert.ok(!raw.includes(state.dcs["2"].authKey));
    assert.match((await p.action("qr_login")).message, /Ya iniciaste sesión/);
    const fresh = await r.tv();
    const { version } = await fresh.syncPush({ blob: blobOf(1000, 1), expectedVersion: null });
    assert.deepEqual(await fresh.syncPull({}), { blob: blobOf(1000, 1), version });
    assert.match((await fresh.settingsStatus()).status, /Conectado con tu cuenta/);
    assert.equal(r.c.account.stats.exportLoginToken, 2, "no login after the QR");
  } finally { r.close(); }
});

test("2FA on the TV by hand: the received password is used by Iniciar sesión de Telegram con QR and cleared after every attempt", async () => {
  const r = rig();
  try {
    r.c.account.setPassword(PASSWORD);
    const { s2 } = await qrSignIn(r);
    assert.match(s2.status, /envíala desde tu celular con Enviar configuración/);
    const wrong = await (await r.tv({ ...API, tg_password: "mala" })).action("qr_login");
    assert.match(wrong.message, /no es correcta/);
    assert.deepEqual(wrong.clearSettings, ["tg_password"]);
    const used = await (await r.tv({ ...API, tg_password: PASSWORD })).action("qr_login");
    assert.match(used.message, /sesión iniciada/);
    assert.deepEqual(used.clearSettings, ["tg_password"]);
    assert.equal(r.c.account.stats.checkPassword, 2);
    assert.ok(![r.d.storageDump(), r.d.logs.join("\n"), JSON.stringify([wrong, used])].join("\n").includes(PASSWORD));
  } finally { r.close(); }
  const r2 = rig();
  try {
    // No login under way: a password is not sent anywhere, and it is cleared.
    const start = await (await r2.tv({ ...API, tg_password: PASSWORD })).action("qr_login");
    assert.deepEqual(start.clearSettings, ["tg_password"]);
    assert.equal(r2.c.account.stats.checkPassword, 0);
  } finally { r2.close(); }
});

test("the TV's code stops after its 150 s window; QR logins are budgeted per device (5 an hour)", async () => {
  const r = rig();
  try {
    const p = await r.tv();
    for (let i = 0; i < 5; i++) assert.match((await p.action("qr_login")).message, /Vincular un dispositivo/);
    assert.match((await p.action("qr_login")).message, /Demasiados intentos/);
    r.tick(151000);
    const s = await (await r.tv()).settingsStatus();
    assert.match(s.status, /El código venció/);
    assert.equal(s.login_qr, undefined);
  } finally { r.close(); }
});

test("a FLOOD_WAIT on the TV's QR login is kept: pressing the button again sends nothing while it lasts", async () => {
  const r = rig();
  try {
    const p = await r.tv();
    r.c.tg.dc(2).once("any", () => ({ error: [420, "FLOOD_WAIT_600"] }));
    assert.match((await p.action("qr_login")).message, /pidió esperar: vuelve a intentarlo en 10 minutos/);
    const n = r.c.account.stats.exportLoginToken + (r.c.tg.methodIds || []).length;
    for (let i = 0; i < 3; i++) assert.match((await (await r.tv()).action("qr_login")).message, /pidió esperar/);
    assert.equal(r.c.account.stats.exportLoginToken + (r.c.tg.methodIds || []).length, n);
  } finally { r.close(); }
});

test("Cerrar sesión (phone): auth.logOut, the session goes, login_ok and the 2FA password are cleared", async () => {
  const r = rig();
  try {
    await qrSignIn(r);
    const out = await (await r.run({ ...API, login_ok: "1", tg_password: PASSWORD })).action("logout");
    assert.match(out.message, /se cerró la sesión de tu cuenta/);
    assert.deepEqual(out.clearSettings.sort(), ["login_code", "login_ok", "tg_password"]);
    assert.equal(r.c.account.stats.logOuts, 1);
    assert.equal(r.d.base.storage.get("tg.usession"), null);
    const q = await r.run();
    assert.match((await q.settingsStatus()).status, /Falta iniciar sesión en este aparato: escribe tu número con el código de país y toca Enviar código/);
    await assert.rejects(q.syncPull({}), (e) => e.code === "auth_required" && /signin/.test(e.message));
  } finally { r.close(); }
});

test("the status line per state, with the next step; phone and TV, Spanish and English", async () => {
  const r = rig();
  try {
    const line = async (values, opts) => (await (await r.run(values, opts)).settingsStatus()).status;
    const noKey = { api_id: API.api_id, api_hash: API.api_hash };
    assert.match(await line({}), /Escribe tu api_id y tu api_hash de my\.telegram\.org y toca Guardar/);
    // The TV never names api_id, api_hash or the key: the same sentence as Kino's own card line, until all arrived.
    const tvLine = "Recibe la configuración desde otro aparato: en el otro toca Enviar configuración y aquí Recibir configuración.";
    assert.equal(await line({}, { device: "tv" }), tvLine);
    assert.equal(await line(API, { device: "tv" }), tvLine, "without login_ok the configuration is not complete");
    assert.equal(await line({}, { device: "tv", lang: "en" }), "Get the setup from another device: on the other one tap Send settings, and here Receive settings.");
    assert.match(await line({}, { lang: "en" }), /Enter your api_id and api_hash from my\.telegram\.org/);
    assert.match(await line(noKey), /escribe tu número con el código de país y toca Enviar código/);
    assert.match(await line(API, { lang: "en" }), /enter your number with its country code and tap Send the code/);
    await qrSignIn(r, noKey);
    assert.equal(await line(noKey), "Falta la clave: Kino la crea sola al activar la sincronización, o recíbela desde otro aparato.");
    assert.equal(await line(noKey, { lang: "en" }), "The key is missing: Kino makes it by itself when you turn sync on, or receive it from another device.");
    assert.equal((await (await r.run(noKey)).syncStatus(null)).ready, false);
    assert.match(await line(API), /Conectado con tu cuenta/);
    assert.equal((await (await r.run(API)).syncStatus(null)).ready, true);
  } finally { r.close(); }
});

test("a Kino without kino.ws: the plugin says so and sends nothing", async () => {
  const noSocket = { ...MANIFEST, capabilities: ["syncProvider", "storageLarge"] };
  const r = rig({ manifest: noSocket });
  try {
    for (const p of [await r.run(), await r.tv({ ...API, login_ok: "1" })]) {
      assert.match((await p.settingsStatus()).status, /actualiza Kino/);
      await assert.rejects(p.syncPull({}), (e) => e.code === "auth_required" && /unsupported/.test(e.message));
    }
    assert.match((await (await r.tv()).action("qr_login")).message, /actualiza Kino/);
    assert.match((await (await r.run({ ...API, phone: "+57 300 123 4567" })).action("send_code")).message, /actualiza Kino/);
    assert.equal(r.c.tg.dc(2).stats.connections, 0);
  } finally { r.close(); }
});

test("the session never goes into a backup: it lives in the storageLarge store, the only one this plugin has", async () => {
  assert.ok(MANIFEST.capabilities.includes("storageLarge"));
  const r = rig();
  try {
    await qrSignIn(r);
    assert.ok(r.d.base.storage.get("tg.usession"));
    r.d.base.storage.set("probe", "x".repeat(300 * 1024)); // over the plain 256 KB: this is the large, device-only store
    r.d.base.storage.remove("probe");
  } finally { r.close(); }
});

test("validateSettings checks the api_id, the api_hash and the key's shape", async () => {
  const r = rig();
  try {
    const p = await r.run();
    assert.equal(await p.validateSettings({ ...API }), null);
    const bad = await p.validateSettings({ api_id: "12ab", api_hash: "xyz", syncKey: "corta" });
    assert.deepEqual(Object.keys(bad).sort(), ["api_hash", "api_id", "syncKey"]);
    assert.ok(!JSON.stringify(bad).includes("corta"));
  } finally { r.close(); }
});
