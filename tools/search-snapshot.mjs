#!/usr/bin/env node
// Search regression snapshot.
// Runs script.js's real loadData() + search() in a Node VM against the local
// data files and prints what each query returns, so search behaviour can be
// diffed before/after a change.
//
// Usage: node tools/search-snapshot.mjs > before.json
//        node tools/search-snapshot.mjs > after.json && diff before.json after.json

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const QUERIES = [
  "tick pod", "tick", "arc alloy", "metal parts", "wires", "battery",
  "gunsmith", "gear bench", "medical lab", "explosives", "utility station",
  "refiner", "scrappy", "research station", "outpost",
  "avian alarm", "weather monitor", "flickering flames", "trophy display",
  "converging paths", "phantom targets", "ascending the mountain",
  "sheltered retreat", "expedition", "movie night", "doctor's orders",
  "grappling hook", "planks", "basic camera", "zipline", "skulker",
  "leviathan", "lemon", "apricot", "rusted", "stage 2", "tier 3",
  "tikc pod", "arc aloy", "zzzz",
];

const src = fs.readFileSync(path.join(root, "script.js"), "utf8")
  // don't boot the UI; we drive loadData/search ourselves
  .replace(/^main\(\);\s*$/m, "");

const ctx = {
  console,
  fetch: async (url) => {
    const file = path.join(root, String(url).split("?")[0]);
    const ok = fs.existsSync(file);
    const body = ok ? fs.readFileSync(file, "utf8") : "";
    return {
      ok,
      status: ok ? 200 : 404,
      text: async () => body,
      json: async () => JSON.parse(body),
    };
  },
  document: { getElementById: () => null, querySelector: () => null },
};
vm.createContext(ctx);
vm.runInContext(
  `${src}\n;globalThis.__api = { loadData, search, applyActiveFilter };`,
  ctx
);

await ctx.__api.loadData();
const out = {};
for (const q of QUERIES) {
  out[q] = ctx.__api.search(q).map((r) => {
    const uses = (r.UsageEntries || [])
      .map((u) => `${u.station}|${u.tier}|${u.quantity}`)
      .sort();
    return uses.length ? `${r.Name} :: ${uses.join(" ; ")}` : r.Name;
  });
}
console.log(JSON.stringify(out, null, 2));
