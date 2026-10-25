// Uint8Array helpers for a runtime without Buffer (Kino's QuickJS). kino.crypto takes and returns strings, so the hot
// conversions (hex and base64 of a 1 MiB chunk) are written as single passes over typed arrays: each output character
// is a table lookup into a Uint8Array of char codes, turned into a string 8192 characters at a time with
// String.fromCharCode.apply (native), never by appending one character at a time.

const HEX_CHARS = "0123456789abcdef";
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const STR_CHUNK = 8192; // characters per String.fromCharCode.apply call (a multiple of 4 and of 2)

const HEX_CODE = new Uint8Array(16);
for (let i = 0; i < 16; i++) HEX_CODE[i] = HEX_CHARS.charCodeAt(i);
const HEX_VALUE = new Int8Array(256).fill(-1);
for (let i = 0; i < 16; i++) {
  HEX_VALUE[HEX_CHARS.charCodeAt(i)] = i;
  HEX_VALUE[HEX_CHARS.toUpperCase().charCodeAt(i)] = i;
}
const B64_CODE = new Uint8Array(64);
for (let i = 0; i < 64; i++) B64_CODE[i] = B64_CHARS.charCodeAt(i);
const B64_VALUE = new Int8Array(256).fill(-1);
for (let i = 0; i < 64; i++) B64_VALUE[B64_CHARS.charCodeAt(i)] = i;
B64_VALUE[45] = 62; // '-' (base64url)
B64_VALUE[95] = 63; // '_'

/** Char codes (all < 128) to a string, in native chunks. */
function codesToString(codes, length) {
  const parts = [];
  for (let i = 0; i < length; i += STR_CHUNK) {
    parts.push(String.fromCharCode.apply(null, codes.subarray(i, Math.min(i + STR_CHUNK, length))));
  }
  return parts.length === 1 ? parts[0] : parts.join("");
}

export function toHex(u8) {
  const n = u8.length;
  const codes = new Uint8Array(n * 2);
  for (let i = 0, j = 0; i < n; i++, j += 2) {
    const b = u8[i];
    codes[j] = HEX_CODE[b >> 4];
    codes[j + 1] = HEX_CODE[b & 15];
  }
  return codesToString(codes, codes.length);
}

export function fromHex(hex) {
  const s = String(hex);
  if (s.length % 2 !== 0) throw new Error("invalid hex: odd length");
  const n = s.length >> 1;
  const out = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 2) {
    const hi = HEX_VALUE[s.charCodeAt(j) & 255], lo = HEX_VALUE[s.charCodeAt(j + 1) & 255];
    if (hi < 0 || lo < 0 || s.charCodeAt(j) > 255 || s.charCodeAt(j + 1) > 255) throw new Error("invalid hex character");
    out[i] = (hi << 4) | lo;
  }
  return out;
}

export function toBase64(u8) {
  const n = u8.length;
  const codes = new Uint8Array(((n + 2) / 3 | 0) * 4);
  let i = 0, j = 0;
  for (; i + 2 < n; i += 3, j += 4) {
    const v = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
    codes[j] = B64_CODE[v >> 18];
    codes[j + 1] = B64_CODE[(v >> 12) & 63];
    codes[j + 2] = B64_CODE[(v >> 6) & 63];
    codes[j + 3] = B64_CODE[v & 63];
  }
  if (i < n) {
    const two = i + 1 < n;
    const v = (u8[i] << 16) | (two ? u8[i + 1] << 8 : 0);
    codes[j] = B64_CODE[v >> 18];
    codes[j + 1] = B64_CODE[(v >> 12) & 63];
    codes[j + 2] = two ? B64_CODE[(v >> 6) & 63] : 61;
    codes[j + 3] = 61;
  }
  return codesToString(codes, codes.length);
}

export function fromBase64(b64) {
  const s = String(b64);
  let len = s.length;
  while (len > 0 && s.charCodeAt(len - 1) === 61) len--; // '='
  if (s.length - len > 2 || len % 4 === 1) throw new Error("invalid base64 length");
  const out = new Uint8Array((len * 3) >> 2);
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    const v = c < 256 ? B64_VALUE[c] : -1;
    if (v < 0) throw new Error("invalid base64 character");
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  return out;
}

/** Hex straight to base64 (the read() export answers base64; a downloaded chunk may arrive as hex). */
export function hexToBase64(hex) {
  return toBase64(fromHex(hex));
}

export function concat(...parts) {
  const list = parts.length === 1 && Array.isArray(parts[0]) ? parts[0] : parts;
  let n = 0;
  for (const p of list) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of list) { out.set(p, o); o += p.length; }
  return out;
}

export function equal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function xor(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

export function reversed(u8) {
  const out = new Uint8Array(u8.length);
  for (let i = 0, n = u8.length; i < n; i++) out[i] = u8[n - 1 - i];
  return out;
}

export function readU32LE(u8, o) {
  return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
}
export function readI32LE(u8, o) {
  return u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24);
}
export function writeU32LE(u8, o, v) {
  u8[o] = v & 255; u8[o + 1] = (v >>> 8) & 255; u8[o + 2] = (v >>> 16) & 255; u8[o + 3] = (v >>> 24) & 255;
}
export function readI64LE(u8, o) {
  const lo = BigInt(readU32LE(u8, o)), hi = BigInt(readU32LE(u8, o + 4));
  return BigInt.asIntN(64, (hi << 32n) | lo);
}
export function writeI64LE(u8, o, v) {
  const x = BigInt.asUintN(64, BigInt(v));
  writeU32LE(u8, o, Number(x & 0xffffffffn));
  writeU32LE(u8, o + 4, Number(x >> 32n));
}

/** Big-endian unsigned bytes to BigInt. */
export function bigFromBytes(u8) {
  return u8.length ? BigInt("0x" + toHex(u8)) : 0n;
}

/** BigInt to big-endian unsigned bytes, left-padded to `len` when given. */
export function bigToBytes(n, len) {
  if (n < 0n) throw new Error("negative BigInt");
  let h = n.toString(16);
  if (h.length % 2) h = "0" + h;
  if (n === 0n) h = len ? "" : "00";
  const raw = fromHex(h);
  if (!len) return raw;
  if (raw.length > len) throw new Error("BigInt does not fit in " + len + " bytes");
  const out = new Uint8Array(len);
  out.set(raw, len - raw.length);
  return out;
}

/** BigInt to fixed-width big-endian hex (kino.crypto.modPow speaks hex). */
export function bigToHex(n, len) {
  return toHex(bigToBytes(n, len));
}

/** `n` random bytes from kino.crypto (at most 1024 per call there). */
export function random(n) {
  const out = new Uint8Array(n);
  for (let o = 0; o < n; o += 1024) {
    const k = Math.min(1024, n - o);
    out.set(fromHex(kino.crypto.randomBytes(k, "hex")), o);
  }
  return out;
}

export const utf8 = (s) => new TextEncoder().encode(String(s));
export const fromUtf8 = (u8) => new TextDecoder().decode(u8);
