// "Creating an authorization key" (MTProto 2.0), exactly as the verified-live spike (mtproto.mjs createAuthKey):
// req_pq_multi, pq factorisation, p_q_inner_data_dc under RSA_PAD, server_DH_params_ok, the safety checks on dh_prime,
// g, g_a and g_b, set_client_DH_params and the new_nonce_hash1 check. Big-number powers go to kino.crypto.modPow
// (native); BigInt is only used for comparisons, the pq factorisation (~63 bits) and Miller-Rabin's bookkeeping.
import { toHex, fromHex, concat, equal, xor, reversed, random, bigFromBytes, bigToBytes, bigToHex } from "./bytes.js";
import { sha1, sha256, igeEncrypt, igeDecrypt, modPowHex } from "./crypto.js";
import { Writer, Reader, CTOR, reqPqMulti, pqInnerDataDc, reqDHParams, clientDHInnerData, setClientDHParams } from "./tl.js";
import { MsgIds } from "./msgid.js";
import { mtError, fromTransportError } from "./errors.js";

/** Telegram's fixed 2048-bit DH prime (a safe prime; g = 3 works with it). Seeing it skips the primality rounds. */
export const TELEGRAM_DH_PRIME_HEX =
  "c71caeb9c6b1c9048e6c522f70f13f73980d40238e3e21c14934d037563d930f48198a0aa7c14058229493d22530f4dbfa336f6e0ac925139543aed44cce7c3720fd51f69458705ac68cd4fe6b6b13abdc9746512969328454f18faf8c595f642477fe96bb2a941d5bcd1d4ac8cc49880708fa9b378e3c4f3a9060bee67cf9a4a4a695811051907e162753b56b0f6b410dba74d8a84b2a14b3144e0ef1284754fd17ed950d5965b4b9dd46582db1178d169c6bc465b0d6ff9ca3928fef5b9ae4e418fc15e83ebea0f87fa9ff5eed70050ded2849f47bf959d956850ce929851f0d8115f635b105ee2e4e15d04b2454bf6f4fadf034b10403119cd8e3b92fcc5b";
const TELEGRAM_DH_PRIME = BigInt("0x" + TELEGRAM_DH_PRIME_HEX);

const protocol = (m) => mtError("protocol", m);
const evenHex = (n) => { const h = n.toString(16); return h.length % 2 ? "0" + h : h; };
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

/** Brent's variant of Pollard's rho with batched gcds: pq < 2^64 factors in a few thousand BigInt steps. */
export function factorPq(pq) {
  // Telegram's pq is a product of two primes below 2^32 (so below 2^64): anything else is not a server of ours.
  if (typeof pq !== "bigint" || pq < 4n || pq >= 1n << 64n) throw protocol("pq out of range");
  if (pq % 2n === 0n) return [2n, pq / 2n];
  let steps = 0;
  for (let c = 1n; c < 64n; c++) {
    const f = (v) => (v * v + c) % pq;
    let y = 2n, x = 2n, ys = 2n, q = 1n, g = 1n, r = 1;
    const m = 128;
    while (g === 1n) {
      x = y;
      for (let i = 0; i < r; i++) y = f(y);
      for (let k = 0; k < r && g === 1n; k += m) {
        ys = y;
        const lim = Math.min(m, r - k);
        for (let i = 0; i < lim; i++) { y = f(y); q = (q * (x > y ? x - y : y - x)) % pq; }
        g = gcd(q, pq);
        steps += lim;
      }
      r *= 2;
      // A semiprime below 2^64 falls in well under 2^20 steps; past it the input is not one (bounded CPU either way).
      if (steps > 1 << 22) throw protocol("could not factor pq");
    }
    if (g === pq) {
      do { ys = f(ys); g = gcd(x > ys ? x - ys : ys - x, pq); } while (g === 1n);
    }
    if (g !== pq) { const a = g, b = pq / g; return a < b ? [a, b] : [b, a]; }
  }
  throw protocol("could not factor pq");
}

/** Telegram's RSA key fingerprint: the low 64 bits of sha1(TL bytes(n) + TL bytes(e)), as a signed decimal string. */
export function rsaFingerprint(nHex, e) {
  const w = new Writer().bytes(fromHex(evenHex(BigInt("0x" + nHex)))).bytes(fromHex(evenHex(BigInt(e)))).done();
  return new Reader(sha1(w), 12).long().toString();
}

const SMALL_PRIMES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];

