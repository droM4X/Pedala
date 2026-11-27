// Unit tests for i18n.js: registry, text/plural/date/number helpers and the language index generator.
// Run: node --no-warnings tests/i18n.js
const assert = require("node:assert/strict");
const I = require("../i18n.js");

I.add({ code: "zz", name: "Testish", locale: "en-GB", strings: {
  "Ride": "Menet",
  "In {sec} seconds:": "{sec} mp múlva",
  "{n} ride": "{n} tekerés",
  "{n} rides": "{n} tekerés"
}, plural: n => n === 1 ? "one" : "other" });
assert.equal(I.use("zz"), true);
assert.equal(I.t("Ride"), "Menet");
assert.equal(I.t("Missing"), "Missing");
assert.equal(I.t("In {sec} seconds:", { sec: 10 }), "10 mp múlva");
assert.equal(I.tn(1, "{n} ride", "{n} rides", { n: 1 }), "1 tekerés");
assert.equal(I.tn(2, "{n} ride", "{n} rides", { n: 2 }), "2 tekerés");
assert.equal(I.td(new Date(2026, 10, 27), { year: "numeric", month: "2-digit", day: "2-digit" }), "27/11/2026");
assert.equal(I.tnum(1234.5, { minimumFractionDigits: 1 }), "1,234.5");
assert.equal(I.use("en"), true);
assert.equal(I.t("Ride"), "Ride");

/* speech overrides: the English segment/lap builders take duration/watts/cadence from ctx */
I.add({ code: "yy", name: "Speechish", strings: {}, speech: {
  duration: s => `D${s}`,
  watts: n => `<${n}W>`
} });
assert.equal(I.use("yy"), true);
I.setSpeechLang("yy");
const sp = I.speech, spCtx = { duration: sp.duration, watts: sp.watts, cadence: sp.cadence };
const seg = sp.segment({ d: 180, loW: 200, hiW: 200 }, spCtx);
assert.match(seg, /D180/); assert.match(seg, /<200W>/);
assert.doesNotMatch(seg, /3 minutes|200 watts/);
const lapPower = sp.lap({ kind: "power", score: 80, dur: 60, avgP: 200 }, spCtx);
assert.match(lapPower, /<200W>/); assert.doesNotMatch(lapPower, /200 watts/);
const lapDist = sp.lap({ kind: "dist", km: 1, dur: 60, avgP: 200, kmLimit: 5 }, spCtx);
assert.match(lapDist, /D60/); assert.match(lapDist, /<200W>/);
I.use("en"); I.setSpeechLang("en");

/* language index generator: build writes the manifest, check fails when it is stale */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { build, check } = require("../scripts/langs.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pedala-lang-"));
fs.writeFileSync(path.join(dir, "xx.js"), 'PedalaI18n.add({ code: "xx", name: "Test", strings: { "Ride": "X" } });\n');
build(dir);
const idx = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
assert.equal(idx[0].code, "xx"); assert.equal(idx[0].name, "Test"); assert.match(idx[0].v, /^[0-9a-f]{8}$/);
assert.equal(check(dir), true);
fs.appendFileSync(path.join(dir, "xx.js"), "\n// changed\n");
assert.equal(check(dir), false);
fs.writeFileSync(path.join(dir, "_template.js"), "throw new Error('must be ignored')");
assert.equal(check(dir), false); // still stale from xx change
build(dir); assert.equal(check(dir), true);

/* the first module load carries the manifest hash; a missing index still loads plain */
(async () => {
  const realFetch = global.fetch, realDocument = global.document;
  const response = (body, ok = true, type = "application/json") => ({ ok, headers: { get: () => type }, json: async () => body });
  const scripts = [];
  let indexMode = "ok";
  global.fetch = async url => {
    if(url === "/lang/index.json") return indexMode === "ok" ? response([{ code: "qq", name: "Queue", v: "abc123" }]) : response(null, false);
    return response(null, true, "text/javascript");
  };
  const fakeDoc = code => ({
    documentElement: { lang: "", dir: "" },
    querySelectorAll: () => [],
    createTreeWalker: () => ({ nextNode: () => null }),
    createElement: () => ({}),
    head: { append(script){ scripts.push(script.src); I.add({ code, name: code.toUpperCase(), strings: {} }); } }
  });
  global.document = fakeDoc("qq");
  await I.init("qq");
  assert.equal(scripts[0], "/lang/qq.js?v=abc123");
  indexMode = "fail"; scripts.length = 0;
  global.document = fakeDoc("rr");
  await I.init("rr");
  assert.equal(scripts[0], "/lang/rr.js");
  I.use("en"); I.setSpeechLang("en");
  I.languages.delete("qq"); I.languages.delete("rr");
  global.fetch = realFetch;
  if(realDocument === undefined) delete global.document; else global.document = realDocument;
  console.log("i18n: ok");
})().catch(e => { console.error(e); process.exit(1); });
