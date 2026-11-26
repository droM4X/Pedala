# English-only Pedala: cut Croatian, archive Hungarian voice

**Date:** 2026-11-26
**Status:** awaiting approval

## Intent and why

This is a personal fork (upstream: `jspisi88/Pedala`). The owner wants the app in
English only — no Croatian anywhere — and does not want a translation system now.
The one exception: the Hungarian spoken-announcement work already present in the
code is worth preserving in a separate archive file, so a future Hungarian voice
plugin can build on it instead of starting from zero.

## Goals

- The whole UI, login page, coach output and spoken announcements are English only.
- All translation machinery is deleted (no half-dead code paths).
- The existing Hungarian voice strings + number formatting are saved to a
  data-only archive file before the code that uses them is removed.

## Non-goals

- No i18n architecture, no message keys, no plugin loader in this change
  (approach A, deliberately chosen over keeping the `tr()` swap machinery).
- No behaviour changes beyond language: features, layout and data formats stay as they are.

## Constraints

- Zero-build single-file app: no bundler, no build step is introduced.
- Upstream sync: keep the diff as small as an honest excision allows, and leave
  untouched code untouched.

## Approach chosen

**A — pure excision.** Croatian strings are replaced by their existing English
counterparts (they are all already written in the `EN` map / `ui()` pairs), then
the overlay machinery (`EN`, `EN_RX`, `tr()`, `trTree`, `MutationObserver`,
`ui()`) is deleted outright.

Rejected:
- **C — keep the swap machinery as a plugin hook:** smaller conceptual diff, but
  the owner opted for clean code now over a hook that may never be used.
- **B — re-key all strings to message IDs:** proper i18n, but the largest diff and
  the worst for future upstream merges.

## Scope, file by file

1. **`index.html`**
   - Save Hungarian voice material to the archive file (below), then delete:
     the `language` block (`EN` map ~230 entries, `EN_RX`, `tr`/`trOne`/`trMemo`,
     `trEl`/`trTree`, `MutationObserver`, `UI`/`LOC`/`ui()`), `data-notr`
     attributes, and every `ui(hr, en)` call collapses to its English argument.
   - Rewrite all Croatian markup/JS literals to their existing English text
     (source of truth: the `EN` map and `ui()` pairs).
   - Settings: remove the `uiLang` row and the `voiceLang` row (speech is always
     English). Keep the voice picker (`voiceName`) and the `voice` toggle.
   - Voice code: delete `spLang`, `L()`, `NOTE_EN`/`NOTE_HU`, `huSuffix`, the hu/hr
     branches of `sayDur`/`cadSay`/`segSpeechPower`/`pickVoice`, and the hr/hu
     voice-missing warnings. Announcements read with an English voice.
   - `document.documentElement.lang = "en"`; title/comment headers in English.
2. **`middleware.js`** — English-only login page: remove `croatian()`, `t()`,
   `accept-language` branching.
3. **`api/coach.js`** — prompts rewritten in English ("Write in English…"), so
   the coach comments in English.
4. **`tests/unit.js`** — the login-language test asserts English for every
   `accept-language` (the Croatian assertion at line 23 flips).
5. **`README.md`** — drop the "Hrvatski" link; delete `README.hr.md`.
6. **New: `docs/archive/hungarian-voice.md`** — data-only archive (not loaded by
   the app): `NOTE_HU` map, Hungarian words in `sayDur`/`watts` (`perc`,
   `másodperc`, `watt`), `cadSay`/`segSpeechPower` Hungarian templates,
   `huSuffix` with its harmony table, and the original `L(hr, en, hu)` call sites
   quoted for context.

## Calls made (builder defaults, correctable)

- `voiceLang` selector is removed entirely rather than kept as auto/en — both
  options mean English anyway.
- Stale `uiLang`/`voiceLang` keys in existing users' `localStorage` are ignored
  silently; no migration.
- Croatian comments in the code are dropped along with the strings they explain.
- The archive file is markdown with verbatim code snippets, not JSON — it is
  documentation for a future human, not machine input.

## Left to the builder

Nothing open: the mechanical string replacement and deletions above.
