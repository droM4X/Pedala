// Check the language modules in lang/*.js against the key list in lang/keys.json.
//   node scripts/i18n-check.js            report missing, unused and untranslated keys per language
//   node scripts/i18n-check.js --strict   exit 1 when a language misses a key
//
// Missing:  a key from lang/keys.json that the language does not translate (English is shown).
// Unused:   a string in the language file that the app never asks for (a typo or a stale key).
// Untranslated: a value identical to its English key. Legitimate for units, names and symbols; a
//           warning for prose. `npm run i18n:keys` refreshes the key list after index.html changes.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const DIR = path.join(__dirname, "..", "lang");
const KEYS = path.join(DIR, "keys.json");

function readKeys(){
  const list = JSON.parse(fs.readFileSync(KEYS, "utf8"));
  if(!Array.isArray(list) || list.some(k => typeof k !== "string" || !k.trim()))
    throw new Error("lang/keys.json must be a JSON array of non-empty strings: run npm run i18n:keys");
  return [...new Set(list)];
}

/* evaluate a module the way the browser does: it calls PedalaI18n.add({...}) */
function scanLanguages(dir = DIR){
  const out = [], errors = [];
  let files;
  try{ files = fs.readdirSync(dir); }
  catch(e){ return { out, errors: [`cannot read ${dir}: ${e.message}`] }; }
  for(const file of files.filter(f => f.endsWith(".js") && !f.startsWith("_")).sort()){
    const full = path.join(dir, file), source = fs.readFileSync(full, "utf8");
    let captured = null;
    try{ vm.runInNewContext(source, { PedalaI18n: { add(lang){ captured = lang; return lang; } } }, { filename: full, timeout: 2000 }); }
    catch(e){ errors.push(`${file}: ${e.message}`); continue; }
    if(!captured || typeof captured !== "object"){ errors.push(`${file}: did not call PedalaI18n.add()`); continue; }
    const expected = path.basename(file, ".js");
    if(captured.code !== expected) errors.push(`${file}: code "${captured.code}" must equal the filename "${expected}"`);
    if(!captured.strings || typeof captured.strings !== "object" || Array.isArray(captured.strings)){ errors.push(`${file}: strings must be an object`); continue; }
    out.push({ file, code: captured.code || expected, name: captured.name || expected, strings: captured.strings });
  }
  return { out, errors };
}

function compare(keys, strings){
  const have = new Set(Object.keys(strings));
  const missing = keys.filter(k => !have.has(k));
  const unused = [...have].filter(k => !keys.includes(k)).sort((a, b) => a.localeCompare(b));
  const untranslated = keys.filter(k => have.has(k) && strings[k] === k);
  return { missing, unused, untranslated };
}

const preview = (list, label, max = 25) => list.length ? list.slice(0, max).map(k => `    ${label} ${JSON.stringify(k)}`).join("\n")
  + (list.length > max ? `\n    … and ${list.length - max} more` : "") : "";

function check(dir = DIR, { strict = false } = {}){
  const keys = readKeys();
  const { out, errors } = scanLanguages(dir);
  console.log(`lang/keys.json: ${keys.length} keys`);
  if(!out.length && !errors.length){ console.log("no language modules yet (English is built in)"); return { ok: errors.length === 0, errors, languages: [] }; }
  const languages = [];
  for(const lang of out){
    const { missing, unused, untranslated } = compare(keys, lang.strings);
    languages.push({ code: lang.code, missing, unused, untranslated });
    console.log(`\n${lang.code} (${lang.name}): ${missing.length} missing, ${unused.length} unused, ${untranslated.length} untranslated`);
    if(missing.length) console.log(preview(missing, "missing"));
    if(unused.length) console.log(preview(unused, "unused"));
    if(untranslated.length) console.log(preview(untranslated, "untranslated"));
  }
  for(const e of errors) console.error(e);
  const missing = languages.reduce((n, l) => n + l.missing.length, 0);
  console.log(`\n${languages.length} language${languages.length === 1 ? "" : "s"} checked, ${missing} missing key${missing === 1 ? "" : "s"} in total`);
  const ok = errors.length === 0 && !(strict && missing > 0);
  if(!ok && strict && missing) console.error("missing keys: run npm run i18n:check after filling them, or refresh lang/keys.json with npm run i18n:keys");
  return { ok, errors, languages };
}

module.exports = { readKeys, scanLanguages, compare, check };

if(require.main === module){
  try{ process.exit(check(DIR, { strict: process.argv.includes("--strict") }).ok ? 0 : 1); }
  catch(e){ console.error(e.message); process.exit(1); }
}
