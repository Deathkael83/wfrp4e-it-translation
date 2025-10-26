// tools/merge-wfrp4e-core.mjs
// --------------------------------------------------------------
// WFRP4e CORE - TRANSLATION MERGER
// Merges many legacy compendium-translation JSONs into 4 files:
//   bestiary (actors), items, journals, tables
// Requires: tools/it-skeleton.json exported by the macro
// Input:    Compendium/*.json   (your old translation files)
// Output:   lang/it-wfrp4e-core-*.json
// --------------------------------------------------------------

import fs from "fs";
import path from "path";
import glob from "glob";

// --- CONFIG ---
const INPUT_DIR = "Compendium";            // old translation JSONs here
const OUTPUT_DIR = "lang";                 // merged files go here
const SKELETON = "tools/it-skeleton.json"; // exported from Foundry macro
const LOCALE = "it";
const TARGET_PACKAGE = "wfrp4e-core";      // final package for the 4 packs

// --- LEGACY → TARGET PACK MAP --------------------------------
// Keys can be either "<pack>" or "<package>.<pack>"
// Target values must be one of: "bestiary" | "items" | "journals" | "tables"
const PACK_MAP = {
  // Bestiary (ends up in TARGET_PACKAGE.actors → "bestiary")
  "bestiary": "bestiary",
  "wfrp4e-core.bestiary": "bestiary",

  // Items (we group everything that is an Item-type concept)
  "items": "items",
  "talents": "items",
  "traits": "items",
  "spells": "items",
  "prayers": "items",
  "mutations": "items",
  "trappings": "items",
  "skills": "items",          // old pack sometimes separated skills
  "wfrp4e-core.items": "items",
  "wfrp4e-core.talents": "items",
  "wfrp4e-core.traits": "items",
  "wfrp4e-core.spells": "items",
  "wfrp4e-core.prayers": "items",
  "wfrp4e-core.mutations": "items",
  "wfrp4e-core.trappings": "items",
  "wfrp4e-core.skills": "items",

  // Journals (textual rules, careers, entries, injuries, diseases, psychologies)
  "journals": "journals",
  "journal-entries": "journals",
  "careers": "journals",
  "injuries": "journals",
  "diseases": "journals",
  "psychologies": "journals",
  "wfrp4e-core.journals": "journals",
  "wfrp4e-core.journal-entries": "journals",
  "wfrp4e-core.careers": "journals",
  "wfrp4e-core.injuries": "journals",
  "wfrp4e-core.diseases": "journals",
  "wfrp4e-core.psychologies": "journals",

  // Tables (random tables, criticals, etc.)
  "tables": "tables",
  "criticals": "tables",
  "wfrp4e-core.tables": "tables",
  "wfrp4e-core.criticals": "tables"

  // Note: if you also want to fold RNHD / Starter Set into these 4,
  // add e.g. "wfrp4e-starter-set.items": "items", etc. AND include them in the skeleton macro.
};

// --- UTILITIES ---
function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function parseCompKey(key) {
  // Expects: Compendium.<package>.<pack>.<docId>.<field>
  const m = key.match(/^Compendium\.([^.\s]+)\.([^.\s]+)\.([^.\s]+)\.(.+)$/);
  if (!m) return null;
  const [, pkg, pack, id, tail] = m;
  return { pkg, pack, id, tail };
}

function loadSkeleton(pth) {
  // Build: "<package>.<pack>" -> Map<name, docId>
  const raw = JSON.parse(fs.readFileSync(pth, "utf8"));
  const nameToId = {};
  for (const [k, v] of Object.entries(raw)) {
    const p = parseCompKey(k);
    if (!p || p.tail !== "name") continue;
    const base = `${p.pkg}.${p.pack}`;
    (nameToId[base] ??= new Map()).set(v, p.id);
  }
  return nameToId;
}

// --- MAIN ---
function main() {
  ensureDir(OUTPUT_DIR);

  // 1) Load skeleton so we can remap names -> new IDs
  const nameToId = loadSkeleton(SKELETON);

  // 2) Load all legacy translation jsons
  const files = glob.sync(path.join(INPUT_DIR, "*.json"));
  if (!files.length) {
    console.error(`No JSON files found in ${INPUT_DIR}.`);
    process.exit(2);
  }

  // Target buckets
  const out = { bestiary: {}, items: {}, journals: {}, tables: {}, base: {} };
  const conflicts = [];

  for (const f of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch (e) {
      console.error(`Invalid JSON: ${f} — ${e.message}`);
      process.exit(3);
    }

    for (const [key, val] of Object.entries(data)) {
      const p = parseCompKey(key);

      // Not a Compendium key → keep in base (generic i18n)
      if (!p) {
        if (key in out.base && out.base[key] !== val) conflicts.push(key);
        out.base[key] = val;
        continue;
      }

      // Decide target pack from either "<pack>" or "<package>.<pack>"
      const target =
        PACK_MAP[p.pack] ??
        PACK_MAP[`${p.pkg}.${p.pack}`];

      if (!target) {
        // Unknown pack → keep safe in base
        if (key in out.base && out.base[key] !== val) conflicts.push(key);
        out.base[key] = val;
        continue;
      }

      // Try to remap docId using skeleton, but only when field is ".name"
      let newId = p.id;
      if (p.tail === "name") {
        const base = `${TARGET_PACKAGE}.${target}`;
        const map = nameToId[base];
        if (map && map.has(val)) newId = map.get(val);
      }

      const newKey = `Compendium.${TARGET_PACKAGE}.${target}.${newId}.${p.tail}`;
      if (newKey in out[target] && out[target][newKey] !== val) conflicts.push(newKey);
      out[target][newKey] = val;
    }
  }

  // 3) Write outputs
  for (const [pack, obj] of Object.entries(out)) {
    const file = pack === "base"
      ? `${LOCALE}.json`
      : `${LOCALE}-${TARGET_PACKAGE}-${pack}.json`;
    fs.writeFileSync(path.join(OUTPUT_DIR, file), JSON.stringify(obj, null, 2), "utf8");
    console.log(`Wrote ${path.join(OUTPUT_DIR, file)} — ${Object.keys(obj).length} keys`);
  }

  if (conflicts.length) {
    console.warn(`Conflicts found: ${conflicts.length}. Resolve and rerun.`);
  } else {
    console.log("Merge completed without conflicts. Astonishing.");
  }
}

main();
