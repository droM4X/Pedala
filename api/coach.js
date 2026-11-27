// Virtual coach: a short comment on one training session, written by OpenRouter in the athlete's interface language.
// The key comes from the device (Settings, sent as orKey) or OPENROUTER_API_KEY on Vercel; without either the coach is off.
// Context comes from intervals.icu (INTERVALS_API_KEY on Vercel, or the key the app sends): the last six weeks of
// activities and wellness.
//   GET  /api/coach                                    -> { enabled: true | false }   (the Vercel key only)
//   POST /api/coach { action: "list", icuKey }         -> { activities: [...] }   intervals.icu, last 10 days
//   POST /api/coach { action: "comment", icuKey, notes, athlete, ride | icuId } -> { text, model, usage }
//     ride:  a ride recorded in Pedala (summary, laps, minute-by-minute power, cadence and heart rate)
//     icuId: any activity on intervals.icu (runs and swims from a watch, outdoor rides…)
//   POST /api/coach { action: "week", icuKey, notes, athlete, plan, rides } -> { text, model, usage }   review of the last seven days (Saturdays)
//   POST /api/coach { action: "ask", icuKey, notes, athlete, question, chat, plan, rides, comments }
//     -> { answer, changes: [{ session_id, action: "replace" | "skip" | "restore", workout_id, reason }], model, usage }
//     a question outside a session; changes to the plan are only proposals, the app applies them when the athlete confirms
// The model and its capabilities come with the request (from the list the picker already has), so no state is
// shared between serverless functions and a models outage cannot break commenting.
const { profile } = require("../lib/session.js");

const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash-1017";
const OR = "https://openrouter.ai/api/v1";
const ICU = "https://intervals.icu/api/v1";
const DAY = 864e5;

const SYSTEM = `You are a personal coach (endurance and strength: cycling, running, swimming, and at-home strength training) in the Pedala app. After a workout, the athlete sends you data, and you write a short comment as a coach who knows them.

Comment on:
- how the workout went compared with what it was meant to be (the plan, interval goal, type of workout);
- what the data actually shows: power, heart rate and how it changes during the workout, cadence or pace, in the context of recent weeks and fitness;
- one or two specific tips for the coming days.

Rules:
- Write in the athlete's interface language, stated at the end of the message, warm and direct, second person singular.
- Do not repeat numbers the athlete can already see unless they are meaningful; avoid generic phrases.
- Respect the athlete's notes (limitations, goals, and decisions already made) and do not pressure them to go against those notes.
- If anything suggests a risk of injury, illness, or overtraining, say so clearly; do not diagnose.
- If there is not enough data to draw a conclusion, do not guess.
- Length: 80 to 160 words, plain text with no heading or markdown, no more than three short paragraphs.`;

const SYSTEM_ASK = `You are a personal coach (endurance and strength: cycling, running, swimming, and at-home strength training) in the Pedala app. The athlete writes to you outside a workout: with a question, to say how they feel, or to request a plan change. You have their plan for this week, their recent workouts, fitness, your earlier comments, and the conversation so far.

Answer (the answer field):
- Write in the athlete's interface language, stated at the end of the message, warm and direct, second person singular; no more than 150 words, plain text with no markdown.
- Be specific to their situation and respect their notes and decisions.
- If there are signs of illness, injury, or pain, advise rest and, when needed, a doctor; do not diagnose.

Plan changes (the changes field):
- Propose changes only when the athlete asks for one or when one is clearly needed (illness, fatigue, travel); otherwise return an empty list.
- session_id must be one of the listed sessions in the plan, and workout_id must be one of the listed possible workouts (or null).
- The session's stanje field uses English status values such as done, skipped, missed, "optional, not done", today, and upcoming.
- replace: replace a session with another (workout_id); skip: skip it (e.g. illness, or replacing it with a run or swim outside Pedala; workout_id null); restore: restore the original session (workout_id null).
- Do not change sessions that have already been completed; reason should briefly explain why.
- In your answer, say what you propose: changes are applied only after the athlete confirms them in the app.`;

