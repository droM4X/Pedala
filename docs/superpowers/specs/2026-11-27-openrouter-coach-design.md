# Virtual coach on OpenRouter: any model, the key on the device

**Date:** 2026-11-27
**Status:** approved by the owner
**Owner decisions:** server proxy with the key from Settings (approach A); the model must be
selectable from a dropdown; the owner's OpenRouter keys are guardrailed, so the picker must show
only the models that key may use (`/api/v1/models/user`). Measured with the owner's key on
2026-11-27: it allows `deepseek/deepseek-v4.1-flash-1017` (the design default) and
`tencent/hy4-flash`, so the default only holds while the list contains it and the picker offers
both.

## Intent and why

The virtual coach is the only part of Pedala tied to one provider: `api/coach.js` uses
`@anthropic-ai/sdk`, a single model id and Anthropic-only request features. The owner wants to
drop the npm package and call OpenRouter instead, keep the key on the device the way the
intervals.icu and YouTube keys are kept, and choose the model in Settings. The coach keeps
writing the same comments and the same plan proposals; only the provider and the model change.

## Goals

- The three coach actions (comment, weekly review, question with plan changes) work through
  OpenRouter with the current prompts and the current UI.
- The OpenRouter key is a Settings field: `localStorage`, excluded from sync, sent with each
  coach request, never stored server-side. `OPENROUTER_API_KEY` on Vercel stays the fallback.