/** Miller-Rabin with random bases; each base costs one native kino.crypto.modPow. */
export function isProbablePrime(n, rounds = 16) {
  if (n < 2n) return false;
  for (const p of SMALL_PRIMES) { if (n === p) return true; if (n % p === 0n) return false; }
  let d = n - 1n, s = 0;
  while ((d & 1n) === 0n) { d >>= 1n; s++; }
  const nHex = evenHex(n), dHex = evenHex(d), byteLen = Math.ceil(n.toString(16).length / 2) + 8;
  outer: for (let i = 0; i < rounds; i++) {
    const a = (bigFromBytes(random(byteLen)) % (n - 3n)) + 2n;
    let x = BigInt("0x" + modPowHex(evenHex(a), dHex, nHex));
    if (x === 1n || x === n - 1n) continue;
    for (let j = 1; j < s; j++) { x = (x * x) % n; if (x === n - 1n) continue outer; }
    return false;
  }
  return true;
}

/** The protocol's checks on (dh_prime, g). Telegram's fixed prime is recognised instead of tested ({ known: true }). */
export function checkDhPrime(p, g) {
  if (p.toString(2).length !== 2048) throw protocol("dh_prime is not 2048 bits");
  if (!(g >= 2 && g <= 7)) throw protocol("unexpected g " + g);
  const ok = {
    2: () => p % 8n === 7n,
    3: () => p % 3n === 2n,
    4: () => true,
    5: () => [1n, 4n].includes(p % 5n),
    6: () => [19n, 23n].includes(p % 24n),
    7: () => [3n, 5n, 6n].includes(p % 7n),
  }[g]();
  if (!ok) throw protocol("g = " + g + " does not generate the right subgroup of this dh_prime");
  if (p === TELEGRAM_DH_PRIME) return { known: true };
  if (!isProbablePrime(p) || !isProbablePrime((p - 1n) / 2n)) throw protocol("dh_prime is not a safe prime");
  return { known: false };
}

/** One unencrypted request (auth_key_id = 0) and its answer, as a Reader on the answer's body. */
export async function plainCall(t, body, { msgIds, timeoutMs, deadline, now = () => Date.now() }) {
  const w = new Writer().long(0n).long(msgIds.next()).int(body.length).raw(body).done();
  await t.sendHex(toHex(w));
  // With a deadline (the whole key exchange's), each answer waits only for what is left of it.
  const wait = deadline === undefined ? timeoutMs : deadline - now();
  if (wait < 1) throw mtError("timeout", "the key exchange ran out of time", { deadline: true });
  const raw = fromHex(await t.recvHex(wait));
  if (raw.length === 4) throw fromTransportError(new Reader(raw).int32());
  const r = new Reader(raw);
  if (r.long() !== 0n) throw protocol("expected an unencrypted answer");
  r.long();
  const len = r.int();
  return new Reader(r.raw(len));
}

const LIMIT = 1n << (2048n - 64n);
const inRange = (v, p) => v > 1n && v < p - 1n && v > LIMIT && v < p - LIMIT;

/**
 * A new auth key on transport `t` (opened on DC `dc`). `publicKeys` is { signedDecimalFingerprint: { n: hex, e: decimal } }.
 * Answers { authKey (256 bytes), authKeyId (8 bytes), serverSalt (8 bytes), timeOffset (s) }. `rand(n)` is the
 * randomness source (kino.crypto by default; tests inject a broken one to reach the g_b check).
 */
