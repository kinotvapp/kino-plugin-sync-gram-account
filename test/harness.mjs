// Sync-Gram Cuenta as Kino runs it, in Node: the plugin's one-file bundle (scripts/build.mjs from src/plugin.js) in the
// kit's sandbox (sdk/sandbox.mjs: its own realm, only Kino's globals) on the kit's kino (kino.ws with its host
// gate, kino.crypto, kino.storage), under the plugin's own manifest, against the vendored fake cluster with Saved
// Messages (testkit/fake-saved.mjs). No network, no real Telegram, no real account.
//
// The one change to the bundle is the fake DC's RSA key in place of Telegram's (exactly one line, asserted).
//
// signIn() makes a device's session the way the plugin's QR login stores it, outside the plugin (a `sync` client in this
// realm signs in against the fake account), sealed with node:crypto independently of the plugin's code, in the format
// and under the key the plugin reads (tg.usession). The QR login itself is tested through the plugin (form.test.mjs).
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, createHmac, createCipheriv, randomBytes } from "node:crypto";
import { bundle } from "../scripts/build.mjs";
import { loadPlugin } from "../sdk/sandbox.mjs";
import { createKino } from "../sdk/kino-shim.mjs";
import { FakeTelegram, fakeRsa } from "../testkit/fake-dc.mjs";
import { FakeAccount } from "../testkit/fake-account.mjs";
import { FakeSaved } from "../testkit/fake-saved.mjs";
import { installKino } from "../testkit/kino.mjs";
import { TelegramClient } from "../src/mtproto/client.js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ENTRY = join(ROOT, "src/plugin.js");
export const BUILT = join(ROOT, "plugin.js");
export const KEYS_LINE = "const PUBLIC_KEYS = TELEGRAM_PUBLIC_KEYS;";
export const MANIFEST = Object.freeze(JSON.parse(readFileSync(join(ROOT, "kino-plugin.json"), "utf8")));
// Shaped like the person's own values; the api_hash and the sync key are what must never leak.
export const SYNC_KEY = "5be1d0c4a7f2963e18b0d4c2a9e7f3016c5d8b2e4f7a90c1d3e5f7092b4c6d8e";
export const API = Object.freeze({ api_id: "123456", api_hash: "0123456789abcdef0123456789abcdef", syncKey: SYNC_KEY });

/** The bundle as published (real keys) and as tested (the fake cluster's key). */
export function bundles() {
  const real = bundle(ENTRY);
  const parts = real.split(KEYS_LINE);
  if (parts.length !== 2) throw new Error("the public keys line must appear exactly once in the bundle");
  return { real, test: parts.join("const PUBLIC_KEYS = " + JSON.stringify(fakeRsa().publicKeys) + ";") };
}

/** A fake cluster with one account (home DC 2) and its Saved Messages. */
export function cluster(accountOptions = {}) {
  const tg = new FakeTelegram().install();
  const account = new FakeAccount({ homeDc: 2, ...accountOptions });
  const saved = new FakeSaved(account).install(tg);
  return { tg, account, saved, close: () => tg.restore() };
}

/**
 * A device: one kino.storage and one kino.catalog that survive runtimes, as in the app. `runtime(values)` loads a fresh
 * copy of the plugin (a new sandbox) with those settings. Logs go to `logs`.
 */
export function device({ lang = "es-CO", manifest = MANIFEST } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sync-gram-account-"));
  const file = join(dir, "plugin.js");
  writeFileSync(file, bundles().test);
  const { kino: base } = createKino(manifest, { env: {}, config: {}, lang });
  const logs = [];
  const sink = (...a) => logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  const kinoLog = Object.assign((...a) => sink("[kino.log]", ...a), { report: (...a) => sink("[kino.log.report]", ...a) });
  let previous = new Set(); // the sockets of the last runtime
  return {
    base,
    logs,
    async runtime(values = API, { lang: l = lang, now = null, device: kd = undefined } = {}) {
      // Settings as Kino gives them: the stored value, else the manifest's default (a select's first option).
      const cfg = {};
      for (const s of manifest.settings) {
        if (["section", "status", "action", "qr", "link", "help"].includes(s.type)) continue;
        const v = values[s.key] !== undefined ? values[s.key] : s.default !== undefined ? s.default : s.type === "select" ? s.options[0].value : undefined;
        if (v !== undefined && v !== "") cfg[s.key] = v;
      }
      // Kino closes a sandbox's sockets with it (and allows 4 open per plugin): a new runtime replaces the last one.
      for (const sock of previous) { try { await sock.close(); } catch { /* closed already */ } }
      const mine = (previous = new Set());
      const ws = base.ws ? Object.freeze({ ...base.ws, open: async (...a) => { const sock = await base.ws.open(...a); mine.add(sock); return sock; } }) : base.ws;
      const kino = Object.freeze({ ...base, ws, lang: l, log: kinoLog, config: Object.freeze({ get: (k) => cfg[k], all: () => ({ ...cfg }) }), ...(now ? { now } : {}), ...(kd ? { device: kd } : {}) });
      const t0 = process.hrtime.bigint();
      const { plugin } = await loadPlugin(file, kino, { console: { log: sink, info: sink, warn: sink, error: sink } });
      const loadMs = Number(process.hrtime.bigint() - t0) / 1e6;
      const calls = { loadMs };
      for (const [name, fn] of Object.entries(plugin)) {
        if (typeof fn === "function") calls[name] = async (...args) => { const v = await fn(...JSON.parse(JSON.stringify(args))); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
      }
      return calls;
    },
    storageDump() { return JSON.stringify(Object.fromEntries(base.storage.keys().map((k) => [k, base.storage.get(k)]))); },
    close() { rmSync(dir, { recursive: true, force: true }); },
  };
}

/** The session the plugin stores after a QR login on device `d`, sealed independently (node:crypto). */
export async function signIn(d, c, { api = API } = {}) {
  installKino();
  const client = new TelegramClient({ mode: "sync", apiId: Number(api.api_id), publicKeys: fakeRsa().publicKeys, store: false });
  await client.connect(2);
  const first = await client.qrLoginStep({ apiHash: api.api_hash });
  if (!first.token) throw new Error("expected a QR token");
  if (!c.account.scan()) throw new Error("scan failed");
  await client.qrLoginStep({ apiHash: api.api_hash });
  const state = client.exportState();
  await client.close();
  const salt = randomBytes(16).toString("hex");
  const key = Buffer.from(createHmac("sha256", Buffer.from(api.api_hash + "\naccount:" + api.api_id, "utf8")).update("tg.usession\n" + salt, "utf8").digest("hex"), "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
  const fp = createHash("sha256").update("account\n" + api.api_id, "utf8").digest("hex").slice(0, 16);
  d.base.storage.set("tg.usession", JSON.stringify({ v: 2, fp, salt, iv: iv.toString("hex"), ct }));
  c.saved.log.length = 0;
  return state;
}

/** A random blob of `bytes` bytes, as Kino hands it (base64). */
export function blobOf(bytes, seed = 1) {
  const b = Buffer.alloc(bytes);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < bytes; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; b[i] = x & 255; }
  return b.toString("base64");
}
