// The kino.crypto calls MTProto needs, with hex on both sides (hex can be sliced and joined at any byte, base64 only
// at multiples of 3). Every primitive runs natively in the app: hashes, AES-IGE, AES-CTR, modPow and gunzip.
import { toHex, fromHex, concat } from "./bytes.js";

const HEX = { inputEncoding: "hex", outputEncoding: "hex" };

export const sha1Hex = (hex) => kino.crypto.hash("sha1", hex, HEX);
export const sha256Hex = (hex) => kino.crypto.hash("sha256", hex, HEX);
export const sha1 = (...parts) => fromHex(sha1Hex(toHex(concat(parts))));
export const sha256 = (...parts) => fromHex(sha256Hex(toHex(concat(parts))));

/** AES-256-IGE over hex. */
export const igeEncryptHex = (dataHex, keyHex, ivHex) =>
  kino.crypto.aesIge("encrypt", keyHex, ivHex, dataHex, { keyEncoding: "hex", ivEncoding: "hex", ...HEX });
export const igeDecryptHex = (dataHex, keyHex, ivHex) =>
  kino.crypto.aesIge("decrypt", keyHex, ivHex, dataHex, { keyEncoding: "hex", ivEncoding: "hex", ...HEX });
export const igeEncrypt = (data, key, iv) => fromHex(igeEncryptHex(toHex(data), toHex(key), toHex(iv)));
export const igeDecrypt = (data, key, iv) => fromHex(igeDecryptHex(toHex(data), toHex(key), toHex(iv)));

/** One-shot AES-256-CTR over hex, counter block = `ivHex` (CTR encryption and decryption are the same operation). */
export const ctrHex = (dataHex, keyHex, ivHex) =>
  kino.crypto.encrypt("aes-256-ctr", { key: keyHex, iv: ivHex, data: dataHex, keyEncoding: "hex", ivEncoding: "hex", ...HEX });

/** base^exp mod mod over big-endian hex; the answer is padded to the modulus' byte width. */
export const modPowHex = (baseHex, expHex, modHex) => kino.crypto.modPow(baseHex, expHex, modHex);

export const gunzipHex = (hex) => kino.crypto.gunzip(hex, HEX);