const SYSTEM_WEEK = `You are a personal coach (endurance and strength: cycling, running, swimming, and at-home strength training) in the Pedala app. Every Saturday, write the athlete a review of the past seven days.

Review:
- what was completed compared with the plan and how consistent the athlete was (optional sessions do not count as missed);
- how their sports (cycling, running, swimming, strength training) are progressing, based on the data (power, heart rate, pace, training load, completed strength sessions);
- fitness and recovery: fitness, fatigue, sleep, resting heart rate, and HRV, when available;
- what to watch for next week, with one or two specific tips for upcoming workouts.

Rules: Write in the athlete's interface language, stated at the end of the message, warm and direct, second person singular; respect the athlete's notes and decisions; if there are signs of injury, illness, or overtraining, say so clearly without diagnosing; do not guess when data is missing. Each session's stanje field uses English status values such as done, skipped, missed, "optional, not done", today, and upcoming. Length: 120 to 220 words, plain text with no heading or markdown, no more than four short paragraphs.`;

const ASK_SCHEMA = { type: "object", additionalProperties: false, required: ["answer", "changes"], properties: {
  answer: { type: "string" },
  changes: { type: "array", items: { type: "object", additionalProperties: false, required: ["session_id", "action", "workout_id", "reason"], properties: {
    session_id: { type: "string" }, action: { type: "string", enum: ["replace", "skip", "restore"] },
    workout_id: { anyOf: [{ type: "string" }, { type: "null" }] }, reason: { type: "string" } } } } } };

/* added to SYSTEM_ASK when the model has no structured output: the answer still has to be that JSON */
const JSON_ONLY = `\n\nReturn only JSON in this shape: {"answer": string, "changes": [{"session_id": string, "action": "replace" | "skip" | "restore", "workout_id": string | null, "reason": string}]}`;

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const enabled = !!process.env.OPENROUTER_API_KEY;
  if(req.method === "GET") return res.status(200).json({ enabled });
  if(req.method !== "POST") return res.status(405).json({ error: "Only GET and POST are allowed" });
  let b = req.body || {};
  if(typeof b === "string"){ try{ b = JSON.parse(b); }catch{ return res.status(400).json({ error: "Invalid JSON" }); } }
  const icuKey = profile(req).icuKey || b.icuKey || null;   // each profile has its own intervals.icu
  try{
    if(b.action === "list"){
      if(!icuKey) return res.status(200).json({ activities: [] });
      const acts = await icu(icuKey, `/athlete/0/activities?oldest=${ymd(Date.now() - 10 * DAY)}&newest=${ymd(Date.now() + DAY)}`);
      return res.status(200).json({ activities: (Array.isArray(acts) ? acts : []).map(a => ({
        id: String(a.id), type: a.type || "", name: a.name || "", start: a.start_date_local || "", external_id: a.external_id || null,
        minutes: a.moving_time ? Math.round(a.moving_time / 60) : null })) });
    }
    if(!["comment", "ask", "week"].includes(b.action)) return res.status(400).json({ error: "Unknown action" });
    const key = keyOf(b);
    if(!key) return res.status(501).json({ error: "Coach is not enabled: add an OpenRouter API key in Settings, or OPENROUTER_API_KEY on Vercel." });
    const ctx = { key, model: b.model, caps: b.caps, host: req.headers?.host };
    if(b.action === "ask") return await ask(b, icuKey, res, ctx);
    if(b.action === "week") return await week(b, icuKey, res, ctx);
    if(!b.ride && !b.icuId) return res.status(400).json({ error: "No session to comment on" });

    // what the coach looks at; intervals.icu parts are optional (no key, or the service is down)
    const parts = [];
    parts.push(section("Athlete", { ...pick(b.athlete || {}, ["ftp", "maxHr", "weight"]), danas: ymd(Date.now()) }));
    if(b.notes) parts.push(`## Athlete notes\n${String(b.notes).slice(0, 2000)}`);
    let exclude = null;
    if(b.ride){ parts.push(section("Session to comment on (Pedala, indoor trainer)", trimRide(b.ride))); exclude = b.ride.id; }
    if(icuKey){
      const icuCtx = await icuContext(icuKey, b.icuId);
      if(b.icuId){
        if(!icuCtx.one) return res.status(404).json({ error: "Session not found on intervals.icu" });
        parts.push(section("Session to comment on (intervals.icu)", trimIcuActivity(icuCtx.one)));
        if(b.planned) parts.push(section("What the plan called for that day", b.planned));
      }
      parts.push(...icuCtx.parts(a => String(a.id) !== String(b.icuId) && (!exclude || a.external_id !== exclude)));
    } else if(b.icuId) return res.status(401).json({ error: "An intervals.icu key is required for intervals.icu sessions" });

    const j = await orChat({ ...ctx, system: SYSTEM, content: parts.join("\n\n") + "\n\nWrite a comment.\n\n" + langLine(b.lang) });
    const cut = cutOff(j); if(cut) return res.status(502).json({ error: cut });
    if(j.choices?.[0]?.finish_reason === "content_filter") return res.status(422).json({ error: "The coach did not write a comment this time" });
    const text = messageText(j).trim();
    if(!text) return res.status(502).json({ error: "The coach returned an empty comment" });
    return res.status(200).json({ text, model: replyModel(j, ctx.model), usage: usage(j) });
  }catch(e){ return apiError(res, e, b.model); }
};

