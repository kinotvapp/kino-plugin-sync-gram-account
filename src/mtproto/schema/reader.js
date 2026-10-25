// A schema-driven TL reader: it interprets the constructor table that scripts/gen-schema.mjs extracts from the layer-198
// schema (generated.js) and turns a server answer into plain objects: { _: "channel", id: 123n, access_hash: -5n, ... }.
// Field names are TL's own; int is a number, long a BigInt, double a number, int128/int256/bytes a Uint8Array (a view
// into the answer, no copy), string a string, Bool a boolean, a `true` flag field is `true` when its bit is set and
// absent otherwise, flags fields keep their numeric value.
//
// TL has no lengths: an unknown constructor id cannot be skipped, so it stops the read with a typed `protocol` error
// naming the id (`e.ctor`); so does a constructor of the wrong type, a bad Bool, a truncated answer or trailing bytes.
// Nothing is ever guessed.
//
// The table is parsed lazily: one split of the string at the first decode, each constructor's params on first use.
import { Reader, CTOR } from "../tl.js";
import { toHex, fromHex } from "../bytes.js";
import { gunzipHex } from "../crypto.js";
import { mtError, fromRpcError } from "../errors.js";
import { SCHEMA_LAYER, SCHEMA_TYPES, SCHEMA_CTORS } from "./generated.js";

const K_FLAGS = 1, K_INT = 2, K_LONG = 3, K_DOUBLE = 4, K_INT128 = 5, K_INT256 = 6, K_STRING = 7, K_BYTES = 8, K_BOOL = 9, K_TRUE = 10,
  K_OBJ = 11, K_VECTOR = 12, K_BARE_VECTOR = 13, K_BARE = 14;
const SIMPLE = { "#": K_FLAGS, i: K_INT, l: K_LONG, d: K_DOUBLE, q: K_INT128, Q: K_INT256, s: K_STRING, b: K_BYTES, B: K_BOOL, t: K_TRUE };
const MAX_DEPTH = 64; // nested objects per answer; real layer-198 answers stay far below
const hex8 = (id) => "0x" + (id >>> 0).toString(16).padStart(8, "0");
const protocol = (message, extra) => mtError("protocol", message, extra);

function parseCode(s) {
  const k = SIMPLE[s];
  if (k) return { k };
  const c = s.charCodeAt(0);
  if (c >= 48 && c <= 57) return { k: K_OBJ, t: Number(s) };
  if (s[0] === "V") return { k: K_VECTOR, of: parseCode(s.slice(1)) };
  if (s[0] === "v") return { k: K_BARE_VECTOR, of: parseCode(s.slice(1)) };
  if (s[0] === "%") return { k: K_BARE, name: s.slice(1) };
  throw new Error("bad schema type code " + s);
}

function compileLine(line) {
  const parts = line.split(" ");
  const params = [];
  for (let i = 3; i < parts.length; i++) {
    const p = parts[i];
    const colon = p.indexOf(":");
    const name = p.slice(0, colon);
    let code = p.slice(colon + 1);
    let flagField = null, bit = 0;
    const q = code.indexOf("?");
    if (q > 0) {
      const dot = code.indexOf(".");
      flagField = code.slice(0, dot);
      bit = Number(code.slice(dot + 1, q));
      code = code.slice(q + 1);
    }
    params.push({ name, flagField, bit, type: parseCode(code) });
  }
  return { id: parseInt(parts[0], 16) >>> 0, name: parts[1], type: Number(parts[2]), params };
}

