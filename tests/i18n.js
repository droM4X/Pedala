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
console.log("i18n: ok");
