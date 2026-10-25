// Typed errors: every failure the library throws is an Error with a string `code` from CODES, plus the extra fields
// the code needs (`seconds` for flood_wait/login_budget, `dc` for the migrations, `rpc`/`status` for server errors).

export const CODES = Object.freeze([
  "flood_wait",             // { seconds } Telegram asked to wait (FLOOD_WAIT_n, or a transport flood -429)
  "file_migrate",           // { dc } the file lives on another DC (FILE_MIGRATE_n)
  "user_migrate",           // { dc } the account lives on another DC (USER_/PHONE_/NETWORK_MIGRATE_n)
  "file_reference_expired", // the document's file_reference must be refreshed from its message
  "auth_key_unregistered",  // the server does not know this key or session (401s, transport -404)
  "bad_msg",                // { badMsgCode } the server refused our message and resending did not help
  "closed",                 // the socket closed
  "timeout",                // no answer in time
  "protocol",               // malformed or unexpected data from the server
  "rpc_error",              // { status, rpc } any other server error
  "invalid_request",        // bad arguments from the caller (offset/limit rules, missing fields)
  "login_budget",           // { seconds } too many bot logins on this device in the last hour
  "channel_invalid",        // the channel is unknown, its access hash is wrong, or the bot lost access (CHANNEL_INVALID/PRIVATE)
  "bot_method_invalid",     // a method bots may not call (BOT_METHOD_INVALID)
  "token_invalid",          // the bot token was refused at login (ACCESS_TOKEN_INVALID / ACCESS_TOKEN_EXPIRED)
  "api_id_invalid",         // the api_id/api_hash pair was refused (API_ID_INVALID, API_ID_PUBLISHED_FLOOD)
  "password_needed",        // the account has a 2FA password: auth.checkPassword next (SESSION_PASSWORD_NEEDED)
  "password_invalid",       // the 2FA password was wrong (PASSWORD_HASH_INVALID), or its SRP round went stale (SRP_ID_INVALID)
  "login_token_invalid",    // a QR login token expired, was already used or is unknown (AUTH_TOKEN_*)
]);

export function mtError(code, message, extra) {
  const e = new Error(message);
  e.name = "MtprotoError";
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}

/** An rpc_error { code, message } as a typed error. */
export function fromRpcError({ code, message }) {
  const m = String(message);
  const tail = (re) => { const x = re.exec(m); return x ? Number(x[1]) : null; };
  let n;
  if ((n = tail(/^FLOOD_(?:PREMIUM_)?WAIT_(\d+)$/)) !== null) return mtError("flood_wait", m, { seconds: n, status: code, rpc: m });
  if ((n = tail(/^FILE_MIGRATE_(\d+)$/)) !== null) return mtError("file_migrate", m, { dc: n, status: code, rpc: m });
  if ((n = tail(/^(?:USER|PHONE|NETWORK)_MIGRATE_(\d+)$/)) !== null) return mtError("user_migrate", m, { dc: n, status: code, rpc: m });
  if (/^FILE_REFERENCE_/.test(m)) return mtError("file_reference_expired", m, { status: code, rpc: m });
  if (m === "CHANNEL_INVALID" || m === "CHANNEL_PRIVATE") return mtError("channel_invalid", m, { status: code, rpc: m });
  if (/^ACCESS_TOKEN_(INVALID|EXPIRED)$/.test(m)) return mtError("token_invalid", m, { status: code, rpc: m });
  if (/^API_ID_(INVALID|PUBLISHED_FLOOD)$/.test(m)) return mtError("api_id_invalid", m, { status: code, rpc: m });
  if (m === "BOT_METHOD_INVALID") return mtError("bot_method_invalid", m, { status: code, rpc: m });
  // Before the 401 rule: SESSION_PASSWORD_NEEDED is a 401 that keeps the key (the login goes on with the password).
  if (m === "SESSION_PASSWORD_NEEDED") return mtError("password_needed", m, { status: code, rpc: m });
  if (m === "PASSWORD_HASH_INVALID" || m === "SRP_ID_INVALID" || m === "SRP_PASSWORD_CHANGED") return mtError("password_invalid", m, { status: code, rpc: m });
  if (/^AUTH_TOKEN_(INVALID|EXPIRED|ALREADY_ACCEPTED|INVALIDX)$/.test(m)) return mtError("login_token_invalid", m, { status: code, rpc: m });
  if (code === 401 || /^AUTH_KEY_(UNREGISTERED|INVALID|DUPLICATED)$/.test(m) || m === "SESSION_REVOKED") return mtError("auth_key_unregistered", m, { status: code, rpc: m });
  return mtError("rpc_error", code + " " + m, { status: code, rpc: m });
}

/** A 4-byte transport packet (a negative int32 error code) as a typed error. */
export function fromTransportError(status) {
  if (status === -404) return mtError("auth_key_unregistered", "transport error -404", { status, transport: true });
  if (status === -429) return mtError("flood_wait", "transport error -429", { status, seconds: 5, transport: true });
  return mtError("protocol", "transport error " + status, { status, transport: true });
}

const scrubText = (s) => String(s).replace(/[0-9a-fA-F]{16,}/g, "<hex>").replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, "<b64>").replace(/["\\]/g, "'").replace(/\s+/g, " ").slice(0, 160);

/**
 * One line of detail for any thrown value, for the logs: a typed error as `code=<code> rpc=<RPC> seconds= dc=`, anything
 * else as `code=- name=<constructor or typeof> message="<text>" at=<first stack frame>`. Long hex or base64 runs are cut
 * out (no data, no keys), and nothing is ever `undefined`.
 */
export function describeError(e) {
  if (e && typeof e === "object" && typeof e.code === "string" && /^[a-z_]{1,40}$/.test(e.code)) {
    const parts = ["code=" + e.code];
    if (typeof e.rpc === "string" && /^[A-Z0-9_]{1,60}$/.test(e.rpc)) parts.push("rpc=" + e.rpc);
    if (Number.isFinite(e.seconds)) parts.push("seconds=" + Math.round(e.seconds));
    if (Number.isFinite(e.dc)) parts.push("dc=" + Math.round(e.dc));
    if (e.deadline === true) parts.push("deadline=1");
    return parts.join(" ");
  }
  if (e instanceof Error || (e && typeof e === "object" && typeof e.message === "string")) {
    const name = typeof e.name === "string" && e.name ? e.name : "Error";
    const frame = typeof e.stack === "string" ? (e.stack.split("\n").map((l) => l.trim()).find((l) => l.startsWith("at ")) || "") : "";
    return 'code=- name=' + scrubText(name).replace(/\s/g, "") + ' message="' + scrubText(e.message) + '"' + (frame ? " at=" + scrubText(frame.slice(3)).replace(/\s/g, "") : "");
  }
  if (e === null) return 'code=- name=null message=""';
  if (e === undefined) return 'code=- name=nothing message=""'; // `throw undefined`: said so, never the word undefined
  if (typeof e === "object") return 'code=- name=object message="[object]"';
  return "code=- name=" + typeof e + ' message="' + scrubText(e) + '"';
}

/** Whether `e` leaves the connection it came from in a known state (a server's own answer): else it must be dropped. */
export const isServerAnswer = (e) => !!(e && typeof e === "object" && ["flood_wait", "file_migrate", "user_migrate", "file_reference_expired", "rpc_error", "channel_invalid", "bot_method_invalid", "token_invalid", "api_id_invalid", "auth_key_unregistered", "login_budget", "invalid_request", "password_needed", "password_invalid", "login_token_invalid"].includes(e.code) && !e.transport);