export async function createAuthKey(t, { dc, publicKeys, now = () => Date.now(), timeoutMs = 20000, rand = random }) {
  const msgIds = new MsgIds(now);
  // One deadline for the whole exchange (three round trips), not timeoutMs for each.
  const opts = { msgIds, timeoutMs, deadline: now() + timeoutMs, now };
  const nonce = rand(16);
  let r = await plainCall(t, reqPqMulti(nonce), opts);
  if (r.int() !== CTOR.resPQ) throw protocol("expected resPQ");
  if (!equal(r.int128(), nonce)) throw protocol("nonce mismatch");
  const serverNonce = r.int128().slice();
  const pq = bigFromBytes(r.bytes());
  const fps = r.vectorLong().map((f) => f.toString());
  const fp = fps.find((f) => Object.prototype.hasOwnProperty.call(publicKeys, f));
  if (!fp) throw protocol("no known server key among " + fps.join(", "));
  const [p, q] = factorPq(pq);
  const newNonce = rand(32);
  const inner = pqInnerDataDc({ pq: bigToBytes(pq), p: bigToBytes(p), q: bigToBytes(q), nonce, serverNonce, newNonce, dc });
  if (inner.length > 144) throw protocol("inner data too long");

  // RSA_PAD (the plain "sha1 + data" form is refused with -404 since 2021).
  const key = publicKeys[fp];
  const n = BigInt("0x" + key.n), nHex = evenHex(n), eHex = evenHex(BigInt(key.e));
  let encrypted;
  for (let attempt = 0; attempt < 32 && !encrypted; attempt++) {
    const withPad = concat(inner, rand(192 - inner.length));
    const tempKey = rand(32);
    const dataWithHash = concat(reversed(withPad), sha256(tempKey, withPad));
    const aesEnc = igeEncrypt(dataWithHash, tempKey, new Uint8Array(32));
    const keyAesEnc = concat(xor(tempKey, sha256(aesEnc)), aesEnc);
    if (bigFromBytes(keyAesEnc) >= n) continue;
    // The app's modPow pads its answer to the modulus' width (PluginCrypto.modPow); pad here too, never truncate.
    encrypted = bigToBytes(BigInt("0x" + modPowHex(toHex(keyAesEnc), eHex, nHex)), 256);
  }
  if (!encrypted) throw protocol("RSA_PAD found no value below the modulus");

  r = await plainCall(t, reqDHParams({ nonce, serverNonce, p: bigToBytes(p), q: bigToBytes(q), fingerprint: BigInt(fp), encryptedData: encrypted }), opts);
  const ctor = r.int();
  if (ctor === CTOR.serverDHParamsFail) throw protocol("server_DH_params_fail");
  if (ctor !== CTOR.serverDHParamsOk) throw protocol("unexpected answer to req_DH_params: 0x" + ctor.toString(16));
  if (!equal(r.int128(), nonce) || !equal(r.int128(), serverNonce)) throw protocol("nonce mismatch in server_DH_params");
  const answerEnc = r.bytes();
  const a1 = sha1(newNonce, serverNonce), a2 = sha1(serverNonce, newNonce);
  const tmpKey = concat(a1, a2.subarray(0, 12));
  const tmpIv = concat(a2.subarray(12), sha1(newNonce, newNonce), newNonce.subarray(0, 4));
  const answerFull = igeDecrypt(answerEnc, tmpKey, tmpIv);
  const answer = answerFull.subarray(20);
  const d = new Reader(answer);
  if (d.int() !== CTOR.serverDHInnerData) throw protocol("bad server_DH_inner_data");
  if (!equal(d.int128(), nonce) || !equal(d.int128(), serverNonce)) throw protocol("nonce mismatch in inner data");
  const g = d.int();
  const dhPrimeBytes = d.bytes(), gABytes = d.bytes();
  const serverTime = d.int();
  if (!equal(sha1(answer.subarray(0, d.o)), answerFull.subarray(0, 20))) throw protocol("answer hash mismatch");
  const dhPrime = bigFromBytes(dhPrimeBytes), gA = bigFromBytes(gABytes);
  checkDhPrime(dhPrime, g);
  if (!inRange(gA, dhPrime)) throw protocol("g_a out of range");
  const timeOffset = serverTime - Math.floor(now() / 1000);

  const primeHex = bigToHex(dhPrime, 256);
  let b, gB;
  for (let attempt = 0; ; attempt++) {
    if (attempt === 8) throw protocol("g_b out of range");
    b = rand(256);
    gB = bigFromBytes(fromHex(modPowHex(evenHex(BigInt(g)), toHex(b), primeHex)));
    if (inRange(gB, dhPrime)) break;
  }
  const cInner = clientDHInnerData({ nonce, serverNonce, retryId: 0n, gB: bigToBytes(gB) });
  const withHash = concat(sha1(cInner), cInner);
  const cPadded = concat(withHash, rand((16 - (withHash.length % 16)) % 16));
  r = await plainCall(t, setClientDHParams({ nonce, serverNonce, encryptedData: igeEncrypt(cPadded, tmpKey, tmpIv) }), opts);
  const res = r.int();
  if (res !== CTOR.dhGenOk) throw protocol(res === CTOR.dhGenRetry ? "dh_gen_retry" : res === CTOR.dhGenFail ? "dh_gen_fail" : "unexpected answer to set_client_DH_params");
  if (!equal(r.int128(), nonce) || !equal(r.int128(), serverNonce)) throw protocol("nonce mismatch in dh_gen_ok");
  const newNonceHash1 = r.int128();
  const authKey = bigToBytes(BigInt("0x" + modPowHex(toHex(gABytes), toHex(b), primeHex)), 256);
  const authHash = sha1(authKey);
  if (!equal(sha1(newNonce, Uint8Array.of(1), authHash.subarray(0, 8)).subarray(4, 20), newNonceHash1)) throw protocol("new_nonce_hash1 mismatch");
  return {
    authKey,
    authKeyId: authHash.slice(12, 20),
    serverSalt: xor(newNonce.subarray(0, 8), serverNonce.subarray(0, 8)),
    timeOffset,
  };
}
