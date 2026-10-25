// Test harness: the SDK's Node stand-in for the app runtime (sdk/kino-shim.mjs), installed as the global `kino`
// that the library modules read at call time. kino.ws goes through the shim's real gate and queue code; only the
// network under it is replaced (testkit/fake-ws.mjs installs a fake global WebSocket that talks to a fake DC).
import { createKino } from "../sdk/kino-shim.mjs";

export const TEST_MANIFEST = Object.freeze({
  id: "telegram-library-test",
  name: "Telegram library (tests)",
  version: "0.0.0",
  apiVersion: 13,
  entry: "plugin.js",
  hosts: ["*.web.telegram.org"],
  capabilities: ["home", "resolve", "socket", "byteSource"],
});

export function installKino(options = {}) {
  const { kino } = createKino(TEST_MANIFEST, { env: {}, ...options });
  globalThis.kino = kino;
  return kino;
}

/** A kino.storage-shaped in-memory store (get/set of strings) for the login budget and state tests. */
export function memoryStore() {
  const m = new Map();
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => { m.set(k, String(v)); },
    remove: (k) => { m.delete(k); },
    keys: () => [...m.keys()],
  };
}
