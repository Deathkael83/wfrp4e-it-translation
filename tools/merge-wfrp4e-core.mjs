// tools/merge-wfrp4e-core.mjs
// --------------------------------------------------------------
// MERGE TRADUZIONI WFRP4e → 4 PACK FINALI (actors/items/journals/tables)
// - Legge: Compendium/**/*.json (anche sottocartelle, case-insensitive)
// - Legge anche JSON “generici” fuori da Compendium (es. it.json base)
// - Rimappa docId usando tools/it-skeleton.json (macro forzata sui 4 pack)
// - Risolve automaticamente i conflitti con una policy (Opzione A)
// - Scrive: lang/it.json + lang/it-wfrp4e-core-{actors|items|journals|tables}.json
// Requisiti: Node 20+ (meglio 22)  |  npm i glob
// --------------------------------------------------------------

import fs from "fs";
import path from "path";
import { glob } from "glob";

// =============== CONFLICT POLICY (Opzione A) ==================
// Scegli la policy: "preferFirst", "preferLast", "preferCore", "preferLongest"
const RESOLUTION = "preferCore";

// Ordine di priorità per "preferCore": la regex più in alto vince.
// (Modifica/aggiungi se hai altre famiglie di file)
const FILE_PRIORITY = [
  /Compendium[\\/].*wfrp4e-core/i,   // Core batte tutto
  /Compendium[\\/].*wfrp4e/i,       // poi altri wfrp4e
  /Compendium[\\/].*starter-set/i,  // poi Starter Set
  /Compendium[\\/].*rnhd/i          // poi RNHD
];

// Normalizza stringhe per evitare falsi conflitti (spazi, CRLF, ecc.)
function norm(v) {
  return String(v ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}
// ===============================================================

// ---------- CONFIG ----------
const COMPENDIUM_PATTERNS = [
  "Compendium/*.json",
  "Compendium/**/*.json",
  "compendium/*.json",
  "compendium/**/*.json"
];

// JSON generici (fuori da Compendium) come il tuo it.json base
const GENERIC_PATTERNS = [
  "*.json",
  "**/*.json",
  "!Compendium/**",
  "!compendium/**",
  "!lang/**",
  "!tools/**",
  "!node_modules/**",
  "!package*.json"
];

const OUTPUT_DIR = "lang";
const SKELETON = "tools/it-skeleton.json";
const LOCALE = "it";
const TARGET_PACKAGE = "wfrp4e-core"; // prefisso reale dei 4 pack finali

// VECCHI pack → PACK FINALE (actors | items | journals | tables)
const PACK_MAP = {
  // Bestiario → ACTORS
  "bestiary": "actors",
  "actors": "actors",
  "creatures": "actors",
  "npcs": "actors",
  "wfrp4e-core.bestiary": "actors",
  "wfrp4e-core.actors": "actors",
  "wfrp4e.bestiary": "actors",
  "wfrp4e.actors": "actors",

  // Oggetti/abilità → ITEMS
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

  // Testi/regole → JOURNALS
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

  // Tabelle/critici → TABLES
  "tables": "tables",
  "criticals": "tables",
  "wfrp4e-core.tables": "tables",
  "wfrp4e-core.criticals": "tables"
};

// ---------- UTIL ----------
function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function parseCompKey(key) {
  // Atteso: Compendium.<package>.<pack>.<docId>.<field>
  const m = key.match(/^Compendium\.([^.\s]+)\.([^.\s]+)\.([^.\s]+)\.(.+)$/);
  if (!m) return null;
  const [, pkg, pack, id, tail] = m;
  return { pkg, pack, id, tail };
}

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { console.error(`ERRORE JSON in ${p}: ${e.message}`); process.exit(3); }
}

