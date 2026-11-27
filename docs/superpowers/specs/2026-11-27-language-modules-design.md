# Language modules: English base, drop-in `lang/<code>.js` files

**Date:** 2026-11-27
**Status:** approved by the owner (build mode)
**Owner decisions:** static `lang/index.json` + generator (no server endpoint); full
Hungarian as the first language; scope = UI + dates/numbers/plurals + spoken
announcements. The login page, `gear.html` phone remote and virtual-coach output stay
English for this project.

## Intent and why

The owner wants to add languages without touching app logic: one file per language,
easy to edit, no per-language `if`/`switch` in the core. English stays the source in the
code; a missing file or a missing key shows English. The previous translation system
(Croatian base + `EN` map + 43 regex rules + MutationObserver + `data-notr`) was removed
on 2026-11-26 because it was fragile; this design avoids its failure modes by using
English text as the key, explicit `t()` calls for dynamic text, and a per-language
module for grammar.

## Goals

- `lang/<code>.js` is the whole language, loaded only when selected.
- Adding a language = copy the template, fill `strings`, run `npm run langs`, commit.
  No changes to `index.html` or `i18n.js`.
- With no language file, the app is English, unchanged.
- Hungarian is a complete first language: UI, dates/numbers/plurals, spoken
  announcements.
- The English test suite keeps passing, except deliberately fixed English plural bugs.

## Non-goals

- No server-side language discovery (no `/api/languages`); no build step.
- No translation of the login page, `gear.html`, coach output, FIT/ICS export metadata
  or the coach request contract.
- No browser auto-translate; the app owns the language.
- No MutationObserver over live DOM.

## Constraints

- Zero-build, single `index.html` plus classic scripts (`qr.js` precedent).
- The app runs on Vercel and under `tests/support/server.js`; both must work.
- Language files live behind the login middleware; the app fetches them after login.
- Existing `localStorage` with stale `uiLang`/`voiceLang` must be ignored.
- Upstream merges: keep English text in place, minimal markup changes.

## Architecture

### Files

| File | Responsibility |
|---|---|
| `i18n.js` (new) | Classic script, `window.PedalaI18n` (UMD export for Node tests). Registry, `t/tn/td/tnum`, `localizeDom`, loader/init, English speech defaults, Intl formatter cache, optional seen-key recorder. |
| `lang/<code>.js` (new) | Calls `PedalaI18n.add({...})`. Self-registering; filename must equal `code`. |
| `lang/_template.js` | Annotated template; generator and loader ignore `_`-prefixed files. |
| `lang/index.json` | Generated `[{ code, name, v }]`, `v` = short content hash for cache-busting. |
| `scripts/langs.js` | Scans `lang/*.js`, evaluates each with a `PedalaI18n.add` stub in `vm`, validates, writes `index.json`; `--check` fails when stale. Exports `build()`/`check()` for unit tests. |
| `package.json` | `langs` (write), `predev` (write), `pretest` (`--check`). |
| `index.html` | Script tag, settings `lang`, init wrapping, Language select, `t()` conversion, speech delegation, date/number replacement, readiness flag. |
| `tests/support/server.js` | `.json` MIME, 404 for missing `/lang/*`, fixture alias. |
| `tests/fixtures/lang/zz.js` | Test-only language, served at `/lang/zz.js`; not in `lang/`, not in the index. |
| `README.md` | Workflow summary, contract, limits. |

### Module contract

```js
PedalaI18n.add({
  code: "hu",                 // required, equals the filename
  name: "Magyar",             // required, native name
  locale: "hu-HU",            // Intl locale; default = code
  dir: "ltr",                 // optional
  strings: {                  // required, flat English key -> translation
    "Ride": "Menet",
    "In {sec} seconds:": "{sec} másodperc múlva:"
  },
  plural(n) { ... },          // optional, two-form convenience
  tn(n, one, other, vars) { ... }, // optional full override
  date(ts, opts) { ... },     // optional, otherwise Intl
  number(n, opts) { ... },    // optional, otherwise Intl
  speech: {                   // optional, partial override
    watts(n) { ... }, duration(sec) { ... }, cadence(lo, hi, any) { ... },
    segment(seg, ctx) { ... }, lap(lap, ctx) { ... }, finish(route) { ... },
    strength(step, next) { ... }, start() { ... }
  }
});
```

