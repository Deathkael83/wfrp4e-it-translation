// tools/merge-wfrp4e-core.mjs
// --------------------------------------------------------------
// MERGE TRADUZIONI WFRP4e → 4 COMPENDI CORE
// - Input:  vecchi JSON in Compendium/ (anche sottocartelle)
// - Skeleton: tools/it-skeleton.json (generato dalla macro)
// - Output: lang/it-wfrp4e-core-*.json (+ it.json base)
// Requisiti: Node 20+ (meglio 22), npm i glob
// --------------------------------------------------------------

import fs from "fs";
import path from "path";
import { glob } from "glob";

// ---------- CONFIG ----------
const INPUT_DIRS = [
  "Compendium/**/*.json",
  "Compendium/*.json",
  "compendium/**/*.json",
  "compendium/*.json"
];

const OUTPUT_DIR = "lang";
const SKELETON = "tools/it-skeleton.json";
const LOCALE = "it";
const TARGET_PACKAGE = "wfrp4e-core"; // prefisso reale dei 4 pack nuovi

// Mappa dei VECCHI pack → categoria logica target
// La categoria NON è il nome del compendio: serve per smistare.
// Poi convertirò categoria → vero nome pack (actors/items/journals/tables).
const PACK_MAP = {
  // Bestiario/Attori
  "bestiary": "bestiary",
  "wfrp4e-core.bestiary": "bestiary",

  // Oggetti/Abilities ecc. confluiscono in "items"
  "items": "items",
  "talents": "items",
  "traits": "items",
  "spells": "items",
  "prayers": "items",
  "mutations": "items",
  "trappings": "items",
  "skills": "items",
  "wfrp4e-core.items": "items",
  "wfrp4e-core.talents": "items",
  "wfrp4e-core.traits": "items",
  "wfrp4e-core.spells": "items",
  "wfrp4e-core.prayers": "items",
  "wfrp4e-core.mutations": "items",
  "wfrp4e-core.trappings": "items",
  "wfrp4e-core.skills": "items",

  // Journals/regole/testo vario
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

  // Tabelle/critici ecc.
  "tables": "tables",
  "criticals": "tables",
  "wfrp4e-core.tables": "tables",
  "wfrp4e-core.criticals": "tables"
};

// Categoria logica → vero nome pack dei 4 finali
// Qui si decide come scrivere la chiave finale.
const TARGET_TO_PACK = {
  bestiary: "actors",
  items: "items",
  journals: "journals",
  tables: "tables"
};

// ---------- UTIL ----------
function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function parseCompKey(key) {
  // Atteso: Compendium.<package>.<pack>.<docId>.<campo>
  const m = key.match(/^Compendium\.([^.\s]+)\.([^.\s]+)\.([^.\s]+)\.(.+)$/);
  if (!m) return null;
  const [, pkg, pack, id, tail] = m;
  return { pkg, pack, id, tail };
}

// Carica lo skeleton e crea una mappa:
// "<package>.<pack>" -> Map<nomeDocumento, docId>
function loadSkeleton(pth) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(pth, "utf8"));
  } catch (e) {
    console.error(`ERRORE: impossibile leggere ${pth}: ${e.message}`);
    process.exit(1);
  }
  const nameToId = {};
  for (const [k, v] of Object.entries(raw)) {
    const p = parseCompKey(k);
    if (!p || p.tail !== "name") continue;
    const base = `${p.pkg}.${p.pack}`;
    (nameToId[base] ??= new Map()).set(v, p.id);
  }
  return nameToId;
}

// ---------- MAIN ----------
async function main() {
  ensureDir(OUTPUT_DIR);

  // 1) Skeleton: serve per rimappare docId tramite NOME sui 4 pack finali
  const nameToId = loadSkeleton(SKELETON);

  // 2) Trova tutti i JSON d’ingresso, ricorsivamente e ignorando case
  const filesSet = new Set();
  for (const pat of INPUT_DIRS) {
    const found = await glob(pat, { nocase: true });
    for (const f of found) filesSet.add(f);
  }
  const files = [...filesSet];
  console.log(`Scansione input: trovati ${files.length} file JSON.`);
  if (!files.length) {
    console.error("Nessun file JSON trovato sotto Compendium/ o compendium/.");
    process.exit(2);
  }

  // 3) Bucket di output
  const out = { bestiary: {}, items: {}, journals: {}, tables: {}, base: {} };
  const conflicts = [];

  // 4) Elabora ogni file
  for (const f of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch (e) {
      console.error(`JSON non valido: ${f} — ${e.message}`);
      process.exit(3);
    }

    for (const [key, val] of Object.entries(data)) {
      const p = parseCompKey(key);

      // Chiave non-Compendium: resta nel file base (i18n generiche)
      if (!p) {
        if (key in out.base && out.base[key] !== val) conflicts.push(key);
        out.base[key] = val;
        continue;
      }

      // Determina la categoria logica target dal pack o dal package.pack
      const target =
        PACK_MAP[p.pack] ??
        PACK_MAP[`${p.pkg}.${p.pack}`];

      if (!target) {
        // Pack sconosciuto: non buttiamo via niente, parcheggia in base
        if (key in out.base && out.base[key] !== val) conflicts.push(key);
        out.base[key] = val;
        continue;
      }

      // Nome vero del pack finale (actors/items/journals/tables)
      const finalPackName = TARGET_TO_PACK[target];
      if (!finalPackName) {
        console.warn(`Categoria senza mapping pack finale: ${target} (chiave ${key})`);
        continue;
      }

      // Rimappa docId tramite skeleton, SOLO per le chiavi .name
      let newId = p.id;
      if (p.tail === "name") {
        const skeletonBase = `${TARGET_PACKAGE}.${finalPackName}`;
        const map = nameToId[skeletonBase];
        if (map && map.has(val)) newId = map.get(val);
      }

      // Costruisci la NUOVA chiave nel formato dei 4 pack finali
      const newKey = `Compendium.${TARGET_PACKAGE}.${finalPackName}.${newId}.${p.tail}`;

      if (newKey in out[target] && out[target][newKey] !== val) conflicts.push(newKey);
      out[target][newKey] = val;
    }
  }

  // 5) Scrivi output
  for (const [cat, obj] of Object.entries(out)) {
    const file = cat === "base"
      ? `${LOCALE}.json`
      : `${LOCALE}-${TARGET_PACKAGE}-${cat}.json`; // cat usata solo nel nome file
    fs.writeFileSync(path.join(OUTPUT_DIR, file), JSON.stringify(obj, null, 2), "utf8");
    console.log(`Scritto ${path.join(OUTPUT_DIR, file)} — ${Object.keys(obj).length} chiavi`);
  }

  if (conflicts.length) {
    console.warn(`Conflitti trovati: ${conflicts.length}. Decidi quale traduzione tenere e rilancia.`);
  } else {
    console.log("Merge completato senza conflitti. Miracolo raro.");
  }
}

await main();
