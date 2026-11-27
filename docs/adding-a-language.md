# Adding a language

Pedala is written in English and stays English by default. The English text in
`index.html` is both the source and the message key: a language is one drop-in file,
`lang/<code>.js`, that translates that text. A missing file or a missing key shows
English. No build step, no bundler, and no change to `index.html` or `i18n.js` is
needed to add one.

Hungarian (`lang/hu.js`) is the worked example for the UI text.

## How it fits together

| File | What it is |
|---|---|
| `i18n.js` | The core: registry, `t`/`tn`/`td`/`tnum`, the one-time DOM pass, the loader, English speech defaults. |
| `lang/<code>.js` | One language. A classic script that calls `PedalaI18n.add({...})`. The filename must equal `code`. |
| `lang/_template.js` | Annotated skeleton to copy. Files starting with `_` are ignored by the generator, and no language code can start with `_`. |
| `lang/index.json` | Generated list of languages (`code`, `name`, and a short content hash `v`) that fills the Settings selector. Do not edit it by hand. |
| `lang/keys.json` | The English key list produced by the coverage walk. |
| `scripts/langs.js` | Validates `lang/*.js` and writes or checks `lang/index.json`. |
| `scripts/i18n-keys.js` | Walks the app and refreshes `lang/keys.json` (dev tool, not part of `npm test`). |
| `scripts/i18n-check.js` | Compares each language with `lang/keys.json`: missing, unused, untranslated. |

When the app starts it picks a language in this order:

1. `settings.lang` (Settings → Language), if set;
2. otherwise the base codes of the browser's languages (`navigator.languages`);
3. otherwise English.

English is built in and is never a file. An unknown or deleted code falls back to
English with no page error. A language file is only fetched when it is chosen; the
request carries the `v` hash from `lang/index.json` so a changed file is not served
from an old cache. The Settings list is built from `lang/index.json` plus the active
language, so a new language normally appears there after `npm run langs`; the active or
saved code is shown even when the index is stale. Automatic selection still tries the
browser's language file directly even when the index is stale.

`settings.lang` is saved per device (`SYNC_SKIP`), not synced between devices. Changing
it reloads the page; while a ride is started the change is refused with a toast so the
ride is not lost.

## Add a language

1. Copy the template. Use a 2- or 3-letter lowercase base code: `de`, `pt`, `hu`.

   ```bash
   cp lang/_template.js lang/de.js
   ```

   The code must be the filename without `.js`; a region belongs in `locale`, not in the
   code. `scripts/langs.js` rejects anything else.

2. Set the header fields.

   ```js
   PedalaI18n.add({
     code: "de",          // required, 2-3 lowercase letters, equals the filename
     name: "Deutsch",     // required, the native name shown in Settings
     locale: "de-DE",     // Intl locale for dates and numbers; defaults to code
     dir: "ltr",          // "ltr" (default) or "rtl"
     strings: { ... },
     // plural, tn, date, number and speech are optional; see below
   });
   ```

3. Fill `strings`. Every key is the exact English text that the app uses, and every
   value is a string. A missing key simply shows the English key, so a partial file is
   usable from the first moment.

   ```js
   strings: {
     "Ride": "Fahrt",
     "In {sec} seconds:": "In {sec} Sekunden:",
     "Settings": "Einstellungen",
   }
   ```

   Start from `lang/keys.json`; it is the list the coverage walk and `index.html`
   produce. Keys are matched after trimming, so do not add leading or trailing spaces.

4. Run the generator, which validates the module and rewrites the index:

   ```bash
   npm run langs
   ```

   It fails with a message if `code` does not match the filename, `name` is empty, a
   `strings` value is not a string, `dir` is not `ltr`/`rtl`, or an optional field has
   the wrong type. `node scripts/langs.js --check` only verifies that the index is
   current; `npm run dev` regenerates it first, and `npm test` runs the check before the
   tests.

5. Try it:

   ```bash
   npm run dev
   ```

   Open <http://localhost:8765>, go to Settings → Language and pick the language. The
   page reloads. While developing, the select is the quickest way to switch; the
   language is also chosen automatically when it matches the browser language and no
   explicit setting exists.

6. Commit both files:

   ```bash
   git add lang/de.js lang/index.json
   git commit -m "feat(i18n): add German"
   ```

   Commit a refreshed `lang/keys.json` too if you ran `npm run i18n:keys`.

## The strings table

- The key is the English source, character for character: punctuation, case and inline
  HTML included. Do not re-key or "clean up" a key.
- `{placeholder}` tokens are filled by the app. Keep every token from the key, spelled
  the same, in the translation. A token the app does not fill is left in the output
  literally, so a typo is visible in the UI.
