// Build lang/index.json from the language modules in lang/*.js.
// A module self-registers by calling PedalaI18n.add({...}); this script evaluates each one in a sandbox,
// checks its shape and writes the manifest the app fetches for the Settings selector.
//   node scripts/langs.js           write lang/index.json
//   node scripts/langs.js --check   fail when it is missing, stale or a module is invalid
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const DEFAULT_DIR = path.join(__dirname, "..", "lang");
const sha1 = text => crypto.createHash("sha1").update(text, "utf8").digest("hex").slice(0, 8);

function validate(lang, expectedCode, file){
  const errors = [];
  if(!lang || typeof lang !== "object") return [`${file}: PedalaI18n.add() needs an object`];
  if(lang.code !== expectedCode) errors.push(`${file}: code "${lang.code}" must equal the filename "${expectedCode}"`);
  if(typeof lang.code !== "string" || !/^[a-z]{2,3}$/.test(lang.code)) errors.push(`${file}: code must be 2 or 3 lowercase letters`);
  if(typeof lang.name !== "string" || !lang.name.trim()) errors.push(`${file}: name must be a non-empty string`);
  if(!lang.strings || typeof lang.strings !== "object" || Array.isArray(lang.strings)) errors.push(`${file}: strings must be an object`);
  else for(const [k, v] of Object.entries(lang.strings)) if(typeof v !== "string") errors.push(`${file}: strings[${JSON.stringify(k)}] must be a string`);
  for(const k of ["plural", "tn", "date", "number"]) if(lang[k] != null && typeof lang[k] !== "function") errors.push(`${file}: ${k} must be a function`);
  if(lang.dir != null && lang.dir !== "ltr" && lang.dir !== "rtl") errors.push(`${file}: dir must be "ltr" or "rtl"`);
  if(lang.locale != null && typeof lang.locale !== "string") errors.push(`${file}: locale must be a string`);
  if(lang.speech != null){
    if(typeof lang.speech !== "object" || Array.isArray(lang.speech)) errors.push(`${file}: speech must be an object`);
    else for(const [k, v] of Object.entries(lang.speech)) if(typeof v !== "function") errors.push(`${file}: speech.${k} must be a function`);
  }
  return errors;
}

function scan(dir = DEFAULT_DIR){
  const entries = [], errors = [];
  let files;
  try{ files = fs.readdirSync(dir); }
  catch(e){ return { entries, errors: [`cannot read ${dir}: ${e.message}`] }; }
  for(const file of files.filter(f => f.endsWith(".js") && !f.startsWith("_")).sort()){
    const full = path.join(dir, file), source = fs.readFileSync(full, "utf8");
    let captured = null;
    try{
      vm.runInNewContext(source, { PedalaI18n: { add(lang){ captured = lang; return lang; } } }, { filename: full, timeout: 2000 });
    }catch(e){ errors.push(`${file}: ${e.message}`); continue; }
    if(!captured){ errors.push(`${file}: did not call PedalaI18n.add()`); continue; }
    const bad = validate(captured, path.basename(file, ".js"), file);
    if(bad.length){ errors.push(...bad); continue; }
    entries.push({ code: captured.code, name: captured.name, v: sha1(source) });
  }
  entries.sort((a, b) => a.code.localeCompare(b.code));
  return { entries, errors };
}

const serialize = entries => JSON.stringify(entries, null, 2) + "\n";

function build(dir = DEFAULT_DIR){
  const { entries, errors } = scan(dir);
  if(errors.length) throw new Error("invalid language module:\n" + errors.join("\n"));
  fs.writeFileSync(path.join(dir, "index.json"), serialize(entries));
  return entries;
}

function check(dir = DEFAULT_DIR){
  const { entries, errors } = scan(dir);
  check.errors = errors;
  if(errors.length) return false;
  let current;
  try{ current = fs.readFileSync(path.join(dir, "index.json"), "utf8"); }
  catch{ check.errors = ["lang/index.json is missing"]; return false; }
  if(current !== serialize(entries)){
    check.errors = ["lang/index.json is stale: run npm run langs"];
    return false;
  }
  return true;
}

module.exports = { build, check };

if(require.main === module){
  if(process.argv.includes("--check")){
    if(check()){
      console.log("lang/index.json is up to date");
    }else{
      for(const e of check.errors || []) console.error(e);
      process.exit(1);
    }
  }else{
    try{ build(); console.log("lang/index.json written"); }
    catch(e){ console.error(e.message); process.exit(1); }
  }
}