- `strings` keys are the exact English source text, with `{placeholder}` tokens.
  Values are strings; HTML is allowed only for keys used through `tHtml()` or
  `data-i18n`.
- The generator validates: filename = `code`, non-empty `name`, `strings` values are
  strings, optional fields have the right type, `dir` is `ltr`/`rtl`.
- English is built in and is never a file.

### Loading and boot

- `settings.lang` (default `""` = automatic) is added to defaults and `SYNC_SKIP`
  (per-device, not synced).
- Selection: explicit `settings.lang` -> base codes of `navigator.languages` -> `en`.
  `en` is built in and is never fetched.
- `load(code)`: validate `^[a-z]{2,3}$`; fetch `/lang/<code>.js` (with `?v=<hash>` from
  the index); require `res.ok` and a JavaScript MIME; inject a `<script>`; resolve when
  `PedalaI18n.languages.has(code)`, with a 3 s timeout. Any failure -> `null`.
  - The test server returns `index.html` (200, `text/html`) for missing files unless
    fixed; the MIME check prevents executing HTML.
- `lang/index.json` is fetched with `cache: "no-cache"` in parallel for the selector.
  Failure -> only English + the active language.
- `init(pref)` always resolves; on any error the app boots in English. It sets
  `document.documentElement.lang/dir`, runs `localizeDom(document)`, and marks
  `document.documentElement.dataset.i18n = "ready"` after the app's own init.
- No CSS hiding. An inline English shim after `i18n.js` provides `t/td/tnum` and no-op
  speech if `i18n.js` itself fails, so the app never deadlocks.
- Language change saves `settings.lang` and reloads. If a ride is started, a toast
  blocks the change so the ride is not lost.
- The e2e `open()` waits for `window.__pedala` and `dataset.i18n === "ready"` instead of
  a fixed delay.

### Translation API and markup rules

- `t(key, vars)` returns plain text: dictionary value or the English key, with
  `{name}` tokens replaced. Use it in `textContent`, attributes and text fragments.
- `tHtml(key, vars)` is the same lookup but is only used where the result is assigned to
  `innerHTML`; values may contain inline tags. Only trusted language files supply it.
- `tn(n, one, other, vars)` selects the English one/other form (module `plural` or `tn`
  can override), then translates; values can be identical in languages without plural
  marking (Hungarian).
- `td(ts, opts)` and `tnum(n, opts)` use `Intl` with the active locale, cached per
  options; a module may override `date`/`number`.
- `localizeDom(root)` runs once at boot over the static shell:
  - text nodes: exact match on trimmed text, surrounding whitespace preserved;
  - attributes: `placeholder`, `aria-label`, `title`, `alt`;
  - `[data-i18n]`: replace `innerHTML` with the translation; only on elements without
    form controls/children that must survive. For `<label>` wrapping an `<input>`,
    translate the text node or wrap the text in a `<span data-i18n>`;
  - skip `script`, `style`, `canvas`, `noscript`.
- Dynamic text uses explicit `t()`/`tn()` at the render site, including canvas
  `fillText`, `confirm()`/`prompt()`, toasts and API error strings. User data (video
  titles, imported workout names/descriptions, coach output) is never passed to `t()`.

### Generated names and descriptions

`Zone 2 · 50 min`, `Brick · 8 min run`, `Run · 2.5 km easy`, `Strength A · ...`,
`Lap 3` are not stable keys. They are composed at display time:

- Generator functions get small structural fields (`zoneMin`, `kind`, `km`, `min`,
  `rounds`) and `workoutLabel`/`sessionLabel` helpers compose names from `t()`
  templates.
- Descriptions compose a fixed prose template with the variable part (`main`, rounds);
  do not translate whole generated strings.
- The English output must stay byte-identical (existing tests).
- Built-in workouts/routes are marked `builtin: true`; imported ZWO/GPX objects are not.
- Saved rides keep the name/lap names captured at save time; the history/report title
  may be re-derived from `workoutId` for built-in workouts, imported rides keep
  `r.name`, laps stay as saved. This is accepted.

