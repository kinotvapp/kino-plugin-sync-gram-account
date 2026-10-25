// Opens the plugin's encrypted tg.session (v2) the way live.js seals it, so tests can look at the DC states:
// key = HMAC-SHA256(api_hash + "\n" + bot_token, "tg.session\n" + salt); AES-256-GCM, the tag at the end of `ct`.
import { createHmac, createDecipheriv } from "node:crypto";

// The account's tg.usession (account mode): key = HMAC-SHA256(api_hash + "\naccount:" + api_id, "tg.usession\n" + salt).
export function openSession(storedText, { api_hash, bot_token, api_id, account = false }) {
  const s = JSON.parse(storedText);
  if (s.v === 1) return s.state;
  const key = account
    ? createHmac("sha256", Buffer.from(api_hash + "\naccount:" + api_id, "utf8")).update("tg.usession\n" + s.salt, "utf8").digest()
    : Buffer.from(createHmac("sha256", Buffer.from(api_hash + "\n" + bot_token, "utf8")).update("tg.session\n" + s.salt, "utf8").digest("hex"), "hex");
  const raw = Buffer.from(s.ct, "base64");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(s.iv, "hex"));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString("utf8"));
}
