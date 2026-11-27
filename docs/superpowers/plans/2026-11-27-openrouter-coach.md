# Virtual Coach on OpenRouter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the virtual coach from `@anthropic-ai/sdk` to OpenRouter, keep its prompts and UI, let the owner pick from the models their key may use, and store the key on the device like the intervals.icu key.

**Architecture:** `api/coach.js` keeps every prompt and the intervals.icu context, and swaps the SDK call for one `fetch` to `/api/v1/chat/completions`; the model and its capabilities travel in the request from the client, so no state is shared between serverless functions. A new `api/models.js` proxies `/api/v1/models/user` with the user's key (a POST, so the key never sits in a URL) and trims the list to chat models with prices. `index.html` gains a key field, a model picker and a real-cost display.

**Tech Stack:** Vanilla JS classic scripts, Node 20 serverless functions on Vercel, `fetch`, Playwright/Chromium e2e, Node `assert` unit tests.

**Spec:** `docs/superpowers/specs/2026-11-27-openrouter-coach-design.md` — read it first; this plan argues from it.

## Global Constraints

- Zero build, no new runtime dependency. `@anthropic-ai/sdk` is removed and nothing replaces it.
- English text in `index.html` inline JS is the i18n key; new UI strings go through `PedalaI18n.t()` / `tHtml()`. Hungarian goes in `lang/hu.js`.
- Every new or changed coach API carries the key as `orKey` in the POST body, never in a URL. The key is never written to a file in the repo, a log, a backup or the sync.
- The key for live checks is `$HOME/.config/pedala/openrouter.env` (`OPENROUTER_API_KEY=…`); load it with `node --env-file="$HOME/.config/pedala/openrouter.env"`. Never copy it into the repo or into a test fixture.
- `npm test` must pass after every task: `tests/i18n.js`, `tests/unit.js`, `tests/e2e.js` (e2e needs `npm i --no-save playwright && npx playwright install chromium`).
- The default model id is `deepseek/deepseek-v4.1-flash-1017`; it only ever applies when the key's own list contains it (or the list has exactly one entry).
- `api/*.js` are CommonJS modules exporting one `(req, res)` handler; `req.body` is already parsed JSON. Responses set `cache-control: no-store`.

## Review Focus

- A model answer with `usage.cost` missing → the request still succeeds, `usd` is `null`, and no cost tag is shown (never `$0.0000`, never a crash).
- The key's list holding one model, zero models, or many → the picker preselects the saved model, else the design default if allowed, else the only entry, else nothing with the coach off; it never selects a model the key cannot use.
- A saved model that has dropped out of the key's list (guardrail change, choice synced from another device) → the coach is off with a clear message, and nothing silently switches.
- Two profiles with two keys on one deployment → one key's list never appears for the other (server cache keyed by a hash of the key).
- A provider 429 (transient upstream limit) → "busy, try again later", a manual retry works, and it is not treated as a permanent block.

---

### Task 1: `api/models.js` — the key's own model list

**Files:**
- Create: `api/models.js`
- Test: `tests/unit.js` (new section after the `api/coach.js` section)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `POST /api/models` with body `{ orKey?: string }` →
  - `200 { default: string|null, models: [{ id, name, priceIn, priceOut, ctx, caps: { mc: boolean, reasoning: "reasoning"|"reasoning_effort"|null, schema: boolean } }] }`
  - `409 { error: "noKey" }`, `401 { error: "OpenRouter rejected the API key" }`, `405`, `502 { error: string }`.
  - `priceIn`/`priceOut` are US dollars per million tokens, rounded to 3 significant digits; `ctx` is `context_length`; `caps.mc` means the model takes `max_completion_tokens` (and not `max_tokens`).

- [ ] **Step 1: Write the failing unit tests**

In `tests/unit.js`, after the `api/coach.js` section, add:

```js
/* ---------- api/models.js ---------- */
delete process.env.OPENROUTER_API_KEY;
const models = require("../api/models.js");
const callModels = async body => { let out; await models({ method: "POST", body }, { setHeader(){}, status(c){ this.c = c; return this; }, json(o){ out = { status: this.c, body: o }; } }); return out; };
const orModel = (id, prompt, completion, params, endpoints = ["/api/v1/chat/completions"]) => ({
  id, name: id.toUpperCase(), context_length: 32000, pricing: { prompt, completion },
  supported_parameters: params, endpoints, architecture: { output_modalities: ["text"] } });

await test("models: no key is 409, a rejected key is 401", async () => {
  assert.equal((await callModels({})).status, 409);
  global.fetch = async () => new Response(JSON.stringify({ error: { message: "No auth credentials found" } }), { status: 401 });
  try{ assert.equal((await callModels({ orKey: "sk-bad" })).status, 401); }
  finally{ global.fetch = realFetch; }
});
await test("models: only chat models of the key's list, with prices and caps", async () => {
  let sent;
  global.fetch = async (url, opt) => { sent = { url: String(url), auth: opt.headers.Authorization }; return new Response(JSON.stringify({ data: [
    orModel("deepseek/deepseek-v4.1-flash-1017", "0.00000004", "0.0000001", ["max_tokens", "reasoning", "structured_outputs"]),
    orModel("acme/plain", "0.000001", "0.000002", ["max_completion_tokens"]),
    orModel("acme/batch:batch", "0.00001", "0.00002", ["max_tokens"]),
    orModel("acme/image", "0.00001", "0.00002", ["max_tokens"], ["/api/v1/images"]),
  ] }), { status: 200 }); };
  try{
    const r = await callModels({ orKey: "sk-good-models" });
    assert.equal(r.status, 200);
    assert.equal(sent.url, "https://openrouter.ai/api/v1/models/user?output_modalities=text");
    assert.equal(sent.auth, "Bearer sk-good-models");
    assert.deepEqual(r.body.models.map(m => m.id), ["deepseek/deepseek-v4.1-flash-1017", "acme/plain"]);
    assert.deepEqual(r.body.models[0], { id: "deepseek/deepseek-v4.1-flash-1017", name: "DEEPSEEK/DEEPSEEK-V4.1-FLASH-1017", priceIn: 0.04, priceOut: 0.1, ctx: 32000,
      caps: { mc: false, reasoning: "reasoning", schema: true } });
    assert.deepEqual(r.body.models[1].caps, { mc: true, reasoning: null, schema: false });
    assert.equal(r.body.default, "deepseek/deepseek-v4.1-flash-1017");
  }finally{ global.fetch = realFetch; }
});
await test("models: the default follows the list, and a list of one is the default", async () => {
  const answer = data => { global.fetch = async () => new Response(JSON.stringify({ data }), { status: 200 }); };
  try{
    answer([orModel("a/one", "0.1", "0.2", ["max_tokens"]), orModel("b/two", "0.1", "0.2", ["max_tokens"])]);
    assert.equal((await callModels({ orKey: "sk-two" })).body.default, null);
    answer([orModel("a/only", "0.1", "0.2", ["max_tokens"])]);
    assert.equal((await callModels({ orKey: "sk-one" })).body.default, "a/only");
  }finally{ global.fetch = realFetch; }
});
await test("models: the list is cached per key, not across keys", async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return new Response(JSON.stringify({ data: [orModel("a/x", "0.1", "0.2", ["max_tokens"])] }), { status: 200 }); };
  try{
    await callModels({ orKey: "sk-cache-a" }); await callModels({ orKey: "sk-cache-a" });
    assert.equal(calls, 1, "the same key is fetched once");
    await callModels({ orKey: "sk-cache-b" });
    assert.equal(calls, 2, "another key is its own list");
  }finally{ global.fetch = realFetch; }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --no-warnings tests/unit.js 2>&1 | grep -A3 "models:"`
Expected: FAIL — `Cannot find module '../api/models.js'`.

- [ ] **Step 3: Implement `api/models.js`**

`module.exports = async (req, res)`; `cache = new Map()` from a key hash (Node `crypto.createHash("sha256")`, first 16 hex chars) to `{ at, body }` with a 10-minute lifetime. Behaviour the tests pin:

- Non-POST → 405 `{ error: "Only POST is allowed" }`.
- `b.body` may be a JSON string; parse defensively as `api/coach.js` does.
- Key = `String(b.orKey || process.env.OPENROUTER_API_KEY || "").trim()`; empty → 409 `{ error: "noKey" }`.
- `GET https://openrouter.ai/api/v1/models/user?output_modalities=text` with `Authorization: Bearer <key>`; a 401 → our 401 `{ error: "OpenRouter rejected the API key" }`; another non-OK or a network error → 502 with `error.metadata.raw || error.message` (trimmed to 300).
- Keep an entry when `!m.id.endsWith(":batch")`, `(m.endpoints || []).includes("/api/v1/chat/completions")` and `(m.architecture?.output_modalities || []).includes("text")`.
- `priceIn = +(Number(m.pricing?.prompt) * 1e6).toPrecision(3)`, same for `priceOut` (a missing price is `null`); `ctx = m.context_length ?? null`.
- `caps.mc = params.includes("max_completion_tokens") && !params.includes("max_tokens")`; `caps.reasoning = params.includes("reasoning") ? "reasoning" : params.includes("reasoning_effort") ? "reasoning_effort" : null`; `caps.schema = params.includes("structured_outputs")`.
- `default` = the constant `deepseek/deepseek-v4.1-flash-1017` if present, else the only id if `models.length === 1`, else `null`.
- Cache stores the finished body; `res.setHeader("cache-control", "no-store")` always.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --no-warnings tests/unit.js 2>&1 | grep -E "models:|FAIL"` → four `ok models:` lines, no FAIL. Then `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add api/models.js tests/unit.js
git commit -m "feat(coach): add /api/models, the key's own model list"
```

---

### Task 2: The coach speaks OpenRouter (backend + test fake)

**Files:**
- Modify: `api/coach.js` (the SDK block, `claude()`, `usage()`, `apiError()`; keep every prompt and all intervals.icu code)
- Modify: `tests/support/server.js:1-20, 63-78, 115-125`
- Modify: `tests/unit.js:105-133` (the coach section)
- Modify: `tests/e2e.js:639-691` (the three coach tests)
- Modify: `index.html:2339-2340` (only the two `fillCoach` status strings for now)

**Interfaces:**
- Consumes: nothing from Task 1 at runtime (no shared cache); its model list uses the same shapes.
- Produces: `POST /api/coach` accepts `{ action, orKey?, model?, caps?: { mc?: boolean, reasoning?: "reasoning"|"reasoning_effort"|null, schema?: boolean }, … }`; `GET /api/coach` → `{ enabled: boolean }` (env key only). Every answer returns `{ …, model, usage: { input, output, usd } }` where `usd` is `usage.cost` or `null`.
- Test fake: `srv.openrouter` (array of chat request bodies, newest last), `srv.openrouterAuth` (their `Authorization` headers, same order), `srv.setOpenRouter(patch)` where `{ reset: true }` restores the defaults and `models`/`cost`/`fail` patch them (defaults: two chat models — the flash and `acme/plain-model` — plus a `:batch` duplicate and a non-chat model that must be filtered; `cost: 0.02`, `fail: null`).

- [ ] **Step 1: Write the failing unit tests**

Replace the coach section in `tests/unit.js` (keep the `callCoach`, `coachRide` helpers and `realFetch`):

```js
await test("coach: off without OPENROUTER_API_KEY", async () => {
  delete process.env.OPENROUTER_API_KEY;
  assert.deepEqual((await callCoach("GET")).body, { enabled: false });
  assert.equal((await callCoach("POST", { action: "comment", ride: coachRide })).status, 501);
});
await test("coach: capabilities shape the request, and cost becomes usd", async () => {
  process.env.OPENROUTER_API_KEY = "sk-test"; let sent;
  global.fetch = async (url, opt) => { sent = { url: String(url), body: JSON.parse(opt.body), auth: opt.headers.Authorization };
    return new Response(JSON.stringify({ model: "m", choices: [{ message: { content: "Good workout." }, finish_reason: "stop" }], usage: { prompt_tokens: 3000, completion_tokens: 400, cost: 0.0004 } }), { status: 200 }); };
  try{
    const r = await callCoach("POST", { action: "comment", ride: coachRide, notes: "190 cm", model: "acme/x",
      caps: { mc: true, reasoning: "reasoning_effort", schema: true } });
    assert.equal(r.status, 200); assert.equal(r.body.text, "Good workout.");
    assert.equal(sent.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(sent.auth, "Bearer sk-test"); assert.equal(sent.body.model, "acme/x");
    assert.equal(sent.body.max_completion_tokens, 4000); assert.equal(sent.body.max_tokens, undefined);
    assert.equal(sent.body.reasoning_effort, "low");
    assert.equal(sent.body.reasoning, undefined);
    assert.equal(sent.body.response_format, undefined, "a comment never asks for JSON");
    assert.match(sent.body.messages[1].content, /190 cm/); assert.match(sent.body.messages[1].content, /Sweet spot/);
    assert.deepEqual(r.body.usage, { input: 3000, output: 400, usd: 0.0004 });
  }finally{ global.fetch = realFetch; delete process.env.OPENROUTER_API_KEY; }
});
await test("coach: without caps the body is conservative and a schema answer still parses", async () => {
  process.env.OPENROUTER_API_KEY = "sk-test"; let sent;
  const out = { answer: "Rest today.", changes: [{ session_id: "w1-tue", action: "skip", workout_id: null, reason: "cold" }] };
  global.fetch = async (url, opt) => { sent = JSON.parse(opt.body);
    return new Response(JSON.stringify({ model: "m", choices: [{ message: { content: "```json\n" + JSON.stringify(out) + "\n```" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 }); };
  try{
    const r = await callCoach("POST", { action: "ask", question: "I have a cold", plan: { sessions: [{ id: "w1-tue" }], options: [] } });
    assert.equal(r.status, 200); assert.equal(r.body.answer, "Rest today."); assert.equal(r.body.changes.length, 1);
    assert.equal(sent.max_tokens, 4000); assert.equal(sent.reasoning, undefined); assert.equal(sent.response_format, undefined);
    assert.match(sent.messages[0].content, /Return only JSON/); assert.match(sent.messages[1].content, /I have a cold/);
    assert.deepEqual(r.body.usage, { input: 10, output: 5, usd: null }, "no cost, no invented price");
  }finally{ global.fetch = realFetch; delete process.env.OPENROUTER_API_KEY; }
});
await test("coach: 402, 403, 404 and 429 are told apart", async () => {
  process.env.OPENROUTER_API_KEY = "sk-test";
  const fail = (status, message) => { global.fetch = async () => new Response(JSON.stringify({ error: { message, code: status } }), { status }); };
  try{
    fail(402, "Insufficient credits"); assert.equal((await callCoach("POST", { action: "comment", ride: coachRide })).status, 402);
    fail(403, "Request blocked: model not allowed by your guardrail");
    const blocked = await callCoach("POST", { action: "comment", ride: coachRide });
    assert.equal(blocked.status, 403); assert.match(blocked.body.error, /guardrail/);
    fail(404, "No endpoints found for model"); assert.equal((await callCoach("POST", { action: "comment", ride: coachRide })).status, 404);
    fail(429, "Provider returned error");
    const busy = await callCoach("POST", { action: "comment", ride: coachRide });
    assert.equal(busy.status, 429); assert.match(busy.body.error, /busy/i);
  }finally{ global.fetch = realFetch; delete process.env.OPENROUTER_API_KEY; }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --no-warnings tests/unit.js 2>&1 | grep -E "coach:|FAIL"` → the new coach tests FAIL (still Anthropic, no caps).

- [ ] **Step 3: Rewrite the provider block in `api/coach.js`**

Keep `SYSTEM`, `SYSTEM_ASK`, `SYSTEM_WEEK`, `ASK_SCHEMA`, `icuContext`, `icu`, `trimRide`, `trimIcuActivity`, `pick`, `section`, and the three action functions' context building. Change only:

- `const MODEL = "deepseek/deepseek-v4.1-flash-1017"` → `DEFAULT_MODEL`; a helper `keyOf(b) = String(b.orKey || process.env.OPENROUTER_API_KEY || "").trim()`.
- `GET` → `{ enabled: !!process.env.OPENROUTER_API_KEY }`.
- After the action checks: no key → 501 `{ error: "Coach is not enabled: add an OpenRouter API key in Settings, or OPENROUTER_API_KEY on Vercel." }`.
- `orChat({ key, model, caps, system, content, schema })`:
  - body `{ model: model || DEFAULT_MODEL, messages: [{ role: "system", content: system }, { role: "user", content }], max_tokens: 4000 }`;
  - `caps.mc` → drop `max_tokens`, set `max_completion_tokens: 4000`;
  - `caps.reasoning === "reasoning"` → `reasoning: { effort: "low", exclude: true }`; `"reasoning_effort"` → `reasoning_effort: "low"`;
  - `caps.schema` and a schema argument → `response_format: { type: "json_schema", json_schema: { name: "coach_answer", strict: true, schema } }`;
  - headers: `Authorization`, `content-type`, `HTTP-Referer: https://<host>` (from `req.headers.host`, default `pedala.vercel.app`), `X-Title: Pedala`;
  - a non-OK 400 that carried any optional field is retried once with `{ max_tokens: 4000 }` only; every other status throws.
- `ask()` passes `schema: ASK_SCHEMA` only when `caps?.schema`; otherwise it appends to the system prompt: `\n\nReturn only a JSON object with this shape: {"answer": string, "changes": [{"session_id": string, "action": "replace" | "skip" | "restore", "workout_id": string | null, "reason": string}]}`.
- The refusal branch becomes `finish_reason === "content_filter"` → 422 with the existing per-action wording; empty text → 502 as now.
- `parseJson(text)` (`tests/unit.js` covers the fenced form): trim, strip a leading ```` ```json ```` fence and a trailing fence, try `JSON.parse`, else slice from the first `{` to the last `}` and try again, else `null`.
- `usage(j)` → `{ input: u.prompt_tokens || 0, output: u.completion_tokens || 0, usd: typeof u.cost === "number" ? u.cost : null }`.
- `apiError(res, e)`: switch on `e.status`; 401 `"OpenRouter rejected the API key"`, 402 `"The OpenRouter account has no credit. Add credit at openrouter.ai/settings/credits."`, 403 → the provider message (usually the guardrail), 404 `"Unknown model: <model>"`, 429 `"The coach is busy right now; try again later"`, otherwise 502 with the provider message (prefer `error.metadata.raw`) trimmed to 300.
- Delete the `@anthropic-ai/sdk` require and every Anthropic branch.

- [ ] **Step 4: Replace the Anthropic fake with an OpenRouter fake in `tests/support/server.js`**

- Route `https://openrouter.ai` to `fakeOpenRouter(url, opt)`; delete `fakeClaude` and the `claude` array, and export `openrouter` instead.
- `GET /api/v1/models/user`: `Authorization` must start with `Bearer sk-` and not be `Bearer sk-bad` (else 401 `{ error: { message: "No auth credentials found" } }`); return `{ data: or.models }`.
- `POST /api/v1/chat/completions`: parse the body into `openrouter` and its `Authorization` header into `openrouterAuth`; if `or.fail`, answer that status with `{ error: { message: "Provider returned error", code: status } }`; if `body.response_format` or the user content contains `## The athlete's message`, answer
  `{ model, choices: [{ message: { content: JSON.stringify({ answer: "Rest and do an easy recovery session instead of this workout.", changes: [{ session_id: <first id in the plan>, action: "replace", workout_id: "p-rec", reason: "cold" }, { session_id: "w99-xyz", action: "skip", workout_id: null, reason: "does not exist" }] }) }, finish_reason: "stop" }], usage: { prompt_tokens: 5000, completion_tokens: 300, cost: or.cost } }`;
  otherwise the comment `"Good workout. Your heart rate is steady; keep it up."` with `usage: { prompt_tokens: 3000, completion_tokens: 400, cost: or.cost }`.
- Default `or = { models: [deepseek flash entry, acme/plain entry, one `:batch`, one non-chat], cost: 0.02, fail: null }`; expose `srv.openrouter` and `srv.setOpenRouter(patch)` that replaces the given fields and restores the defaults on `{ reset: true }`.
- Register `models: require("../../api/models.js")` in the `api` map.

- [ ] **Step 5: Move the three coach e2e tests to the new fake**

In `tests/e2e.js`:
- `srv.setEnv({ ANTHROPIC_API_KEY: … })` → `srv.setEnv({ OPENROUTER_API_KEY: "sk-test" })`; `srv.claude.length = 0` → `srv.openrouter.length = 0`; reset the fake at the start of each coach test with `srv.setOpenRouter({ reset: true })`.
- The ride test asserts `ride.model === "deepseek/deepseek-v4.1-flash-1017"`, no `ride.fallbacks`, `ride.max_tokens === 4000`, and `ride.messages[1].content` contains the notes, `po_minutama`, and `Jutarnje trčanje`; the status line matches `/coach is on.*OPENROUTER_API_KEY/` for now.
- The question test asserts `sent.response_format === undefined` (the app sends no caps yet), that `sent.messages[0].content` asks for JSON, that the answer and its one valid change appear, and that the cost tag reads `≈ $0.02` and the month line `≈ $0.0…`.
- The plan test keeps its behaviour assertions; replace `plain.output_config.effort === "low"` with `plain.max_tokens === 4000`, `plain.reasoning === undefined` and `plain.reasoning_effort === undefined` (the conservative body, since no caps are sent yet).

- [ ] **Step 6: Update the two `fillCoach` strings in `index.html`**

On (env key): `"The coach is on (OPENROUTER_API_KEY is set on Vercel). Other activities also need an intervals.icu key."`
Off: `"The coach is off. Add an OpenRouter API key in Settings (or OPENROUTER_API_KEY on Vercel)."`

- [ ] **Step 7: Run everything**

Run: `npm test` → i18n, unit and e2e all green.

- [ ] **Step 8: Commit**

```bash
git add api/coach.js index.html tests/support/server.js tests/unit.js tests/e2e.js
git commit -m "feat(coach): run the coach on OpenRouter"
```

---

### Task 3: The key lives on the device

**Files:**
- Modify: `index.html:604` area (Settings markup), `index.html:2149-2350` (coach state and requests), `index.html:2041-2055` (`exportBackup`/`importBackup`), `index.html:2746` (`SYNC_SKIP`)
- Test: `tests/e2e.js` (new test after the question test)

**Interfaces:**
- Consumes: `POST /api/coach` accepting `orKey`; `GET /api/coach` returning `{ enabled }`.
- Produces: `settings.orKey` (localStorage, not synced), `coachKey()`, `coachAuth()` returning `{ orKey?: string }` with the key only when present; `#coach-key`, `#btn-coach-key`.

- [ ] **Step 1: Write the failing e2e test**

```js
await test("coach: the key from Settings travels with every request and stays out of the backup", async () => {
  srv.setEnv({ OPENROUTER_API_KEY: null }); srv.setOpenRouter({ reset: true }); srv.openrouter.length = 0;
  const p = await open({ settings: { ftp: 160, maxHr: 185, weight: 100, coachMode: "off" } });
  await p.click('[data-view="settings"]'); await p.fill("#coach-key", "sk-device"); await p.click("#btn-coach-key"); await p.waitForTimeout(600);
  assert.match(await p.textContent("#coach-status"), /key on this device/i);
  await p.evaluate(() => coachAsk("ride:r-key", { ride: { id: "r-key", name: "Key ride", start: new Date().toISOString(), m: { duration: 900 } } }, "Key ride", Date.now()));
  assert.equal(srv.openrouterAuth.at(-1), "Bearer sk-device", "the device key is the one OpenRouter sees");
  assert.equal(await p.evaluate(() => coachNotes()["ride:r-key"].text), "Good workout. Your heart rate is steady; keep it up.");
  assert.equal(await p.evaluate(() => "orKey" in publicSettings()), false, "the key never syncs");
  const exported = await p.evaluate(async () => {
    const orig = URL.createObjectURL; let text = "";
    URL.createObjectURL = b => { b.text().then(t => text = t); return "blob:x"; };
    await exportBackup(); URL.createObjectURL = orig;
    await new Promise(r => setTimeout(r, 50)); return text;
  });
  assert.doesNotMatch(exported, /sk-device/); assert.match(exported, /"ftp":160/);
  await p.context().close();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/e2e.js 2>&1 | grep -A3 "key from Settings"`
Expected: FAIL — `#coach-key` not found.

- [ ] **Step 3: Add the Settings field and the key plumbing**

- Markup after the coach note (before `#coach-status`):
  ```html
  <label class="note" style="display:block;max-width:520px">OpenRouter API key (kept on this device)
    <input id="coach-key" type="text" autocomplete="off" spellcheck="false" placeholder="sk-or-v1-…" style="display:block;width:100%;margin-top:5px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--text);font:inherit">
  </label>
  <div class="dlg-acts" style="justify-content:flex-start;margin:8px 0"><button class="btn small" id="btn-coach-key" type="button">Save and check</button></div>
  ```
- `let coachServer = false` stays (env key); add `const coachKey = () => (settings.orKey || "").trim();` and change `coachServer` into a function or keep the flag and set `coachOn()` to use `coachEnabled()`:
  ```js
  const coachEnabled = () => coachServer || !!coachKey();
  ```
  Replace every `coachServer` test in `coachOn`, `coachWeek`, `renderCoachBox`, `renderRepCoach` with `coachEnabled()`; leave the flag updated by `fillCoach`'s `GET /api/coach`.
- `const coachAuth = () => (coachKey() ? { orKey: coachKey() } : {});` and add `...coachAuth()` to the four `fetch("/api/coach", …)` bodies (comment, list, ask, week uses `coachAsk`, so two places).
- `#btn-coach-key` (and Enter in `#coach-key`): `settings.orKey = value.trim(); store.set("settings", settings);` then clear `coachPause`/`coachPauseWhy`, `fillCoach()`, and reload the model list (Task 4 adds the call; until then, `renderCoachViews()`).
- `fillCoach()` shows the key state: with a device key "The coach is on (key on this device)…", with only the env key the current wording, with neither the off text.
- `#coach-key` is filled in `fillSettings()`/`fillCoach()` with `settings.orKey`.
- `SYNC_SKIP` gains `"orKey"`; `publicSettings()` then never sends it.
- `exportBackup`: build `settings: Object.fromEntries(Object.entries(settings).filter(([k]) => k !== "orKey"))`.
- `importBackup`: before `Object.assign(settings, data.settings)`, `delete data.settings.orKey` and keep the device's current key.

- [ ] **Step 4: Run the tests**

Run: `node tests/e2e.js 2>&1 | grep -E "key from Settings|FAIL"` → the new test passes; fix the two-part backup assertion so it reads the exported blob once.

- [ ] **Step 5: Add the missing-key e2e test**

```js
await test("coach: without a key on the device or on Vercel the coach and the picker say so", async () => {
  srv.setEnv({ OPENROUTER_API_KEY: null });
  const p = await open({ settings: { coachMode: "each" } });
  await p.click('[data-view="settings"]'); await p.waitForTimeout(400);
  assert.match(await p.textContent("#coach-status"), /add an OpenRouter API key/i);
  await p.click('[data-view="progress"]'); await p.waitForSelector("#coach-box");
  assert.equal(await p.locator("#coach-form").isHidden(), true);
  await p.context().close();
});
```

Run: `npm test` → green.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/e2e.js
git commit -m "feat(coach): keep the OpenRouter key on the device"
```

---

### Task 4: The model picker

**Files:**
- Modify: `index.html` (Settings markup, coach state, `coachAsk`/`coachWeek`/`coachCheck`/`coachQuestion` bodies, `renderCoachBox`/`renderRepCoach`, `fillCoach`)
- Test: `tests/e2e.js`

**Interfaces:**
- Consumes: `POST /api/models` (Task 1 shape), `settings.orKey` (Task 3), `caps` in `POST /api/coach` (Task 2).
- Produces: `settings.coachModel`, `coachModels` (the current key's list, an array), `coachModel()`, `coachCaps()`, `loadCoachModels(force)`, `coachAuth()` now returns `{ orKey?, model?, caps? }`; elements `#coach-search`, `#coach-model`, `#coach-model-note`.

- [ ] **Step 1: Write the failing e2e tests**

```js
await test("coach: the picker lists only the key's models, filters, and the pick travels with the next call", async () => {
  srv.setEnv({ OPENROUTER_API_KEY: "sk-test" }); srv.setOpenRouter({ reset: true }); srv.openrouter.length = 0;
  const p = await open({ settings: { coachMode: "off" } });
  await p.click('[data-view="settings"]'); await p.waitForTimeout(700);
  const ids = await p.evaluate(() => [...document.querySelectorAll("#coach-model option")].map(o => o.value).filter(Boolean));
  assert.deepEqual(ids, ["deepseek/deepseek-v4.1-flash-1017", "acme/plain-model"]);
  assert.equal(await p.evaluate(() => coachModel()), "deepseek/deepseek-v4.1-flash-1017", "the default is adopted");
  assert.match(await p.textContent("#coach-model"), /\$0\.04 \/ \$0\.1/);
  await p.fill("#coach-search", "acme"); await p.waitForTimeout(200);
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#coach-model option")].map(o => o.value).filter(Boolean)), ["acme/plain-model"]);
  await p.selectOption("#coach-model", "acme/plain-model"); await p.waitForTimeout(400);
  assert.equal(await p.evaluate(() => settings.coachModel), "acme/plain-model");
  await p.evaluate(() => coachAsk("ride:r-model", { ride: { id: "r-model", name: "M", start: new Date().toISOString(), m: { duration: 900 } } }, "M", Date.now()));
  const sent = srv.openrouter.at(-1);
  assert.equal(sent.model, "acme/plain-model");
  assert.equal(sent.max_tokens, 4000); assert.equal(sent.reasoning, undefined); assert.equal(sent.reasoning_effort, undefined);
  await p.context().close();
});
await test("coach: a saved model the key no longer allows turns the coach off", async () => {
  srv.setEnv({ OPENROUTER_API_KEY: "sk-test" }); srv.setOpenRouter({ reset: true });
  const p = await open({ settings: { coachMode: "each", coachModel: "gone/model" } });
  await p.click('[data-view="settings"]'); await p.waitForTimeout(700);
  assert.match(await p.textContent("#coach-model-note"), /not available with this key/i);
  assert.equal(await p.evaluate(() => coachModel()), "gone/model", "no silent switch");
  await p.click('[data-view="progress"]'); await p.waitForSelector("#coach-box");
  assert.equal(await p.locator("#coach-form").isHidden(), true);
  await p.context().close();
});
await test("coach: a key whose list is empty shows it and keeps the coach off", async () => {
  srv.setEnv({ OPENROUTER_API_KEY: "sk-test" }); srv.setOpenRouter({ reset: true, models: [] });
  const p = await open({ settings: { coachMode: "each" } });
  await p.click('[data-view="settings"]'); await p.waitForTimeout(700);
  assert.match(await p.textContent("#coach-model-note"), /No models for this key/i);
  assert.equal(await p.evaluate(() => coachOn()), false);
  await p.context().close();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node tests/e2e.js 2>&1 | grep -A3 -E "picker lists|no longer allows"` → FAIL, `#coach-model` missing.

- [ ] **Step 3: Add the picker markup and state**

- Markup under the key field:
  ```html
  <label class="note" style="display:block;max-width:520px">Model
    <input id="coach-search" type="search" placeholder="Search models" autocomplete="off" style="…same input style…">
    <select id="coach-model" style="…same select style as #coach-mode…"></select>
  </label>
  <p class="note" id="coach-model-note"></p>
  ```
- State: `let coachModels = [];` (the current key's list), `const coachModel = () => settings.coachModel || "";`
  `const coachCaps = () => coachModels.find(m => m.id === coachModel())?.caps || null;`
- Cache the list per key fingerprint in `store` (`"coachList"` = `{ fp, at, list, default }`, where `fp` is a small djb2 hash of the key, never the key) with a one-hour life; `loadCoachModels(force)` POSTs `/api/models` with `{ orKey }`, fills `coachModels`, renders, and resolves the model:
  saved if in the list → else `body.default` → else nothing. Persist a change to `settings.coachModel` and `store.set("settings")`. On 409/401/502 show the matching note text and keep the last cached list.
- Call `loadCoachModels()` when Settings opens with a key present, when a key is saved, and on `visibilitychange` if older than an hour; render options grouped by the id's author (`id.split("/")[0]`) with label `Name — $in / $out per M` (`Name` from the API, price via `numFixed(price, 2)`), an empty `<option value="">Choose a model</option>` when there is no choice, and mark a saved model missing from the list with a synthesized option labelled `id (not available with this key)`.
- `#coach-search` filters `coachModels` by id/name (case-insensitive substring) and re-renders; if the selected model is filtered out, keep it selected.
- `coachAuth()` → `{ ...(coachKey() ? { orKey: coachKey() } : {}), ...(coachModel() ? { model: coachModel() } : {}), ...(coachCaps() ? { caps: coachCaps() } : {}) }`.
- `coachEnabled()` also requires a usable model when a list is loaded and the saved model is missing from it: `if(!coachModel()) return false; if(coachModels.length && !coachModels.some(m => m.id === coachModel())) return false;`
- `#coach-model-note` states: "Models are loading…", "No models for this key.", "This model is not available with this key. Choose another model.", "The key was rejected by OpenRouter.", "Add an OpenRouter API key to see the models." (empty when all is well).
- `fillCoach()` shows "(/api/coach) on" only when `coachEnabled()`, and the `#coach-status` line names the model.

- [ ] **Step 4: Run the tests**

Run: `node tests/e2e.js 2>&1 | grep -E "picker lists|no longer allows|list is empty|FAIL"` → all three pass. Run `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/e2e.js
git commit -m "feat(coach): choose the model from the key's own list"
```

---

### Task 5: Pause on refusals, real cost display

**Files:**
- Modify: `index.html:2149-2205` (pause), `index.html:2230-2245` (`usdTag`, month), `index.html:2170-2200` (error handling)
- Test: `tests/e2e.js`

**Interfaces:**
- Consumes: coach responses with statuses 401/402/403/404/429 (Task 2), `usage.usd` (Task 2).
- Produces: `coachPaused()`; store keys `coachPause` (timestamp, credit) and `coachPauseWhy` (`"credit"|"settings"`); `usdTag` with 4 decimals below one cent.

- [ ] **Step 1: Write the failing e2e test**

```js
await test("coach: a refusal pauses the automatic comments until the key is saved again, and a tiny cost shows four decimals", async () => {
  srv.setEnv({ OPENROUTER_API_KEY: "sk-test" }); srv.setOpenRouter({ reset: true, cost: 0.0004 }); srv.openrouter.length = 0;
  const p = await open({ settings: { coachMode: "each", coachModel: "deepseek/deepseek-v4.1-flash-1017" } });
  await p.click('[data-view="settings"]'); await p.waitForTimeout(600);
  srv.setOpenRouter({ fail: 403 });
  await p.evaluate(() => coachAsk("ride:r-pause", { ride: { id: "r-pause", name: "P", start: new Date().toISOString(), m: { duration: 900 } } }, "P", Date.now()).catch(() => {}));
  assert.equal(await p.evaluate(() => store.get("coachPauseWhy")), "settings");
  assert.equal(await p.evaluate(() => coachOn()), false, "automatic comments stop");
  srv.setOpenRouter({ fail: null, cost: 0.0004 }); srv.openrouter.length = 0;
  await p.fill("#coach-key", "sk-device"); await p.click("#btn-coach-key"); await p.waitForTimeout(600);
  assert.equal(await p.evaluate(() => store.get("coachPauseWhy")), null, "saving the key clears the pause");
  await p.evaluate(() => coachAsk("ride:r-cost", { ride: { id: "r-cost", name: "C", start: new Date().toISOString(), m: { duration: 900 } } }, "C", Date.now()));
  await p.click('[data-view="progress"]'); await p.waitForTimeout(400);
  assert.match(await p.textContent("#coach-list"), /≈ \$0\.0004/);
  await p.context().close();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/e2e.js 2>&1 | grep -A3 "pauses the automatic"` → FAIL (no `coachPauseWhy`, cost shows `$0.000`).

- [ ] **Step 3: Implement**

- `const coachPaused = () => store.get("coachPauseWhy") === "settings" || Date.now() <= store.get("coachPause", 0);`
  Use `!coachPaused()` in `coachOn()` and in `coachWeek`'s guard (replacing the two `Date.now() > store.get("coachPause", 0)` checks).
- In `coachAsk`'s catch/response: 402 → `store.set("coachPause", Date.now() + 12 * 36e5); store.set("coachPauseWhy", "credit");`
  401/403/404 → `store.set("coachPause", 0); store.set("coachPauseWhy", "settings");`
  Do the same in `coachQuestion`'s error path. Saving the key (and, in Task 4, the model) clears both: `store.set("coachPause", 0); store.set("coachPauseWhy", null);` (`store` has no delete; `null` reads back as `null`).
- `fillCoach` states the pause: credit → "The coach is paused: the OpenRouter account has no credit."; settings → "The coach is paused: OpenRouter refused the request. Check the key and the model."
- `usdTag = usd => usd != null ? \`<p …>≈ $${numFixed(usd, usd < 0.01 ? 4 : 2)}</p>\` : ""`.
- The month line keeps `numFixed(month, 2)`.

- [ ] **Step 4: Run everything**

Run: `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/e2e.js
git commit -m "feat(coach): pause on a refusal and show the real cost"
```

---

### Task 6: Remove the SDK, docs, Hungarian, live check

**Files:**
- Modify: `package.json`, `package-lock.json`, `bun.lock`, `README.md`, `index.html` (any leftover Anthropic text), `lang/hu.js`, `lang/keys.json`

**Interfaces:**
- Consumes: everything above.
- Produces: a repository with no `@anthropic-ai` and no `ANTHROPIC` mention, green `npm test`, and `npm run i18n:check` clean.

- [ ] **Step 1: Remove the dependency**

`npm uninstall @anthropic-ai/sdk` (this rewrites `package.json` and `package-lock.json`), then `bun install` to refresh `bun.lock`. Verify with `grep -ri anthropic --exclude-dir=node_modules --exclude-dir=.git .` → only the spec and plan mention it historically; no code.

- [ ] **Step 2: Update the README**

- The environment table: remove `ANTHROPIC_API_KEY`; add `OPENROUTER_API_KEY` — "OpenRouter API key for the virtual coach (optional). The key can also be pasted in Settings, where it stays on that device. A small monthly limit on the key is a good idea."
- The coach bullet: "works with any model the key may use; the model is chosen in Settings", no "6 cents" claim, and one sentence that the key's guardrail decides the list.

- [ ] **Step 3: Refresh the i18n keys and add Hungarian**

Run: `npm run i18n:keys` (needs Playwright) → commits a refreshed `lang/keys.json`. Then add every missing key to `lang/hu.js` with a natural Hungarian sentence (the new Settings texts, the picker notes, the pause lines, the cost tag line if new). Run `npm run i18n:check` → 0 missing, 0 unused for `hu`.

- [ ] **Step 4: Live check (needs the key, not part of `npm test`)**

```bash
node --env-file="$HOME/.config/pedala/openrouter.env" -e '
const m = require("./api/models.js");
m({ method: "POST", body: {} }, { setHeader(){}, status(c){ this.c = c; return this; }, json(o){ console.log(this.c, JSON.stringify(o).slice(0, 400)); } });
'
```
Expected: 200 with the two models the owner's key allows. Then, on the deployed app (or with `vercel dev`), paste the key in Settings, pick the model, ask the coach a question and read the cost. A `429 Provider returned error` from the upstream model is transient: note it and retry later; it is not a build failure.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json bun.lock README.md index.html lang/keys.json lang/hu.js
git commit -m "chore(coach): drop the Anthropic SDK, document OpenRouter, translate the new texts"
```