### Speech

- `index.html` computes resolved data and calls `PedalaI18n.speech.*`:
  `watts(n)`, `duration(sec)`, `cadence(lo, hi, any)`, `segment(seg, ctx)`,
  `lap(lap, ctx)`, `finish(route)`, `strength(step, next)`, `start()`.
- `ctx` carries resolved values and the active `duration`/`watts`/`cadence` helpers.
  `segment` receives `{ d, free, hr, loW, hiW, cad, note }` with watts already
  bias-adjusted; `note` is the English key. `lap` receives `{ kind, km, dur, avgP,
  avgCad, avgHr, score, kmLimit, cadTgt }`.
- The English defaults live in `i18n.js` and reproduce today's strings exactly.
- The speech language is the **selected voice's language**, not the UI language. If no
  matching voice exists, announcements fall back to English while the UI stays
  translated, and Settings shows a translated notice. A saved `voiceName` is ignored
  when its language does not match.
- `fillVoices()` lists voices for the active locale; if none, English voices plus the
  notice. Hungarian terms follow the archived Hungarian voice reference (since removed).

### Dates, numbers, plurals, units

- Replace every display `toLocale*("en-GB")` with `td()`; `shortDate` uses `Intl`;
  day labels use `t()` or `Intl`.
- Replace display `toFixed` with `tnum(n, { minimumFractionDigits, maximumFractionDigits })`
  where grouping/decimals matter; keep `String(n)` for raw counts. English output must
  not gain separators where it had none.
- Use `tn()` for ride/rides, minute/minutes, second/seconds etc.; fix obvious English
  plural bugs (`1 kilometers`, `1 seconds`) and update the pinned tests.
- Units: `t("min")`, `t("h")` etc.; symbols (W, km, rpm, bpm) stay.

### Settings and switching

- Language select at the top of Basic: `Automatic (<active name>)`, `English`, and
  index entries by native name. If the active language is not indexed, add it as a
  synthetic option so the select is never blank.
- `fillSettings` populates; the change handler saves `settings.lang` and reloads.
  If `S.started`, block with a toast.
- Backups may carry `lang`; accepted (not synced).

### First language: Hungarian

- Complete `lang/hu.js`: UI, dates/numbers/plurals, speech.
- A key list is produced by a Playwright walk with the seen-key recorder over all
  views/dialogs; generated labels share `t()` templates so one instance covers the
  variants. Missing/unused keys are reported by a script.
- Proper nouns (Alpe d'Huez, Učka, Sljeme) stay; workouts/strength names and drill cues
  translate; workout descriptions compose from templates.
- The owner reviews the Hungarian text.

## Tests

- Unit: `t` fallback/interpolation, `tn`, `td`, `tnum`, module validation, generator
  `--check`, hash; `i18n.js` loads in Node via its UMD export with DOM-free calls.
- E2E: English default unchanged; `zz` fixture language (labels, a dynamic sentence, a
  date, a voice sentence); real `hu`; unknown/missing language -> English, no page
  errors; selector lists the language; no Hungarian voice -> English speech + notice;
  manifest check; English scan; curated Hungarian scan.
- Test server: `.json` MIME, 404 for missing `/lang/*`, fixture alias; `open()` waits
  for readiness.

## Out of scope / follow-ups

- Login page localization (server-rendered, 8 strings, needs a cookie/server dictionary).
- `gear.html` remote localization (local-only, 16 strings; a `?lang` later).
- Virtual-coach output language (send `lang` to `/api/coach`, prompts write in it).
- API error strings stay English server-side; the client translates known keys only.
- FIT/ICS/sync metadata stays English for stable identity.

## Risks

- Large diff across `index.html`; English-key drift silently falls back to English
  (mitigated by the missing-key report).
- The static pass is exact-match; long prose with inline markup needs `data-i18n`.
- Hungarian grammar lives in `speech` overrides; TTS voice availability is per device.
- A stale `index.json` hides a new language from the selector; `predev`/`pretest` and
  the direct browser-language try mitigate; the selector lists only indexed languages.
- Saved rides keep their saved language for name/laps.
- Longer Hungarian strings may overflow HUD/buttons/canvas; visual review required.