/* a question outside a session, with the plan, so the coach can propose changes the app applies on confirmation */
async function ask(b, icuKey, res, ctx){
  const q = String(b.question || "").trim().slice(0, 2000);
  if(!q) return res.status(400).json({ error: "No question provided" });
  const parts = [section("Athlete", { ...pick(b.athlete || {}, ["ftp", "maxHr", "weight"]), danas: ymd(Date.now()) })];
  if(b.notes) parts.push(`## Athlete notes\n${String(b.notes).slice(0, 2000)}`);
  if(b.plan){
    parts.push(section("This week's plan: sessions (id = session_id) and their state", b.plan.sessions || []));
    parts.push(b.plan.options?.length ? section("Available replacement sessions (id = workout_id)", b.plan.options)
      : "## Swaps\nNo replacement options were provided: you can only propose skip or restore. If another session should replace one, tell the athlete to explicitly request it.");
  } else parts.push("## Plan\nThe athlete does not currently have an active plan, so plan changes are not possible.");
  if(Array.isArray(b.rides) && b.rides.length) parts.push(section("Pedala rides from the last 3 weeks", b.rides.slice(0, 15)));
  if(icuKey){ const c = await icuContext(icuKey); parts.push(...c.parts(() => true)); }
  if(Array.isArray(b.comments) && b.comments.length) parts.push(section("Your recent session comments", b.comments.slice(0, 3)));
  if(Array.isArray(b.chat) && b.chat.length) parts.push(section("Conversation so far (oldest to newest)", b.chat.slice(-4)));
  // a strict schema only when the key's model supports one; otherwise the prompt asks for JSON and it is parsed tolerantly
  const strict = !!ctx.caps?.schema;
  const j = await orChat({ ...ctx, system: SYSTEM_ASK + (strict ? "" : JSON_ONLY), content: parts.join("\n\n") + "\n\n## The athlete's message\n" + q + "\n\n" + langLine(b.lang),
    schema: strict ? ASK_SCHEMA : null });
  const cut = cutOff(j); if(cut) return res.status(502).json({ error: cut });
  if(j.choices?.[0]?.finish_reason === "content_filter") return res.status(422).json({ error: "The coach did not respond this time" });
  const out = parseJson(messageText(j));
  if(!out || typeof out !== "object" || Array.isArray(out) || typeof out.answer !== "string" || !Array.isArray(out.changes))   // malformed: never a bare 500
    return res.status(502).json({ error: "The coach returned an invalid response" });
  const ids = new Set((b.plan?.sessions || []).map(x => x.id)), opts = new Set((b.plan?.options || []).map(x => x.id));
  const changes = out.changes.filter(c => c && typeof c === "object" && ids.has(c.session_id)   // only what the app can apply
    && ["replace", "skip", "restore"].includes(c.action) && (c.action !== "replace" || opts.has(c.workout_id)));
  return res.status(200).json({ answer: out.answer.trim(), changes, model: replyModel(j, ctx.model), usage: usage(j) });
}

