# English-only Pedala Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Croatian from the entire app — UI, login, coach, tests, docs — leaving English as the only language, with the existing Hungarian voice work archived for future reuse.

**Architecture:** Pure excision (approach A in the spec): every Croatian string is replaced by its already-written English counterpart (source of truth: the `EN` map, `ui(hr, en)` and `L(hr, en, hu)` call sites), then all translation machinery (`EN`, `EN_RX`, `tr*`, `trTree`, `MutationObserver`, `ui()`, `L()`, `spLang`) is deleted outright. No i18n layer, no plugin loader — only a data-only archive of the Hungarian voice material.

**Tech Stack:** Vanilla JS in a zero-build single-file PWA (`index.html`), Vercel middleware (`middleware.js`), serverless API (`api/`), Playwright e2e (`tests/e2e.js`), Node unit tests (`tests/unit.js`).

**Spec:** `docs/superpowers/specs/2026-11-26-english-only-design.md` — read it first; this plan argues from it.

## Global Constraints

- Zero-build: no new dependencies, no bundler, no build step (Playwright is installed `--no-save`, the repo's existing practice per `tests/e2e.js:2`).
- No behaviour or feature changes beyond language; untouched code stays untouched.
- English source of truth is what already exists in the code: the `EN` map entries, the 2nd arg of `ui()`, the 2nd arg of `L()` — copy those, do not re-translate.
- The Hungarian voice material is archived **before** any code that contains it is modified (spec, Scope item 6).
- `docs/archive/hungarian-voice.md` is documentation, not machine input: verbatim code snippets + the e2e assertions that pin them.
- Commit after every task.

## Review Focus

1. **Croatian text still visible anywhere** (any view, riding, report) — pinned by the existing e2e text-scan test, repurposed to scan unconditionally (Task 3, Step 6).
2. **Runtime-composed strings leaking Croatian** (`EN_RX` shapes: `cilj`, `od`, `do`, `na`, `kilometar`, `sekundi`, `vata`…) — pinned by the riding-state scan in that same e2e test plus the diacritics/word grep audits (Task 3, Step 5).
3. **Settings save crashing on removed fields** (`f.uiLang`, `f.voiceLang`) — pinned by the settings e2e tests and the grep audit for `uiLang|voiceLang` (Task 3, Steps 4–6).
4. **Existing user with stale localStorage** (`uiLang: "hr"`, `voiceLang: "hu"`) must start English with no console error — pinned by a new e2e test (Task 3, Step 6).
5. **Voice still works English-only** (test button, announcements, YouTube ducking) — pinned by the kept English voice e2e tests (Task 3, Step 6).
   Login in English for Croatian browsers — pinned by `tests/unit.js` (Task 2).

---

### Task 1: Archive the Hungarian voice material

**Files:**
- Create: `docs/archive/hungarian-voice.md`

**Interfaces:**
- Consumes: nothing. Produces: nothing later tasks rely on (this file is data-only documentation).

- [ ] **Step 1: Collect the verbatim material into the archive**

Copy the following **verbatim** (they are deleted in Task 3; this is the only preserved copy):
- `NOTE_HU` object — `index.html:1509–1510`
- `huSuffix(n)` with its harmony tables and comment — `index.html:1522–1528`
- Every `L(hr, en, hu)` call site with its hu argument — `index.html:1449, 1453, 1469, 1476–1478, 1482–1483, 1506, 1517, 1530–1533, 1658, 1957, 2919, 2926–2927` (grep `L(` to not miss any)
- The `hu` branches of `sayDur` (`perc`, `másodperc`, join `" "`) — `index.html:1512–1515`
- The `lapResult` Hungarian lap sentence (`kilométer`) — `index.html:1476–1478`
- The Hungarian voice-missing settings note (Android install instructions) — `index.html:1555`
- The `voiceLang`/`isHu`/`pickVoice` hu-selection logic — `index.html:1491–1504`
- The deleted Hungarian voice e2e tests, as behavior documentation: `tests/e2e.js` blocks asserting `/perc/`, `/Magas kadencia/`, `/pulzuson/`, `/kilométer/`, `/Magyar/` (lines ~85–137)

Structure the file: intro line ("Hungarian spoken-announcement work removed from the English-only fork; reference for a future voice plugin"), then sections with the snippets grouped as above, each with its original file:line.

- [ ] **Step 2: Verify the archive is complete**

Run: `grep -ciE "pulzuson|perc|másodperc|kadencia|kilométer" docs/archive/hungarian-voice.md`
Expected: ≥ 20 matches. Run: `grep -c "huSuffix" docs/archive/hungarian-voice.md` → ≥ 2.

- [ ] **Step 3: Commit**

```bash
git add docs/archive/hungarian-voice.md
git commit -m "docs: archive the Hungarian voice-announcement work before removing it"
```

### Task 2: English-only login page (`middleware.js`) + unit test

**Files:**
- Modify: `middleware.js`
- Test: `tests/unit.js:23`

**Interfaces:**
- Consumes: nothing. Produces: `middleware.js` with no `croatian()`/`t()`; unit test asserting English for every `accept-language`.

- [ ] **Step 1: Flip the unit test to expect English**

In `tests/unit.js:23`, change the assertion to `/Log in/` and the message to `"English for a Croatian browser"`. Keep the `accept-language: hr-HR…` header — it now proves the hr branch is gone.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --no-warnings tests/unit.js`
Expected: FAIL — the middleware still renders "Lozinka" for hr.

- [ ] **Step 3: Make the login page English-only**

In `middleware.js`: delete `croatian()` (`:66`), the `hr` variable and its uses; in `loginPage()` replace every `${t("hr", "en")}` with the English text and `lang="${t("hr","en")}"` with `lang="en"`; delete the `t` helper; drop the `accept-language` wording from the header comment (`:9`). The JSON 401 body (`:52`) becomes always `"Login required"`.

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `node --no-warnings tests/unit.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add middleware.js tests/unit.js
git commit -m "login: English only, drop the Croatian accept-language branch"
```

### Task 3: English-only `index.html` + e2e updates

**Files:**
- Modify: `index.html` (markup, JS strings, settings form, voice code), `tests/e2e.js`
- Test: full suite via `npm test`

**Interfaces:**
- Consumes: the English strings already present as the 2nd arg of `ui()`/`L()` and the values of the `EN` map (both still in `index.html` at task start; the archive from Task 1 covers only Hungarian, so do this task in one sitting).
- Produces: `index.html` with `ui()` gone, `L()` gone, `tr()`/`trTree`/`EN`/`EN_RX` gone, no `uiLang`/`voiceLang` form fields; speech functions `sayDur`, `watts`, `cadSay`, `segSpeech`, `segSpeechPower`, `lapResult` English-only; `say()` without language warnings.

- [ ] **Step 1: Collapse every `ui(hr, en)` and `L(hr, en, hu)` call to its English argument**

`ui("A", "B")` → `"B"`; `L("A", "B", "C")` → `"B"`; `ui(\`A${x}\`, \`B${x}\`)` → `` `B${x}` ``. 42 `ui()` sites and the ~15 `L()` sites listed in Task 1. Do it with targeted edits; multi-line calls (e.g. `index.html:2696–2719` workout descriptions) get the same treatment.

Verify: `grep -cE "\b(ui|L)\(" index.html` counts only foreign matches (e.g. `URL(`) — `ui(` must be 0; re-grep after each batch. The helpers `ui`/`L` themselves are deleted in Step 3.

- [ ] **Step 2: Script-apply the `EN` map to the whole file, longest keys first**

Write a throwaway script `/tmp/enify.mjs`: read `index.html`; slice out the object literal between `const EN = new Map(Object.entries({` and the matching `}));` (the `language` block starting at the `/* ============ language ============` comment, `:734`); `eval` the literal to get the pairs; sort keys by descending length; replace every key with its value across the **whole file** using `split/join` (no regex). Leave the machinery block in place for now (it is deleted in Step 3; its keys must not be replaced inside itself — exclude the block's line range from the replacement).

Run it, then audit: `grep -nE "[čćžšđ]" index.html` → only the machinery block and intentionally-Croatian data remain (route names like `Biokovo`, `Učka`, `Sljeme` keep their proper names — the spec keeps geography as proper nouns; they are `data-notr`/`EN`-value text like "Biokovo – Sveti Jure (park entrance)").

- [ ] **Step 3: Delete the translation machinery and the language settings**

Delete in `index.html`: the whole `language` block from `/* ============ language ============` down to (and including) the `MutationObserver` close, ending before the `/* heart-rate zones … */` comment (`:734–1064`); `const UI`, `LOC`, `ui`; replace `document.documentElement.lang = UI` with `document.documentElement.lang = "en"`; `<html lang="hr"` → `<html lang="en"` (`:2`). Delete `data-notr` attributes (grep → 0). Delete the `uiLang` row (`:579`) and the `voiceLang` row (`:590`); fix the settings-save handler and the language-change toast (`:3217`) so nothing reads `f.uiLang`/`f.voiceLang` (grep `uiLang|voiceLang` → 0 outside `settings.uiLang`-free defaults).

- [ ] **Step 4: Make the voice code English-only**

Delete `spLang`, `NOTE_EN`, `NOTE_HU`, `huSuffix`, `isHr`/`isHu` (keep `isEn`), the hr/hu branches of `sayDur`/`watts`/`cadSay`/`segSpeechPower`/`pickVoice` (`:1491–1533`), the two voice-missing warnings in `say()` (`:1540–1541`), and the hu/hr branches of `fillVoices` (`:1547–1559` — the note becomes simply "Announcements are in <b>English</b> (voice name)." or the no-voice message). `#btn-voice-test` (`:1957`) keeps the exact English sentence `"In 10 seconds: 3 minutes at 265 watts, cadence 90 to 100."` — an e2e test asserts it. Delete `plural()` if the grep shows no remaining callers.

- [ ] **Step 5: Fix the `EN_RX` shapes at their emitting code, then audit**

The 43 `EN_RX` patterns (deleted in Step 3) marked Croatian strings composed at runtime. For each, grep the literal fragments (`cilj`, `sekundi`, `kilometar`, `vat`, `kadenca`, `od `, `do `, `na `, `za `) to find the code that built that shape (e.g. the lap name `` `Dionica ${S.laps.length + 1}` `` at `:1456`, the `${spoken(st)}, ${st.s} sekundi.` at `:2927`) and rewrite each to build the English string directly — copy the pattern's English replacement from the deleted `EN_RX` rule.

Audit: `grep -nE "[čćžšđ]" index.html` → **0 matches**; `grep -nE "\bcilj\b|sekundi|vata\b|kadenca|kilometar|\bDionica\b" index.html` → 0 matches.

- [ ] **Step 6: Update the e2e suite**

In `tests/e2e.js`:
- `open()` default `locale: "hr-HR"` → `"en-US"` (`:17`).
- Delete the Hungarian voice tests asserting `/perc/`, `/Magas kadencia/`, `/pulzuson/`, `/kilométer/`, `/Magyar/` (`:85–137`) — their content lives on in the archive.
- Keep the English voice test ("In 10 seconds: 3 minutes at 265 watts, cadence 90 to 100.") and the ducking assertions; delete its Croatian-voice half (`:158–161`) and the `voices: [["Google hrvatski"…]]` opener variants.
- Repurpose the "English: a browser in English…" test (`:184–188`): drop the `uiLang`-switching block and the "Treninzi" assertion; make the Croatian-regex text scan run on the default (unmodified) app across all views + riding + report, asserting zero Croatian anywhere; keep the `left` array assertion. Rename it "English everywhere, in every browser".
- Add a regression test: `open({ settings: { uiLang: "hr", voiceLang: "hu" }, voices: [["Samsung English", "en-US"]] })` → `[data-view="workouts"]` reads "Workouts", `#btn-voice-test` speaks English, no `pageErrors` (stale localStorage is ignored).

- [ ] **Step 7: Run the full suite**

Run: `npm i --no-save playwright && npx playwright install chromium && npm test`
Expected: PASS — unit + e2e, zero failures, zero page errors.

- [ ] **Step 8: Commit**

```bash
git add index.html tests/e2e.js
git commit -m "app: English only — remove the Croatian base language and all translation machinery"
```

### Task 4: English-only coach prompts (`api/coach.js`)

**Files:**
- Modify: `api/coach.js`

**Interfaces:**
- Consumes: nothing. Produces: coach comments written in English; no code signature changes (the API surface and JSON schema stay identical).

- [ ] **Step 1: Translate the three system prompts to English**

Rewrite `SYSTEM` (`:20`), `SYSTEM_ASK` (`:39`), `SYSTEM_WEEK` (`:58`) in natural English — same rules, same lengths, same fields. Key sentence: "Write in English, warm and direct, second person singular." Drop the Croatian grammatical gender rule (no grammatical gender in English); keep the respect-notes/no-diagnosis/no-guessing rules verbatim in meaning. Update the header comment (`:1`).

- [ ] **Step 2: Verify no Croatian remains and tests still pass**

Run: `grep -niE "hrvatsk|na hrvatskom" api/coach.js` → 0 matches. Run: `node --no-warnings tests/unit.js` → PASS.

- [ ] **Step 3: Commit**

```bash
git add api/coach.js
git commit -m "coach: prompts and comments in English"
```

### Task 5: README cleanup + repo-wide audit

**Files:**
- Modify: `README.md`
- Delete: `README.hr.md`

**Interfaces:**
- Consumes: nothing. Produces: a repo with no Croatian anywhere outside `docs/archive/hungarian-voice.md` and git history.

- [ ] **Step 1: Clean the docs**

Delete `README.hr.md`; remove the `*[Hrvatski](README.hr.md)*` line from `README.md`. Check `manifest.webmanifest`, `sw.js`, `qr.js`, `gear.html`, `lib/`, `api/`, `tests/` for Croatian: `grep -rniE "[čćžšđ]" --exclude-dir=node_modules --exclude-dir=.git .` → only `docs/archive/` (and the route/proper-name whitelist if any survived Step 2's audit — investigate each).

- [ ] **Step 2: Run the full suite one last time**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md && git rm README.hr.md
git commit -m "docs: English only, drop the Croatian README"
```
