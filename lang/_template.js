/* Pedala language module template.
   Copy this file to lang/<code>.js (the filename must equal code), then fill in the strings.
   Run `npm run langs` to add it to lang/index.json. See docs/adding-a-language.md.
   English text in the app is the key: a missing key falls back to English. */
PedalaI18n.add({
  code: "xx",                         // required, 2-3 lowercase letters, equals the filename
  name: "Language name",              // required, the native name shown in Settings
  locale: "xx-XX",                    // Intl locale; defaults to code
  dir: "ltr",                         // optional: "ltr" (default) or "rtl"
  strings: {
    // "English source": "Translation",
    // "In {sec} seconds:": "{sec} …",
  },
  // plural(n) { return n === 1 ? "one" : "other"; },          // optional two-form convenience
  // tn(n, one, other, vars) { ... },                          // optional full override
  // date(ts, opts) { ... },                                   // optional, otherwise Intl
  // number(n, opts) { ... },                                  // optional, otherwise Intl
  speech: {
    // watts(n) { ... }, duration(sec) { ... }, cadence(lo, hi, any) { ... },
    // segment(seg, ctx) { ... }, lap(lap, ctx) { ... }, finish(route) { ... },
    // strength(step, next) { ... }, start() { ... }, soon(segment) { ... }
  }
});