// Skeleton: "<package>.<pack>" -> Map<nome, docId>
function loadSkeleton(pth) {
  const raw = loadJSON(pth);
  const nameToId = {};
  for (const [k, v] of Object.entries(raw)) {
    const p = parseCompKey(k);
    if (!p || p.tail !== "name") continue;
    const base = `${p.pkg}.${p.pack}`;
    (nameToId[base] ??= new Map()).set(v, p.id);
  }
  return nameToId;
}

// Calcola punteggio priorità per "preferCore"
function priorityScore(srcPath) {
  for (let i = 0; i < FILE_PRIORITY.length; i++) {
    if (FILE_PRIORITY[i].test(srcPath)) return 100 - i;
  }
  return -1; // bassa priorità se non matcha nulla
}

// ---------- MAIN ----------
async function main() {
  ensureDir(OUTPUT_DIR);

  // 1) Skeleton per rimappare docId via NOME nei 4 pack finali
  const nameToId = loadSkeleton(SKELETON);

  // 2) Raccogli tutti i JSON (compendium + generici)
  const set = new Set();

  for (const pat of COMPENDIUM_PATTERNS) {
    for (const f of await glob(pat, { nocase: true })) set.add(f);
  }
  for (const pat of GENERIC_PATTERNS) {
    for (const f of await glob(pat, { nocase: true })) set.add(f);
  }

  // Escludi skeleton e output
  set.delete(SKELETON);
  for (const f of [...set]) {
    if (f.startsWith(`${OUTPUT_DIR}/`) || f.startsWith(`${OUTPUT_DIR}\\`)) set.delete(f);
  }

  const files = [...set];
  console.log(`Input JSON totali: ${files.length}`);
  if (!files.length) {
    console.error("Nessun file JSON trovato (controlla percorsi/pattern).");
    process.exit(2);
  }

  // 3) Bucket per i 4 pack finali + base
  const out = {
    actors:   {},
    items:    {},
    journals: {},
    tables:   {},
    base:     {}
  };
  const conflictsLog = [];        // report dettagliato
  const srcForKey = new Map();    // tiene memoria del file sorgente per ogni chiave
  const stats = { actors: 0, items: 0, journals: 0, tables: 0, base: 0 };

  // 4) Elabora
  for (const f of files) {
    const data = loadJSON(f);

    for (const [key, valRaw] of Object.entries(data)) {
      const val = valRaw;
      const p = parseCompKey(key);

      // Chiave non-Compendium → finisce in base (qui va il tuo it.json generico)
      if (!p) {
        const existing = out.base[key];
        if (existing === undefined) {
          out.base[key] = val;
          srcForKey.set(key, f);
          stats.base++;
        } else if (norm(existing) !== norm(val)) {
          // conflitto su base: risolviamo secondo policy
          const oldSrc = srcForKey.get(key);
          let winner = "old";
          switch (RESOLUTION) {
            case "preferLast": winner = "new"; break;
            case "preferFirst": winner = "old"; break;
            case "preferLongest":
              winner = (String(val).length > String(existing).length) ? "new" : "old"; break;
            case "preferCore":
            default:
              winner = (priorityScore(f) > priorityScore(oldSrc)) ? "new" : "old";
          }
          if (winner === "new") { out.base[key] = val; srcForKey.set(key, f); }
          conflictsLog.push({
            key,
            kept: winner === "new" ? val : existing,
            dropped: winner === "new" ? existing : val,
            keptFrom: winner === "new" ? f : oldSrc,
            droppedFrom: winner === "new" ? oldSrc : f
          });
        }
        continue;
      }

      // Mappa al pack finale
      const finalPack =
        PACK_MAP[p.pack] ??
        PACK_MAP[`${p.pkg}.${p.pack}`];

      if (!finalPack) {
        // pack sconosciuto: parcheggia in base
        const existing = out.base[key];
        if (existing === undefined) {
          out.base[key] = val;
          srcForKey.set(key, f);
          stats.base++;
        } else if (norm(existing) !== norm(val)) {
          const oldSrc = srcForKey.get(key);
          let winner = "old";
          switch (RESOLUTION) {
            case "preferLast": winner = "new"; break;
            case "preferFirst": winner = "old"; break;
            case "preferLongest":
              winner = (String(val).length > String(existing).length) ? "new" : "old"; break;
            case "preferCore":
            default:
              winner = (priorityScore(f) > priorityScore(oldSrc)) ? "new" : "old";
          }
          if (winner === "new") { out.base[key] = val; srcForKey.set(key, f); }
          conflictsLog.push({
            key,
            kept: winner === "new" ? val : existing,
            dropped: winner === "new" ? existing : val,
            keptFrom: winner === "new" ? f : oldSrc,
            droppedFrom: winner === "new" ? oldSrc : f
          });
        }
        continue;
      }

      // Rimappa docId via skeleton, SOLO per le chiavi .name
      let newId = p.id;
      if (p.tail === "name") {
        const skelKey = `${TARGET_PACKAGE}.${finalPack}`; // es. wfrp4e-core.actors
        const map = nameToId[skelKey];
        if (map && map.has(val)) newId = map.get(val);
      }

      const newKey = `Compendium.${TARGET_PACKAGE}.${finalPack}.${newId}.${p.tail}`;

      const existing = out[finalPack][newKey];
      if (existing === undefined) {
        out[finalPack][newKey] = val;
        srcForKey.set(newKey, f);
        stats[finalPack]++;
      } else if (norm(existing) !== norm(val)) {
        // conflitto reale → risolvi secondo policy
        const oldSrc = srcForKey.get(newKey);
        let winner = "old";
        switch (RESOLUTION) {
          case "preferLast": winner = "new"; break;
          case "preferFirst": winner = "old"; break;
          case "preferLongest":
            winner = (String(val).length > String(existing).length) ? "new" : "old"; break;
          case "preferCore":
          default:
            winner = (priorityScore(f) > priorityScore(oldSrc)) ? "new" : "old";
        }
        if (winner === "new") { out[finalPack][newKey] = val; srcForKey.set(newKey, f); }
        conflictsLog.push({
          key: newKey,
          kept: winner === "new" ? val : existing,
          dropped: winner === "new" ? existing : val,
          keptFrom: winner === "new" ? f : oldSrc,
          droppedFrom: winner === "new" ? oldSrc : f
        });
      }
    }
  }

  // 5) Scrivi i 5 file finali (base + 4 pack)
  const outputs = [
    ["base",     `${LOCALE}.json`],
    ["actors",   `${LOCALE}-${TARGET_PACKAGE}-actors.json`],
    ["items",    `${LOCALE}-${TARGET_PACKAGE}-items.json`],
    ["journals", `${LOCALE}-${TARGET_PACKAGE}-journals.json`],
    ["tables",   `${LOCALE}-${TARGET_PACKAGE}-tables.json`]
  ];

  for (const [bucket, fname] of outputs) {
    fs.writeFileSync(path.join(OUTPUT_DIR, fname), JSON.stringify(out[bucket], null, 2), "utf8");
    console.log(`Scritto ${path.join(OUTPUT_DIR, fname)} — ${Object.keys(out[bucket]).length} chiavi`);
  }

  // Report dei conflitti risolti (per audit)
  if (conflictsLog.length) {
    const rows = [
      "key;keptFrom;droppedFrom;kept;dropped",
      ...conflictsLog.map(r =>
        [
          r.key,
          r.keptFrom,
          r.droppedFrom,
          String(r.kept).replace(/;/g, ","),
          String(r.dropped).replace(/;/g, ",")
        ].join(";")
      )
    ].join("\n");
    fs.writeFileSync("tools/conflicts-report.csv", rows, "utf8");
    console.warn(`Conflitti risolti: ${conflictsLog.length}. Vedi tools/conflicts-report.csv`);
  } else {
    console.log("Nessun conflitto dopo la policy. Miracolo raro.");
  }

  console.log("Instradamento completato.", JSON.stringify(stats));
}

await main();
