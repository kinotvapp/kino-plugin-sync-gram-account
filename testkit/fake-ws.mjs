// A fake global WebSocket for the shim's kino.ws: no network. `installFakeWebSocket(route)` replaces
// globalThis.WebSocket; each `new WebSocket(url)` asks `route(url)` for an endpoint `{ accept(socket) -> peer }` where
// `peer.onData(Uint8Array)` gets every frame the client sends and `socket.deliver(Uint8Array)` / `socket.serverClose()`
// talk back. Events are dispatched on later macrotasks, as a real socket would.

const tick = (fn) => setImmediate(fn);

export class FakeSocket {
  constructor(url, protocol, route) {
    this.url = url;
    this.protocol = protocol;
    this.readyState = 0;
    this.binaryType = "blob";
    this.listeners = { open: [], message: [], close: [], error: [] };
    this.sent = [];
    tick(() => {
      const endpoint = route(url);
      if (!endpoint) { this.emit("error", {}); this.readyState = 3; this.emit("close", {}); return; }
      this.peer = endpoint.accept(this);
      this.readyState = 1;
      this.emit("open", {});
    });
  }
  addEventListener(type, fn) { this.listeners[type].push(fn); }
  emit(type, ev) { for (const fn of this.listeners[type]) fn(ev); }
  send(data) {
    if (this.readyState !== 1) throw new Error("not open");
    const copy = new Uint8Array(data);
    this.sent.push(copy);
    tick(() => { if (this.peer && this.readyState === 1) this.peer.onData(copy); });
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    tick(() => { this.emit("close", {}); if (this.peer && this.peer.onClose) this.peer.onClose(); });
  }
  /** Server -> client frame. */
  deliver(u8) {
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.length);
    tick(() => { if (this.readyState === 1) this.emit("message", { data: ab }); });
  }
  /** The server drops the connection. */
  serverClose() { this.close(); }
}

export function installFakeWebSocket(route) {
  const previous = globalThis.WebSocket;
  const sockets = [];
  globalThis.WebSocket = class extends FakeSocket {
    constructor(url, protocol) { super(url, protocol, route); sockets.push(this); }
  };
  return { sockets, restore: () => { globalThis.WebSocket = previous; } };
}