- Values are plain strings. Inline HTML is allowed only for keys the app renders with
  `data-i18n` or `tHtml()` (see below).
- Proper nouns, units and product terms (`W`, `km`, `rpm`, `bpm`, `TSS`, `FTP`,
  `intervals.icu`, climb names) normally stay as they are; a language file is free to
  decide.
- The English plural forms are separate keys, for example `"{n} ride"` and
  `"{n} rides"`. Translate both.

## Text, markup and `data-i18n`

The app has two ways to translate text:

- **Explicit calls** in `index.html` — `t()`, `tn()`, `td()`, `tnum()` — at the place
  the text is rendered. These cover dynamic text: toasts, dialogs, canvas labels,
  buttons, generated names.
- **One pass over the static shell at boot** (`localizeDom`). It translates:
  - text nodes whose trimmed text is exactly a key, keeping the surrounding whitespace;
  - the `placeholder`, `aria-label`, `title` and `alt` attributes;
  - elements with `data-i18n="English text"`, by replacing their `innerHTML` with the
    translation.

Rules that follow from that:

- A key used through `t()` is plain text. Do not put HTML in its value; it would be
  shown literally where the app assigns it with `textContent`.
- A key used through `data-i18n` or `tHtml()` may contain inline HTML, and the
  translation must keep the same tags. For example, the English
  `... create an <b>API key</b> ...` must stay a `<b>` in the translation. The static
  pass replaces the element's whole `innerHTML`; if the translation is identical to the
  key, the markup is left untouched.
- Never put `data-i18n` on a `<label>` that wraps an `<input>`, `<select>` or
  `<textarea>`: replacing its `innerHTML` would remove the control. The label's own text
  node is translated by the text pass, which is enough for a plain label. If the prose
  inside a label contains inline tags, wrap only the prose in a
  `<span data-i18n="...">`.
- Only trusted language files supply these strings; do not build a key from user input.
- `script`, `style`, `canvas` and `noscript` content is skipped.

## Plurals

`tn(n, one, other, vars)` chooses the English one/other form, then translates the chosen
key. `{n}` is supplied automatically.

```js
tn(1, "{n} ride", "{n} rides") // uses the "{n} ride" key
tn(2, "{n} ride", "{n} rides") // uses the "{n} rides" key
```

English selects by `n === 1`. A module can change the selection with the optional
`plural(n)` function, which returns `"one"` or `"other"`, or replace the whole behaviour
with `tn(n, one, other, vars)`. Languages without plural marking can translate the two
keys to the same text, as Hungarian does with `"{n} ride"` and `"{n} rides"` both
becoming `"{n} tekerés"`.

## Dates and numbers

`td(value, opts)` and `tnum(n, opts)` use `Intl.DateTimeFormat`/`Intl.NumberFormat`
with the module's `locale`. This covers history and report dates, day labels, number
grouping and decimals. If a language needs a form `Intl` cannot produce, override
`date(ts, opts)` or `number(n, opts)`; the app calls them instead of `Intl`.

```js
date(ts, opts) { return new Intl.DateTimeFormat("de-DE", opts).format(ts); },
number(n, opts) { return new Intl.NumberFormat("de-DE", opts).format(n); },
```

## Spoken announcements

Speech is optional and separate from the UI text. English builders are built in; a
module may override any of them. The overrides are used only when the chosen
announcement voice speaks the module's language. The rule is: the announcement language
is the selected voice's language, not the UI language. If the device has no voice for
the UI language, Settings offers English voices, shows a translated notice, and the
announcements fall back to English while the UI stays translated.

The object is partial: return only what you override, and the rest stays English. All
functions return a plain string; the app speaks it.

```js
speech: {
  watts(n) { return `${n} Watt`; },
  duration(sec) { ... },              // 200 -> "3 Minuten und 20 Sekunden"
  cadence(lo, hi, any) { ... },       // any is 999; hi >= any means "or more"
  segment(seg, ctx) { ... },          // one interval, the main sentence
  lap(lap, ctx) { ... },              // a lap or interval result
  finish(route) { ... },              // route is true when a climb/route was finished
  strength(step, next) { ... },       // one guided strength step
  start() { ... },                    // spoken before the first interval
  soon(text) { ... }                  // wraps the upcoming segment sentence
}
```

Data passed to the builders:

- `watts(n)` — `n` is whole watts.
- `duration(sec)` — seconds; English returns `3 minutes`, `3 minutes and 20 seconds`.
- `cadence(lo, hi, any)` — `any` is `999` (`CAD_ANY`); when `hi >= any` the target is
  open-ended ("90 or more").
