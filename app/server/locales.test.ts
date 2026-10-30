// Every language has exactly the keys of en.json, with the same
// {{placeholders}}, and every literal t("...") key used in the UI exists.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { APP_ROOT } from "./store.ts";

const LOCALES = path.join(APP_ROOT, "src", "locales");
type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}

const load = (lang: string) => flatten(JSON.parse(fs.readFileSync(path.join(LOCALES, `${lang}.json`), "utf8")) as Tree);
const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");

const en = load("en");
const langs = fs.readdirSync(LOCALES).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));

test("all seven languages are present", () => {
  assert.deepEqual([...langs].sort(), ["ar", "de", "en", "es", "fr", "ka", "zh"]);
});

for (const lang of langs.filter((l) => l !== "en")) {
  test(`${lang}: same keys and placeholders as en`, () => {
    const other = load(lang);
    assert.deepEqual([...other.keys()].sort(), [...en.keys()].sort());
    for (const [k, v] of en) {
      assert.equal(placeholders(other.get(k)!), placeholders(v), `${lang}:${k}`);
      assert.ok(other.get(k)!.trim().length > 0, `${lang}:${k} is empty`);
    }
  });
}

test("every literal t() key used in the UI exists", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) files.push(p);
    }
  };
  walk(path.join(APP_ROOT, "src"));
  const missing: string[] = [];
  for (const f of files) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/\bt\(\s*"([\w.]+)"/g)) {
      if (!en.has(m[1])) missing.push(`${path.basename(f)}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
