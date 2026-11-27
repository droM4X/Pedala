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
const enCtx = { duration: I.speech.duration, watts: I.speech.watts };
assert.equal(I.speech.lap({ kind: "dist", km: 1, dur: 60, avgP: 200, kmLimit: 5 }, enCtx), "1 kilometer. Last 5 in 1 minute, average 200 watts.");
assert.equal(I.speech.lap({ kind: "dist", km: 2, dur: 60, avgP: 200, kmLimit: 5 }, enCtx), "2 kilometers. Last 5 in 1 minute, average 200 watts.");
assert.equal(I.speech.strength({ kind: "work", n: "Squat", s: 1 }, null), "Squat, 1 second.");
assert.equal(I.speech.strength({ kind: "work", n: "Squat", s: 30 }, null), "Squat, 30 seconds.");
/* the voice test sentence is pinned, byte for byte */
const voiceCtx = { duration: I.speech.duration, watts: I.speech.watts, cadence: I.speech.cadence, anyCad: 999 };
assert.equal(I.speech.soon(I.speech.segment({ d: 180, loW: 265, hiW: 265, cad: [90, 100] }, voiceCtx)),
  "In 10 seconds: 3 minutes at 265 watts, cadence 90 to 100.");
assert.equal(I.speech.start(), "Workout starting.");
assert.equal(I.speech.finish(true), "You made it to the finish.");
assert.equal(I.speech.finish(false), "Workout complete. Well done.");
assert.equal(I.speech.lap({ kind: "power", score: 90, dur: 60, avgP: 200 }, enCtx), "Interval done. Average 200 watts, 90 percent.");
assert.equal(I.speech.lap({ kind: "hr", score: 90, dur: 60, avgHr: 140 }, enCtx), "Interval done. Average heart rate 140.");
assert.equal(I.speech.lap({ cadTgt: [85, 95], avgCad: 90 }, enCtx), "");
assert.equal(I.speech.lap({ cadTgt: [110, 999], avgCad: 112 }, enCtx), "Average cadence 112.");

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

/* Hungarian speech: no plural after a number, durations joined with a space and HR suffix harmony */
require("../lang/hu.js");
assert.equal(I.use("hu"), true);
I.setSpeechLang("hu");
const hu = I.speech, huCtx = { duration: hu.duration, watts: hu.watts, cadence: hu.cadence, anyCad: 999 };
assert.equal(hu.watts(1), "1 watt");
assert.equal(hu.watts(200), "200 watt");
assert.equal(hu.duration(45), "45 másodperc");
assert.equal(hu.duration(180), "3 perc");
assert.equal(hu.duration(200), "3 perc 20 másodperc");
assert.equal(hu.cadence(90, 100, 999), "kadencia 90 és 100 között");
assert.equal(hu.cadence(90, 999, 999), "kadencia 90 vagy több");
assert.equal(hu.segment({ d: 200, free: true }, huCtx), "3 perc 20 másodperc szabadon");
assert.equal(hu.segment({ d: 180, hr: 145 }, huCtx), "3 perc 145-ös pulzuson");
assert.equal(hu.segment({ d: 180, hr: 150 }, huCtx), "3 perc 150-es pulzuson");
assert.equal(hu.segment({ d: 180, loW: 200, hiW: 200 }, huCtx), "3 perc 200 watton");
assert.equal(hu.segment({ d: 200, loW: 200, hiW: 265 }, huCtx), "3 perc 20 másodperc, 200-tól 265 watton");
assert.equal(hu.segment({ d: 200, free: true, note: "Magas kadencia, maradj ülve", cad: [90, 999] }, huCtx),
  "Magas kadencia, maradj ülve. 3 perc 20 másodperc szabadon, kadencia 90 vagy több");
assert.equal(hu.segment({ d: 180, loW: 265, hiW: 265, cad: [90, 100] }, huCtx),
  "3 perc 265 watton, kadencia 90 és 100 között");
assert.equal(hu.lap({ kind: "dist", km: 12, kmLimit: 5, dur: 200, avgP: 200, score: 95 }, huCtx),
  "12 kilométer. Az utolsó 5 kilométer 3 perc 20 másodperc alatt, átlag 200 watt.");
assert.equal(hu.lap({ kind: "power", score: 80, dur: 60, avgP: 200 }, huCtx), "Intervallum kész. Átlag 200 watt, 80 százalék.");
assert.equal(hu.lap({ kind: "hr", score: 95, dur: 60, avgHr: 145, avgP: 200 }, huCtx), "Intervallum kész. Átlagos pulzus 145.");
assert.equal(hu.lap({ cadTgt: [110, 999], avgCad: 95 }, huCtx), "Átlagos kadencia 95.");
assert.equal(hu.lap({ cadTgt: [85, 95], avgCad: 90 }, huCtx), "");
assert.equal(hu.lap({ kind: "power", dur: 10, avgP: 200 }, huCtx), "");
assert.equal(hu.finish(true), "Célba értél.");
assert.equal(hu.finish(false), "Vége az edzésnek. Szép munka.");
assert.equal(hu.strength({ kind: "rest", s: 60 }, { n: "Squat" }), "Pihenő. Következik: Guggolás.");
assert.equal(hu.strength({ kind: "work", n: "Squat", s: 30 }, null), "Guggolás, 30 másodperc.");
assert.equal(hu.strength({ kind: "warm", n: "Marching on the spot, knees up", s: 60 }, null), "Helyben menetelés, térd fel");
assert.equal(hu.start(), "Kezdődik az edzés.");
assert.equal(hu.soon("3 perc 265 watton"), "10 másodperc múlva: 3 perc 265 watton.");
I.use("en"); I.setSpeechLang("en");

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
