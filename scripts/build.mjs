#!/usr/bin/env node
// Kino loads exactly one JavaScript file (docs/plugins/README.md, "What a plugin is"), so the ES modules under src/ are
// bundled into one. A tiny bundler, enough for this code base: it follows relative `import { a, b as c } from "./x.js"`
// statements from the entry, wraps every dependency in a function scope that returns its exports, and rewrites each
// import into `const { a, b: c } = __mod_x;`. The entry module keeps its own `export`s, so the result is one ES module.
// Not supported (refused): default exports, `export * from`, `import *`, side-effect-only imports, bare specifiers.
//
//   node scripts/build.mjs [entry] [out]     default: src/mtproto/index.js -> dist/mtproto.js
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*["'](\.{1,2}\/[^"']+)["'];?[ \t]*$/gm;

const modName = (file) => "__mod_" + relative(root, file).replace(/\.js$/, "").replace(/[^A-Za-z0-9]/g, "_");

function rewriteImports(source, file, deps) {
  if (/^\s*import\s+(?!\{)/m.test(source.replace(IMPORT_RE, ""))) throw new Error(relative(root, file) + ": only `import { ... } from \"./x.js\"` is supported");
  return source.replace(IMPORT_RE, (_, names, spec) => {
    const target = resolve(dirname(file), spec);
    deps.push(target);
    const list = names.split(",").map((s) => s.trim()).filter(Boolean).map((n) => {
      const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(n);
      if (!m) throw new Error(relative(root, file) + ": cannot read import " + n);
      return m[2] ? m[1] + ": " + m[2] : m[1];
    });
    return "const { " + list.join(", ") + " } = " + modName(target) + ";";
  });
}

/** A dependency's body without `export` keywords, and the names it exported. */
function stripExports(source, file) {
  const names = [];
  let out = source.replace(/^export\s+(async\s+function\*?|function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => { names.push(name); return kind + " " + name; });
  out = out.replace(/^export\s*\{([^}]*)\};?/gm, (_, list) => {
    for (const part of list.split(",").map((s) => s.trim()).filter(Boolean)) {
      const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
      if (!m) throw new Error(relative(root, file) + ": cannot read export " + part);
      names.push(m[2] ? m[2] + ": " + m[1] : m[1]);
    }
    return "";
  });
  if (/^\s*export\b/m.test(out)) throw new Error(relative(root, file) + ": an export form the bundler does not know");
  return { body: out, names };
}

export function bundle(entry = resolve(root, "src/mtproto/index.js")) {
  const order = [];
  const seen = new Map();
  const visit = (file, stack) => {
    if (stack.includes(file)) throw new Error("import cycle: " + [...stack, file].map((f) => relative(root, f)).join(" -> "));
    if (seen.has(file)) return;
    const deps = [];
    const source = rewriteImports(readFileSync(file, "utf8"), file, deps);
    for (const d of deps) visit(d, [...stack, file]);
    seen.set(file, source);
    order.push(file);
  };
  visit(resolve(entry), []);
  const parts = ["// Built by scripts/build.mjs from " + relative(root, resolve(entry)) + " -- do not edit; edit src/ and rebuild.\n"];
  for (const file of order.slice(0, -1)) {
    const { body, names } = stripExports(seen.get(file), file);
    parts.push("// ---- " + relative(root, file) + " ----\nconst " + modName(file) + " = (() => {\n" + body.trimEnd() + "\nreturn { " + names.join(", ") + " };\n})();\n");
  }
  parts.push("// ---- " + relative(root, order[order.length - 1]) + " (entry) ----\n" + seen.get(order[order.length - 1]));
  return parts.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entry = resolve(process.argv[2] || resolve(root, "src/mtproto/index.js"));
  const out = resolve(process.argv[3] || resolve(root, "dist/mtproto.js"));
  const text = bundle(entry);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log("wrote " + relative(process.cwd(), out) + " (" + text.length + " bytes)");
}
