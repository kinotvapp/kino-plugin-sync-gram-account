// The 2FA password check (SRP, "Two-factor authentication" in Telegram's docs) for the one algorithm Telegram uses,
// passwordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow:
//   SH(data, salt) = H(salt | data | salt)            H = SHA-256
//   PH1 = SH(SH(password, salt1), salt2)
//   PH2 = SH(pbkdf2(sha512, PH1, salt1, 100000), salt2)        x = PH2 as a big number
//   k = H(p | g)   v = g^x   A = g^a   u = H(A | B)   t = (B - k v) mod p   S = t^(a + u x)   K = H(S)
//   M1 = H(H(p) xor H(g) | H(salt1) | H(salt2) | A | B | K)
// Numbers are hashed as 256 big-endian bytes. Powers go to kino.crypto.modPow (native); PBKDF2 to kino.crypto.pbkdf2.
// The server's p and g pass the same checks as the DH exchange's (2048-bit safe prime, g generating the right subgroup),
// and B, A and t the range checks of the docs. The password is only an argument here: never kept, never logged.
import { toHex, fromHex, xor, random, bigFromBytes, bigToBytes, utf8 } from "./bytes.js";
import { sha256, modPowHex } from "./crypto.js";
import { checkDhPrime } from "./authkey.js";
import { mtError } from "./errors.js";

export const SRP_ALGO = "passwordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow";
const SIZE = 256;
const protocol = (m) => mtError("protocol", m);
const evenHex = (n) => { const h = n.toString(16); return h.length % 2 ? "0" + h : h; };
const pow = (b, e, m) => BigInt("0x" + modPowHex(evenHex(b), evenHex(e), evenHex(m)));
const pad = (n) => bigToBytes(n, SIZE);
const bits = (n) => (n === 0n ? 0 : n.toString(2).length);

/** The docs' range check for g^a and g^b style values: 2^(2048-64) <= x <= p - 2^(2048-64). */
function goodModExp(x, p) {
  const diff = p - x;
  return diff > 0n && bits(diff) >= 2048 - 64 && bits(x) >= 2048 - 64 && Math.ceil(bits(x) / 8) <= SIZE;
}

/** PH2(password): the password's hash for the verifier, from the algorithm's two salts. */
export function passwordHash(password, salt1, salt2) {
  const sh = (data, salt) => sha256(salt, data, salt);
  const ph1 = sh(sh(utf8(password), salt1), salt2);
  const k = kino.crypto.pbkdf2("sha512", toHex(ph1), toHex(salt1), 100000, 64, { keyEncoding: "hex", inputEncoding: "hex", outputEncoding: "hex" });
  return sh(fromHex(k), salt2);
}

/**
 * The InputCheckPasswordSRP for `password` against account.getPassword's answer: `{ algo: { _, salt1, salt2, g, p },
 * srpB, srpId }` (bytes as Uint8Array) -> `{ srpId, A, M1 }`. `aBytes` (256 bytes) is for the test vector only; in use
 * `a` is random. Throws `protocol` when the server's numbers fail a check (nothing is sent then).
 */
export function srpCheck({ algo, srpB, srpId }, password, { aBytes } = {}) {
  if (!algo || algo._ !== SRP_ALGO) throw mtError("invalid_request", "unsupported 2FA password algorithm");
  if (typeof password !== "string" || !password) throw mtError("invalid_request", "the password is empty");
  if (!(algo.p instanceof Uint8Array) || algo.p.length !== SIZE) throw protocol("2FA p is not 2048 bits");
  if (!(srpB instanceof Uint8Array) || srpB.length === 0 || srpB.length > SIZE) throw protocol("2FA srp_B has a bad length");
  const p = bigFromBytes(algo.p);
  const g = Number(algo.g);
  checkDhPrime(p, g); // a 2048-bit safe prime with a good g, as for the auth key
  const B = bigFromBytes(srpB);
  if (!(B > 1n && B < p - 1n)) throw protocol("2FA srp_B out of range");
  const x = bigFromBytes(passwordHash(password, algo.salt1, algo.salt2));
  const pBytes = pad(p), gBytes = pad(BigInt(g)), bBytes = pad(B);
  const k = bigFromBytes(sha256(pBytes, gBytes));
  const v = pow(BigInt(g), x, p);
  const t = (((B - ((k * v) % p)) % p) + p) % p;
  if (!goodModExp(t, p)) throw protocol("2FA srp_B is not a good value");
  let a, A, u;
  for (let tries = 0; ; tries++) {
    if (tries >= 8) throw protocol("2FA: no good random value");
    a = bigFromBytes(aBytes && tries === 0 ? aBytes : random(SIZE));
    A = pow(BigInt(g), a, p);
    if (!goodModExp(A, p)) { if (aBytes) throw protocol("2FA: the given a is not good"); continue; }
    u = bigFromBytes(sha256(pad(A), bBytes));
    if (u > 0n) break;
  }
  const S = pow(t, a + u * x, p);
  const K = sha256(pad(S));
  const M1 = sha256(xor(sha256(pBytes), sha256(gBytes)), sha256(algo.salt1), sha256(algo.salt2), pad(A), bBytes, K);
  return { srpId, A: pad(A), M1 };
}

