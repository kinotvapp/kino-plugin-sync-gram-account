// Which export of the plugin the kit is running right now, as the app's PluginCallTracker knows it: what kino.qr.scan
// checks (only a settings `action` or a `panelAction` may open the scanner). loadPlugin (sandbox.mjs) runs every export
// inside kitCall.run(name, …); a test can do the same around its own calls.
import { AsyncLocalStorage } from "node:async_hooks";

export const kitCall = new AsyncLocalStorage();

/** [plugin] (a loaded entry's exports) with each function run as that export's call ([kitCall]). */
export function trackedExports(plugin) {
  return new Proxy(plugin, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver);
      if (typeof v !== "function" || typeof key !== "string") return v;
      return function tracked(...args) { return kitCall.run(key, () => v.apply(this, args)); };
    },
  });
}