/* Saturday review of the week: the plan around it, Pedala's rides, intervals.icu and wellness */
async function week(b, icuKey, res, ctx){
  const parts = [section("Athlete", { ...pick(b.athlete || {}, ["ftp", "maxHr", "weight"]), danas: ymd(Date.now()) })];
  if(b.notes) parts.push(`## Athlete notes\n${String(b.notes).slice(0, 2000)}`);
  if(b.plan) parts.push(section("Plan: past 7 days and next 8 days, with status", (b.plan.sessions || []).slice(0, 40)));
  if(Array.isArray(b.rides) && b.rides.length) parts.push(section("Pedala rides from the past 7 days", b.rides.slice(0, 15)));
  if(icuKey){ const c = await icuContext(icuKey); parts.push(...c.parts(() => true)); }
  const j = await orChat({ ...ctx, system: SYSTEM_WEEK, content: parts.join("\n\n") + "\n\nWrite a weekly review.\n\n" + langLine(b.lang) });
  const cut = cutOff(j); if(cut) return res.status(502).json({ error: cut });
  if(j.choices?.[0]?.finish_reason === "content_filter") return res.status(422).json({ error: "The coach did not write a review this time" });
  const text = messageText(j).trim();
  if(!text) return res.status(502).json({ error: "The coach returned an empty review" });
  return res.status(200).json({ text, model: replyModel(j, ctx.model), usage: usage(j) });
}

