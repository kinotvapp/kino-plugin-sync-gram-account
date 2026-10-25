// Sync-Gram Cuenta's phone sign-in (1.1.0): a phone cannot scan its own QR, so it signs in with its number and the code
// Telegram sends. These two methods go on the LOGIN list of the `sync` client mode only (client.js authInvoke), never
// through `call`. Not vendored: Sync-Gram Cuenta's own code, next to requests.js because that is where it would go
// upstream. Checked by hand against the layer-198 TL schema (gramjs tl/apiTl.js, the source the Library's schema was
// generated from):
// auth.sendCode#a677244f phone_number:string api_id:int api_hash:string settings:CodeSettings = auth.SentCode
// codeSettings#ad253d78 flags:# allow_flashcall:flags.0?true current_number:flags.1?true allow_app_hash:flags.4?true
//   allow_missed_call:flags.5?true allow_firebase:flags.7?true unknown_number:flags.9?true logout_tokens:flags.6?Vector<bytes>
//   token:flags.8?string app_sandbox:flags.8?Bool = CodeSettings
// auth.signIn#8d52a951 flags:# phone_number:string phone_code_hash:string phone_code:flags.0?string
//   email_verification:flags.1?EmailVerification = auth.Authorization
// auth.sentCode#5e002502 flags:# type:auth.SentCodeType phone_code_hash:string next_type:flags.1?auth.CodeType
//   timeout:flags.2?int = auth.SentCode
// auth.sentCodeSuccess#2390fe44 authorization:auth.Authorization = auth.SentCode
// auth.sentCodeTypeApp#3dbb5986 length:int   auth.sentCodeTypeSms#c000bba2 length:int   auth.sentCodeTypeCall#5353e5a7 length:int
// auth.sentCodeTypeFlashCall#ab03c6d9 pattern:string   auth.sentCodeTypeMissedCall#82006484 prefix:string length:int
// auth.sentCodeTypeEmailCode#f450f59b flags:# apple_signin_allowed:flags.0?true google_signin_allowed:flags.1?true
//   email_pattern:string length:int reset_available_period:flags.3?int reset_pending_date:flags.4?int
// auth.sentCodeTypeSetUpEmailRequired#a5491dea flags:# apple_signin_allowed:flags.0?true google_signin_allowed:flags.1?true
// auth.sentCodeTypeFragmentSms#d9565c39 url:string length:int
// auth.sentCodeTypeFirebaseSms#9fd736 flags:# nonce:flags.0?bytes play_integrity_project_id:flags.2?long
//   play_integrity_nonce:flags.2?bytes receipt:flags.1?string push_timeout:flags.1?int length:int
// auth.sentCodeTypeSmsWord#a416ac81 flags:# beginning:flags.0?string   auth.sentCodeTypeSmsPhrase#b37794af (the same)
// auth.resendCode is not here: "Enviar código" again asks a new code (auth.sendCode), so the list stays at two.
import { Writer, Reader } from "./tl.js";
import { mtError } from "./errors.js";

export const PHONE_METHOD = Object.freeze({ sendCode: 0xa677244f, signIn: 0x8d52a951 });
export const PHONE_AUTH_CALLS = Object.freeze([PHONE_METHOD.sendCode, PHONE_METHOD.signIn]);
const CODE_SETTINGS = 0xad253d78;
const SENT_CODE = 0x5e002502;
const SENT_CODE_SUCCESS = 0x2390fe44;
/** A number as Telegram takes it: digits only (the country code first), 7 to 15 of them. */
export const PHONE_DIGITS = /^[1-9]\d{6,14}$/;
const CODE_DIGITS = /^\d{3,8}$/;

/** auth.sendCode with plain delivery (no code setting flag). `phone` is digits only. */
export function sendCode({ phone, apiId, apiHash }) {
  if (!PHONE_DIGITS.test(String(phone))) throw mtError("invalid_request", "a number is 7 to 15 digits");
  if (!Number.isInteger(apiId) || apiId <= 0 || typeof apiHash !== "string" || !apiHash) throw mtError("invalid_request", "api_id and api_hash are needed");
  return new Writer().int(PHONE_METHOD.sendCode).string(phone).int(apiId).string(apiHash).int(CODE_SETTINGS).int(0).done();
}

/** auth.signIn with the code (flag 0), never an email verification. */
export function signIn({ phone, hash, code }) {
  if (!PHONE_DIGITS.test(String(phone))) throw mtError("invalid_request", "a number is 7 to 15 digits");
  if (typeof hash !== "string" || !hash) throw mtError("invalid_request", "the code hash is needed");
  if (!CODE_DIGITS.test(String(code))) throw mtError("invalid_request", "a code is digits only");
  return new Writer().int(PHONE_METHOD.signIn).int(1).string(phone).string(hash).string(String(code)).done();
}

/**
 * auth.SentCode: { kind: "code", hash, via: "app" | "sms" | "call" | "other" }, or { kind: "authorization", body } (the
 * answer already signed in: body is the auth.Authorization). A code sent by email (or one asking to set up an email)
 * throws `email_required`; an answer this layer does not know throws `protocol`.
 */
export function parseSentCode(u8) {
  const r = new Reader(u8);
  const ctor = r.int();
  if (ctor === SENT_CODE_SUCCESS) return { kind: "authorization", body: u8.subarray(4) };
  if (ctor !== SENT_CODE) throw mtError("protocol", "unexpected answer to auth.sendCode");
  r.int(); // flags (next_type and timeout come after the hash: not read)
  const type = r.int();
  let via;
  switch (type) {
    case 0x3dbb5986: r.int(); via = "app"; break;
    case 0xc000bba2: r.int(); via = "sms"; break;
    case 0x5353e5a7: r.int(); via = "call"; break;
    case 0xab03c6d9: r.string(); via = "call"; break;
    case 0x82006484: r.string(); r.int(); via = "call"; break;
    case 0xd9565c39: r.string(); r.int(); via = "other"; break;
    case 0x009fd736: {
      const f = r.int();
      if (f & 1) r.bytes();
      if (f & 4) { r.long(); r.bytes(); }
      if (f & 2) { r.string(); r.int(); }
      r.int();
      via = "sms";
      break;
    }
    case 0xa416ac81:
    case 0xb37794af: { const f = r.int(); if (f & 1) r.string(); via = "sms"; break; }
    case 0xf450f59b:
    case 0xa5491dea:
      throw mtError("email_required", "Telegram sends this account's code by email");
    default:
      throw mtError("protocol", "unknown code type 0x" + (type >>> 0).toString(16));
  }
  return { kind: "code", hash: r.string(), via };
}