/** A decoder over a schema `{ types: [typeName], ctors: "id name typeIndex params...\n..." }` (generated.js format). */
export function createDecoder({ types, ctors, layer = null }) {
  let byId = null;   // id -> line (string) until compiled, then the compiled constructor
  let byName = null; // name -> compiled constructor (for bare types; built on first need)
  const typeIndex = new Map(types.map((t, i) => [t, i]));
  let depth = 0; // objects open right now (decode resets it), so a hostile answer cannot nest without bound
  const enter = () => { if (++depth > MAX_DEPTH) throw protocol("TL answer nested too deep (over " + MAX_DEPTH + " objects)"); };

  const index = () => {
    if (byId) return byId;
    byId = new Map();
    for (const line of ctors.split("\n")) {
      if (line) byId.set(parseInt(line.slice(0, line.indexOf(" ")), 16) >>> 0, line);
    }
    return byId;
  };
  const ctorById = (id) => {
    const m = index();
    const v = m.get(id);
    if (typeof v !== "string") return v;
    const c = compileLine(v);
    m.set(id, c);
    return c;
  };
  const ctorByName = (name) => {
    if (!byName) {
      byName = new Map();
      for (const id of index().keys()) { const c = ctorById(id); byName.set(c.name, c); }
    }
    const c = byName.get(name);
    if (!c) throw protocol("bare type " + name + " is not in the schema");
    return c;
  };

  function readBoxed(r, expected, skip) {
    const id = r.int();
    const c = ctorById(id);
    if (!c) {
      throw protocol("unknown TL constructor " + hex8(id) + (expected >= 0 ? " where a " + types[expected] + " belongs" : "") + " at byte " + (r.o - 4), { ctor: id });
    }
    if (expected >= 0 && c.type !== expected) {
      throw protocol("TL constructor " + c.name + " (" + hex8(id) + ", a " + types[c.type] + ") where a " + types[expected] + " belongs", { ctor: id });
    }
    if (skip && skip(c.name, types[c.type])) {
      walkBody(r, c);
      return { _: c.name, skipped: true };
    }
    return readBody(r, c, skip);
  }

  function readBody(r, c, skip) {
    enter();
    const o = { _: c.name };
    const ps = c.params;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.flagField !== null && ((o[p.flagField] >>> p.bit) & 1) === 0) continue;
      if (p.type.k === K_TRUE) { o[p.name] = true; continue; }
      o[p.name] = readValue(r, p.type, skip);
    }
    depth--;
    return o;
  }

  function readValue(r, t, skip) {
    switch (t.k) {
      case K_FLAGS: return r.int();
      case K_INT: return r.int32();
      case K_LONG: return r.long();
      case K_DOUBLE: return r.double();
      case K_INT128: return r.raw(16);
      case K_INT256: return r.raw(32);
      case K_STRING: return r.string();
      case K_BYTES: return r.bytes();
      case K_BOOL: return readBool(r);
      case K_TRUE: return true;
      case K_OBJ: return readBoxed(r, t.t, skip);
      case K_BARE: return readBody(r, ctorByName(t.name), skip);
      case K_VECTOR:
      case K_BARE_VECTOR: {
        const n = vectorCount(r, t.k === K_VECTOR);
        const out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = readValue(r, t.of, skip);
        return out;
      }
      default: throw protocol("bad schema type");
    }
  }

  // The same walk without building anything (strings are not decoded, bytes not copied).
  function walkBoxed(r, expected) {
    const id = r.int();
    const c = ctorById(id);
    if (!c) throw protocol("unknown TL constructor " + hex8(id) + (expected >= 0 ? " where a " + types[expected] + " belongs" : "") + " at byte " + (r.o - 4), { ctor: id });
    if (expected >= 0 && c.type !== expected) throw protocol("TL constructor " + c.name + " (" + hex8(id) + ", a " + types[c.type] + ") where a " + types[expected] + " belongs", { ctor: id });
    walkBody(r, c);
  }
  function walkBody(r, c) {
    enter();
    const ps = c.params;
    let flags = null;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.flagField !== null && ((flags[p.flagField] >>> p.bit) & 1) === 0) continue;
      if (p.type.k === K_FLAGS) { (flags || (flags = {}))[p.name] = r.int(); continue; }
      walkValue(r, p.type);
    }
    depth--;
  }
  function walkValue(r, t) {
    switch (t.k) {
      case K_FLAGS: case K_INT: r.raw(4); return;
      case K_LONG: case K_DOUBLE: r.raw(8); return;
      case K_INT128: r.raw(16); return;
      case K_INT256: r.raw(32); return;
      case K_STRING: case K_BYTES: r.bytes(); return;
      case K_BOOL: readBool(r); return;
      case K_TRUE: return;
      case K_OBJ: walkBoxed(r, t.t); return;
      case K_BARE: walkBody(r, ctorByName(t.name)); return;
      case K_VECTOR: case K_BARE_VECTOR: {
        const n = vectorCount(r, t.k === K_VECTOR);
        const of = t.of;
        if (of.k === K_INT || of.k === K_FLAGS) { r.raw(4 * n); return; }
        if (of.k === K_LONG || of.k === K_DOUBLE) { r.raw(8 * n); return; }
        for (let i = 0; i < n; i++) walkValue(r, of);
        return;
      }
      default: throw protocol("bad schema type");
    }
  }

  function vectorCount(r, boxed) {
    if (boxed) {
      const id = r.int();
      if (id !== CTOR.vector) throw protocol("not a vector: " + hex8(id), { ctor: id });
    }
    const n = r.int32();
    if (n < 0 || n * 4 > r.b.length - r.o) throw protocol("bad vector length " + n);
    return n;
  }

  /**
   * Decodes one boxed object filling all of `u8`. Options: `expect` a type name the top-level object must belong to;
   * `skip(name, typeName)` true for a constructor that should be walked but not built (answers { _, skipped: true }).
   * A top-level gzip_packed is unpacked (natively); a top-level rpc_error answers { _: "rpc_error", error_code, error_message },
   * or is thrown as its typed error (errors.js) when `expect` is given. More than 64 nested objects is `protocol`.
   */
  function decode(u8, { expect, skip } = {}) {
    depth = 0;
    let r = new Reader(u8);
    let head = r.peekInt();
    if (head === CTOR.gzipPacked) {
      r.int();
      r = new Reader(fromHex(gunzipHex(toHex(r.bytes()))));
      head = r.peekInt();
    }
    let out;
    if (head === CTOR.rpcError) {
      r.int();
      out = { _: "rpc_error", error_code: r.int32(), error_message: r.string() };
      if (expect !== undefined) throw fromRpcError({ code: out.error_code, message: out.error_message });
    } else {
      let expected = -1;
      if (expect !== undefined) {
        expected = typeIndex.has(expect) ? typeIndex.get(expect) : -2;
        if (expected === -2) throw protocol("type " + expect + " is not in the schema");
      }
      out = readBoxed(r, expected, skip || null);
    }
    if (!r.atEnd()) throw protocol("trailing bytes after " + out._ + " (" + (r.b.length - r.o) + ")");
    return out;
  }

  return {
    decode,
    has: (id) => index().has(id >>> 0),
    stats: () => ({ layer, constructors: index().size, types: types.length, typeNames: types.slice(), has: (id) => index().has(id >>> 0), bytes: ctors.length }),
  };
}

let api = null;
const apiDecoder = () => api || (api = createDecoder({ types: SCHEMA_TYPES, ctors: SCHEMA_CTORS, layer: SCHEMA_LAYER }));

/** Decodes an answer with the layer-198 API schema (see createDecoder's decode for the options). */
export const decode = (u8, opts) => apiDecoder().decode(u8, opts);
export const schemaStats = () => apiDecoder().stats();

function readBool(r) {
  const c = r.int();
  if (c === CTOR.boolTrue) return true;
  if (c === CTOR.boolFalse) return false;
  throw protocol("not a Bool: " + hex8(c), { ctor: c });
}