- `segment(seg, ctx)` — `seg` is
  `{ d, free, hr, loW, hiW, cad, note }`:
  - `d` seconds; `free` true for a free-riding block;
  - `hr` the heart-rate target in bpm (or undefined);
  - `loW`/`hiW` the target watts, already adjusted for the rider's intensity bias;
  - `cad` `[lo, hi]` cadence target (or undefined);
  - `note` the segment's cue text: the English key for a built-in workout, translated
    to the UI language when the voice speaks it; any other note is passed as written.
- `lap(lap, ctx)` — `lap` is
  `{ kind, km, kmLimit, dur, avgP, avgCad, avgHr, score, cadTgt }`:
  - `kind` is `"power"`, `"hr"`, `"dist"` (a distance lap) or `"free"`;
  - `km` whole kilometres, `kmLimit` the configured lap length;
  - `dur` seconds, `avgP` watts, `avgCad` rpm, `avgHr` bpm;
  - `score` percentage (or undefined), `cadTgt` `[lo, hi]` for drill laps (or
    undefined).
- `strength(step, next)` — `step` is
  `{ kind, n, s, c, r, rounds, j, of, long }`: `kind` is `"warm"`, `"work"`, `"rest"` or
  `"cool"`; `n` the English exercise name; `s` seconds; `c` the English cue key;
  `r`/`rounds` and `j`/`of` the position in the circuit; `long` marks the longer rest
  between rounds. `next` is the next non-rest step, or undefined. Rest steps have no
  `n`.
- `finish(route)` — `route` is a boolean: true when a route or climb reached the
  finish, false when a workout ended.
- `soon(text)` — `text` is the finished `segment()` sentence for the upcoming
  interval. English wraps it as `In 10 seconds: …`. Do not call `segment()` again.

`ctx` passed to `segment` and `lap` carries the module's own helpers, so a sentence can
stay consistent with the rest of the module's grammar:
`ctx.duration`, `ctx.watts`, `ctx.cadence` and `ctx.anyCad` (999).

## Finding and checking keys

`lang/keys.json` is the translator's checklist. Refresh it after English text in
`index.html` changes:

```bash
npm i --no-save playwright && npx playwright install chromium   # dev-only, once
npm run i18n:keys
```

The walker opens the app with `?i18n=keys`, which turns on the core's key recorder,
visits every view and dialog, and also collects literal `t()`/`tHtml()` calls and
`data-i18n` values that a walk may not reach. It writes a sorted key list and prints how
many came from the walk and how many from the source. It is slow and is not part of
`npm test`.

Compare each language with that list:

```bash
npm run i18n:check            # report missing, unused and untranslated keys
npm run i18n:check -- --strict  # exit 1 if any key is missing
```

- **missing** — a key in `lang/keys.json` the language does not translate; English is
  shown. `--strict` fails on these.
- **unused** — a string in the language file the app never asks for: a typo or a stale
  key. It is a warning, not a failure.
- **untranslated** — a value identical to its English key. Legitimate for units, names
  and symbols; worth a look for prose.

There is no per-language todo file: `lang/keys.json` is the only generated list, and
`i18n:check` derives the missing set from it. Do not hand-write a todo file.

## What is out of scope

These stay English on purpose; they are not translated by a language module:

- **The login page** — rendered by `middleware.js` before the app loads.
- **`gear.html`** — the phone remote, a separate local page.
- **The virtual coach's output** — `api/coach.js` asks Claude to write in English.
- **FIT and ICS metadata** — `encodeFit()` and the calendar export keep stable English
  identifiers, names and descriptions.
- **API error strings** — server-side errors stay English; the client translates only
  the known keys it displays.
- **User data** — video and music titles, imported `.zwo`/`.gpx` workout and route names
  and descriptions, ride names saved at save time, coach comments and user notes are
  shown as written and are never passed through `t()`.

Generated names are not keys either. Built-in workouts, routes and strength sessions
are marked `builtin: true` and their names/descriptions are composed from `t()`
templates (`workoutLabel`, `sessionLabel`, `sessionDesc`), so translate the templates
and the built-in names (`"Zone 2 · {time}"`, `"Brick · {min} min run"`, …), not the
finished sentence. An imported object has no `builtin` flag and is displayed unchanged.

## Testing

```bash
npm test                        # pretest checks the index, then unit and e2e
node scripts/langs.js --check   # the index is current
npm run i18n:check             # coverage report
```

The e2e suite already covers a real language (`hu`), the test-only `zz` fixture, and the
unknown/missing-language fallback. A new file needs no test changes, but run the suite:
English output is pinned, and a language module must not alter it.