- The model is chosen in Settings from a list fetched through the app's server: searchable,
  with price per model, saved in settings (so it syncs). The default comes from the list
  (`deepseek/deepseek-v4.1-flash-1017` for the owner's key), never from a hardcoded id that the
  key may not allow.
- The app shows the real cost of each answer (`usage.cost` from OpenRouter) instead of the
  hardcoded Opus estimate.
- A guardrailed key: the picker shows only the models that key may use (`/api/v1/models/user`),
  so the owner never chooses one the guardrail would refuse.
- `@anthropic-ai/sdk` and every `ANTHROPIC_*` reference are gone; README, Settings text,
  i18n keys + Hungarian, and the test fake follow.

## Non-goals

- No model per action (one model for comments, reviews and questions).
- No streaming, no prompt caching, no browser-direct calls to OpenRouter.
- No per-model prompt tuning; the prompts are shared and model-neutral.
- No management key and no guardrail editing; the app only reads the key's effective list.

## Constraints

- Zero build, vanilla JS, Node 20, Vercel serverless functions; no new runtime dependency
  (plain `fetch`).
- English text in the code is the i18n key; Hungarian goes in `lang/hu.js`; `npm run i18n:check`
  and `npm test` must pass.
- The coach needs the server for its prompts and for intervals.icu, so it never runs without
  the API; no offline fallback is needed.
- `middleware.js` already puts a login in front of `/api/*`; the new endpoint inherits it.

## Approaches considered

- **A. Server proxy, key from Settings (chosen).** Prompts stay in `api/coach.js`; the key is
  pasted in Settings, kept in `localStorage`, sent per request, with `OPENROUTER_API_KEY` as the
  fallback. Smallest change that meets every request.
- **B. Server proxy, key only on Vercel.** Same code without the Settings field: a key change
  needs a redeploy, and all profiles share one key. Does not meet the request.
- **C. Browser calls OpenRouter directly.** The key would never leave the device, but all
  prompts and data trimming (~350 lines) move into `index.html`, error handling is duplicated,
  and the Vercel key option is lost. Bigger rewrite for the same result.

## What the provider allows (checked 2026-11-27)

- `POST https://openrouter.ai/api/v1/chat/completions` is OpenAI-compatible:
  `choices[0].message.content`, `usage: { prompt_tokens, completion_tokens, cost, … }`.
  `usage.cost` is the real charged amount and is always returned.
- `GET https://openrouter.ai/api/v1/models` is public (verified: it answers 200 with a bogus
  key too), 477 entries, 381 without `:batch`; each has `pricing.prompt/completion` (per token,
  strings), `context_length`, `supported_parameters`, `architecture`, `endpoints`.
  320 models support `structured_outputs`, 277 `reasoning`.
- `GET https://openrouter.ai/api/v1/models/user` takes a Bearer key and returns only what that
  key can use: filtered by the account's provider preferences, privacy settings and guardrails
  (text-output models by default; same model shape as above). This is the picker's source.
- Structured output: `response_format: { type: "json_schema", json_schema: { name, strict,
  schema } }`. Support is per endpoint, not per model, so the answer is always parsed
  tolerantly and `provider.require_parameters` is not used (it turns a mismatch into a hard
  "no endpoints" error).
- Reasoning: `reasoning: { effort: "low", exclude: true }` maps to Anthropic's effort; models
  that only accept `reasoning_effort` get that instead; models with neither get no reasoning
  field at all.
- `anthropic/claude-opus-5.5` costs the same through OpenRouter as directly ($4/$20 per M);
  `deepseek/deepseek-v4.1-flash` is $0.05/$0.20 per M, so a comment is about 0.1 cent. Prices are
  per key and move: the owner's key showed `deepseek/deepseek-v4.1-flash-1017` at $0.04/$0.10 and
  later $0.07/$0.30 per M. The picker shows what the list says, never a built-in price table.
- Errors come as `{ error: { message, code, metadata: { raw, provider_name,
  provider_error_code } } }`; `metadata.raw` names the provider and the real reason and is the
  most useful text to show.
- OpenRouter can pass an upstream provider limit through as 429 even when the key is healthy
  (measured: `deepseek/deepseek-v4.1-flash-1017` on the shared Sail Research pool answered 429
  `ttft_deadline_guard` for a plain "Say hi", while `/key` showed a $0.25 daily budget with 0
  spent). It is transient: the app says "busy, try again", and the live check is retried later
  rather than treated as a build failure.

### The model list is the key's own list

`/api/v1/models/user` is called with the same key the coach uses, so a guardrailed key only ever
sees models it may run: no full public catalogue, no guessing. Without a key the endpoint
answers 401; the picker then says a key is needed and keeps the last list it had.

Choosing the model, in this order: the saved `settings.coachModel` if it is in the list; else
`deepseek/deepseek-v4.1-flash-1017` if it is; else the list's only entry; else nothing, and the
picker asks the athlete to choose (the coach stays off until then). A list of exactly one (the
owner's key today) is therefore adopted silently and saved.

If the saved model is not in the list (a guardrail changed, or the choice was synced from a
device with another key), the picker shows it as unavailable with that explanation instead of
silently switching. A 403 from a real coach call (for example a content filter inside the
guardrail) keeps its own clear message.

## Design

### `api/coach.js` — the provider call

Same module, same three actions, same prompts (`SYSTEM`, `SYSTEM_ASK`, `SYSTEM_WEEK`) and the
same intervals.icu context building. Replace the SDK block:

- Key: `b.orKey` (from the request) or `process.env.OPENROUTER_API_KEY`; no key → 501 with the
  message that points at Settings.
- Model: `b.model` or `DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash-1017"`.
- `GET /api/coach` → `{ enabled: !!process.env.OPENROUTER_API_KEY }` (the client knows about a
  device key itself).
- Body: `{ model, messages: [{role:"system",content:system},{role:"user",content}],
  max_tokens: 4000 }`.
- Capabilities come with the request, from the list the picker already has:
  `caps: { maxCompletion: bool, reasoning: "reasoning" | "reasoning_effort" | null, schema: bool }`.
  `maxCompletion` sends `max_completion_tokens` instead of `max_tokens`; `reasoning` adds
  `{ effort: "low", exclude: true }` (or `reasoning_effort: "low"`); `schema` adds
  `response_format` for the `ask` action. No capabilities (missing or malformed) → the
  conservative body: `max_tokens`, no reasoning, prompt-only JSON. So the coach needs no second
  request and no shared cache with `api/models.js`, and a models outage cannot break commenting.
- A 400 that names one of the optional fields (a stale hint) is retried once with the
  conservative body.
- Without `schema`, the `ask` system prompt gains a short "return only this JSON" line.
- Headers: `Authorization: Bearer …`, `HTTP-Referer` and `X-Title: Pedala` (attribution).
- Answer: read `choices[0].message.content`; `finish_reason: "length"` → 502 "the answer was cut
  off"; empty → 502 as today. For `ask`, parse tolerantly (strip fences, take the first
  balanced object) and keep the existing session/workout validation.
- Usage: `{ input: prompt_tokens, output: completion_tokens, usd: usage.cost }`; with no
  `cost`, `usd: null` and no cost tag (no estimate is invented).
- Errors: 401 → "OpenRouter rejected the API key"; 402 → no credits (keeps the app's 12-hour
  pause); 403 → the guardrail refused the request, with the provider message; 404 → unknown
  model; 429 → busy; anything else → 502 with the provider message, trimmed to 300 characters.

### When the coach stops on its own

The automatic runs (comment after a session, Saturday review, `coachCheck`) keep their guards,
and a failure that only a Settings change can fix pauses them: `coachPause` stays the numeric
timestamp it is (so old saved values still work), with `coachPauseWhy` beside it. 402 sets 12
hours and `"credit"` as today; 401, 403 and 404 set `"settings"` and no automatic run happens
until the key or the model is saved, which clears both. A question the athlete types, and
"Weekly review now", still run — the athlete asked, and they see the error. Error notes keep
their 12-hour retry, which the pause makes harmless.

### `api/models.js` — the list for the picker

`POST /api/models { orKey }` → `{ default, models: [{ id, name, in, out, ctx, structured }] }`,
where `default` is the id to preselect when nothing is saved (the design's default id if the
list has it, else the list's only entry, else null):

- Resolve the key the way the coach does (`orKey`, else `OPENROUTER_API_KEY`); no key → 409
  `{ error: "noKey" }` and the picker asks for one.
- Call `/api/v1/models/user` with that key (`output_modalities=text`), drop `:batch` ids and
  anything without `/api/v1/chat/completions` in `endpoints`.
- `in` / `out`: $ per million tokens (`0.0000000507` → `0.05`), `structured` from
  `supported_parameters`.
- POST, not GET, so the key never sits in a URL or a log; `cache-control: no-store`.
  Module-level cache for ten minutes keyed by a hash of the key, so two profiles with two keys
  never see each other's list.
- On an OpenRouter 401 the endpoint returns 401 (the picker says the key was rejected); other
  failures are 502 with the provider message, and the picker keeps the last list it had.
- The browser keeps the last list per key in `localStorage` and offers a refresh; the list is
  per key, so it is not synced.

### Settings → Virtual coach (`index.html`)

- **OpenRouter API key**: text input + Save, like the intervals.icu key; stored as
  `settings.orKey`; added to `SYNC_SKIP`; sent as `orKey` in every coach request. Saving it
  clears `coachPause`/`coachPauseWhy` and loads the model list.
- **Status line**: on/off, and which key is in use (this device or Vercel) and which model.
- **Model**: a search field above a `<select>` grouped by provider, fed by `/api/models` with
  the key in use, label `Name — $0.05 / $0.20 per M`; the chosen id is `settings.coachModel`
  (synced, not in `SYNC_SKIP`). If the saved model is not in the key's list, it is shown
  marked "not available with this key" and the coach stays off until another is chosen. The
  picker's states are: no key ("add a key to see the models"), key rejected, list loading,
  list, list failed with the last cached list shown.
- **Answers carry the model's capabilities**: the coach request includes
  `caps: { maxCompletion, reasoning, schema }` read from the selected entry of the list, so the
  server does not look them up again. No list → no caps → the conservative body.
- The coach box, the weekly review, the retry button and the monthly total stay; the per-answer
  cost is now the real figure (4 decimals below a cent, 2 above) and the month uses the same
  formatting.
- `coachServer` becomes `!!settings.orKey || serverEnabled`.
- Remove the `console.anthropic.com` instruction; the note names Settings and OpenRouter.

### The key and the backup

`exportBackup()` serialises all of `settings`, which would put the key in a downloadable file.
It omits `orKey`, and the import ignores it, so the OpenRouter key never leaves the device — not
to the server, not in a backup. (The free YouTube key and the intervals.icu key keep their
current behaviour.) **My call, easy to change:** keeping it would match the other two keys; I
chose to leave the paid key out.

### Cost and history

Old notes keep the `usd` they were saved with (estimated Opus prices). New notes carry the real
cost. Nothing is migrated.

Coach output follows the interface language as of 2026-11-27: the app sends the resolved UI
language, and comments, weekly reviews and answers are written in it.

### Files touched

- `api/coach.js` (provider call, model, usage, errors).
- `api/models.js` (new).
- `index.html` (Settings section, picker, key, status, caps in the request bodies, pause,
  cost format, texts, `SYNC_SKIP`, `exportBackup`/import).
- `lang/hu.js` + `lang/keys.json` (regenerated) for the new and changed strings.
- `tests/support/server.js`: fake `https://openrouter.ai` (a key-scoped model list, chat
  completions with `choices` + `usage.cost`, a 403 that names the guardrail, the JSON answer for
  `response_format` requests), and `api/models.js` in the `api` map.
- `tests/e2e.js`: the three coach tests move to the new fake and new assertions; new ones for
  the key on the device, the picker listing only the key's models and filtering as you type, the
  real cost tag, the message when no key is set, a 403 pausing the automatic runs until the key
  is saved again, and a backup that does not contain the key.
- `tests/unit.js`: tolerant JSON parsing, price formatting, model list trimming and error
  mapping.
- `package.json`, `package-lock.json`, `bun.lock`: drop `@anthropic-ai/sdk`.
- `README.md`: env table (`OPENROUTER_API_KEY`), coach paragraph, model choice.

### How it is proven

- `npm test` green: i18n check, unit, e2e.
- e2e: with `OPENROUTER_API_KEY` set the coach comments on a saved ride and on a run from
  intervals.icu, and does not comment Pedala's own upload; a question returns an answer, the
  proposed change applies only on confirm, and the cost tag shows the fake's `usage.cost`;
  with only `settings.orKey` set the coach still runs and the request carries the key; the
  picker lists only the fake's key-scoped models; picking a model saves it and the next request
  uses it; with no key at all the coach and the picker say a key is needed; a 403 from the fake
  shows the guardrail message.
- Manual: paste a real key, pick a model, ask a question, read the cost. The owner's key is at
  `~/.config/pedala/openrouter.env` (outside the repo); load it with
  `node --env-file="$HOME/.config/pedala/openrouter.env"`. A provider 429 is transient; retry
  later.

## Left to the builder

- Copy of the new Settings texts (English source + Hungarian), within the existing style.
- How the filtered list is drawn (a native select with a filter input, or a small combobox);
  either way it stays keyboard-usable and shows the price.