/* one OpenAI-compatible call to OpenRouter; caps shape the body, and a stale hint is retried once conservatively */
async function orChat({ key, model, caps, system, content, schema, host }){
  const c = caps && typeof caps === "object" ? caps : {};
  const body = { model: model || DEFAULT_MODEL, messages: [{ role: "system", content: system }, { role: "user", content }], max_tokens: 4000 };
  if(c.mc === true){ delete body.max_tokens; body.max_completion_tokens = 4000; }
  if(c.reasoning === "reasoning") body.reasoning = { effort: "low", exclude: true };
  else if(c.reasoning === "reasoning_effort") body.reasoning_effort = "low";
  if(c.schema === true && schema) body.response_format = { type: "json_schema", json_schema: { name: "coach_answer", strict: true, schema } };
  const optional = body.max_completion_tokens != null || body.reasoning != null || body.reasoning_effort != null || body.response_format != null;
  const send = async payload => {
    const r = await fetch(`${OR}/chat/completions`, { method: "POST", headers: {
      Authorization: `Bearer ${key}`, "content-type": "application/json",
      "HTTP-Referer": `https://${host || "pedala.vercel.app"}`, "X-Title": "Pedala" },
      body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    if(!r.ok){
      const e = new Error(String(j.error?.metadata?.raw || j.error?.message || `OpenRouter error ${r.status}`).slice(0, 300));
      e.status = r.status; throw e;
    }
    return j;
  };
  try{ return await send(body); }
  catch(e){
    // retry conservatively only when the provider names one of the optional fields; every other 400 is a real refusal
    if(e.status === 400 && optional && /max_tokens|max_completion_tokens|reasoning|response_format/i.test(String(e.message)))
      return send({ model: body.model, messages: body.messages, max_tokens: 4000 });
    throw e;
  }
}
/* the answer was cut off at the token limit */
function cutOff(j){
  return j.choices?.[0]?.finish_reason === "length" ? "The answer was cut off; try again" : "";
}
function messageText(j){
  const content = j.choices?.[0]?.message?.content;
  return Array.isArray(content) ? content.map(c => c?.text || "").join("") : String(content || "");
}
const replyModel = (j, asked) => j.model || asked || DEFAULT_MODEL;
/* tolerant JSON: fences from a prompt-only answer, or text around the object */
function parseJson(text){
  let t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try{ return JSON.parse(t); }catch{}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if(a < 0 || b <= a) return null;
  try{ return JSON.parse(t.slice(a, b + 1)); }catch{ return null; }
}
const keyOf = b => String(b.orKey || process.env.OPENROUTER_API_KEY || "").trim();
/* one short line at the end of the user content: the athlete's interface language, anything else English */
function langLine(code){
  const c = String(code || "").trim();
  const ok = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/i.test(c) ? c : "en";
  let name = ok;
  try{ name = new Intl.DisplayNames(["en"], { type: "language" }).of(ok) || ok; }catch{ name = ok; }
  return `Write your answer in ${name} (${ok}).`;
}
/* tokens and the real cost OpenRouter reports, so the app can show what an answer cost (never an estimate) */
function usage(j){
  const u = j.usage || {};
  return { input: u.prompt_tokens || 0, output: u.completion_tokens || 0, usd: typeof u.cost === "number" ? u.cost : null };
}
function apiError(res, e, model){
  switch(e.status){
    case 401: return res.status(401).json({ error: "OpenRouter rejected the API key" });
    case 402: return res.status(402).json({ error: "The OpenRouter account has no credit. Add credit at openrouter.ai/settings/credits." });
    case 403: return res.status(403).json({ error: String(e.message || "OpenRouter refused the request").slice(0, 300) });
    case 404: return res.status(404).json({ error: `Unknown model: ${model || DEFAULT_MODEL}`.slice(0, 300) });
    case 429: return res.status(429).json({ error: "The coach is busy right now; try again later" });
    default: return res.status(502).json({ error: String(e.message || e).slice(0, 300) });
  }
}
/* the last four weeks of activities and one week of wellness from intervals.icu (each part optional) */
async function icuContext(key, oneId){
  const [acts, well, one] = await Promise.all([
    icu(key, `/athlete/0/activities?oldest=${ymd(Date.now() - 28 * DAY)}&newest=${ymd(Date.now() + DAY)}`).catch(() => null),
    icu(key, `/athlete/0/wellness?oldest=${ymd(Date.now() - 7 * DAY)}&newest=${ymd(Date.now())}`).catch(() => null),
    oneId ? icu(key, `/activity/${encodeURIComponent(oneId)}?intervals=true`).catch(() => null) : null,
  ]);
  return { one, parts: keep => [
    Array.isArray(acts) && section("All sessions from the last 4 weeks (intervals.icu)", acts.filter(keep).map(a => pick({
      datum: a.start_date_local, vrsta: a.type, naziv: a.name, min: a.moving_time && Math.round(a.moving_time / 60),
      km: a.distance && +(a.distance / 1000).toFixed(1), opterecenje: a.icu_training_load, puls: a.average_heartrate,
      snaga: a.icu_average_watts || a.average_watts }, null))),
    Array.isArray(well) && section("Fitness and recovery (intervals.icu wellness, by day)", well.map(w => pick({
      datum: w.id, kondicija: w.ctl && Math.round(w.ctl), umor: w.atl && Math.round(w.atl), puls_mirovanje: w.restingHR, hrv: w.hrv,
      san_h: w.sleepSecs && +(w.sleepSecs / 3600).toFixed(1), ocjena_sna: w.sleepScore, spremnost: w.readiness, tezina: w.weight }, null))),
  ].filter(Boolean) };
}

async function icu(key, path){
  const r = await fetch(ICU + path, { headers: { Authorization: "Basic " + Buffer.from("API_KEY:" + key).toString("base64") } });
  if(!r.ok) throw new Error("intervals.icu " + r.status);
  return r.json();
}
const ymd = t => new Date(t).toISOString().slice(0, 10);
/* keep the listed keys (or every key when keys is null), without empty values */
function pick(o, keys){ const out = {}; for(const k of keys || Object.keys(o)) if(o[k] != null && o[k] !== "" && !Number.isNaN(o[k])) out[k] = o[k]; return out; }
const section = (title, data) => `## ${title}\n${JSON.stringify(data)}`;

function trimRide(r){
  return pick({
    naziv: r.name, pocetak: r.start, trening_opis: r.desc, plan: r.plan, ruta: r.route,
    ftp: r.ftp, max_puls_postavke: r.maxHr, sazetak: r.m, dionice: (r.laps || []).slice(0, 60),
    po_minutama: r.minutes,
  }, null);
}
function trimIcuActivity(a){
  return pick({
    vrsta: a.type, naziv: a.name, pocetak: a.start_date_local, min: a.moving_time && Math.round(a.moving_time / 60),
    km: a.distance && +(a.distance / 1000).toFixed(2), uspon_m: a.total_elevation_gain, puls: a.average_heartrate, max_puls: a.max_heartrate,
    opterecenje: a.icu_training_load, snaga: a.icu_average_watts || a.average_watts, kadenca: a.average_cadence,
    brzina_kmh: a.average_speed && +(a.average_speed * 3.6).toFixed(1), opis: a.description,
    intervali: (a.icu_intervals || []).slice(0, 40).map(i => pick({
      vrsta: i.type, oznaka: i.label, s: i.moving_time || i.elapsed_time, m: i.distance && Math.round(i.distance), puls: i.average_heartrate,
      max_puls: i.max_heartrate, snaga: i.average_watts, kadenca: i.average_cadence, brzina_kmh: i.average_speed && +(i.average_speed * 3.6).toFixed(1) }, null)),
  }, null);
}
