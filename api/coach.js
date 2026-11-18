// Virtual coach: a short comment in Croatian on one training session, written by Claude (Anthropic API).
// The key is ANTHROPIC_API_KEY on Vercel; without it the coach is off. Context comes from intervals.icu
// (INTERVALS_API_KEY on Vercel, or the key the app sends): the last six weeks of activities and wellness.
//   GET  /api/coach                                    -> { enabled: true | false }
//   POST /api/coach { action: "list", icuKey }         -> { activities: [...] }   intervals.icu, last 10 days
//   POST /api/coach { action: "comment", icuKey, notes, athlete, ride | icuId } -> { text, model }
//     ride:  a ride recorded in Pedala (summary, laps, minute-by-minute power, cadence and heart rate)
//     icuId: any activity on intervals.icu (runs and swims from a watch, outdoor rides…)
//   POST /api/coach { action: "week", icuKey, notes, athlete, plan, rides } -> { text }   review of the last seven days (Saturdays)
//   POST /api/coach { action: "ask", icuKey, notes, athlete, question, chat, plan, rides, comments }
//     -> { answer, changes: [{ session_id, action: "replace" | "skip" | "restore", workout_id, reason }] }
//     a question outside a session; changes to the plan are only proposals, the app applies them when the athlete confirms
const AnthropicSDK = require("@anthropic-ai/sdk");
const Anthropic = AnthropicSDK.default || AnthropicSDK;

const MODEL = "claude-opus-5-5";
const ICU = "https://intervals.icu/api/v1";
const DAY = 864e5;

const SYSTEM = `Ti si osobni trener izdržljivosti (biciklizam, trčanje, plivanje) u aplikaciji Pedala. Sportaš ti nakon treninga pošalje podatke, a ti mu napišeš kratak komentar kao trener koji ga poznaje.

Komentar:
- kako je trening prošao u odnosu na ono što je trebao biti (plan, cilj intervala, vrsta treninga);
- što podaci stvarno pokazuju: snaga, puls i kako se mijenja kroz trening, kadenca ili tempo, u kontekstu zadnjih tjedana i forme;
- jedan ili dva konkretna savjeta za sljedeće dane.

Pravila:
- Piši na hrvatskom, toplo i izravno, u drugom licu jednine.
- Ne ponavljaj brojke koje sportaš već vidi, osim kad nešto znače; nema općenitih fraza.
- Poštuj sportaševe bilješke (ograničenja, ciljeve, odluke koje je već donio) i ne nagovaraj ga protiv njih.
- Ako nešto upućuje na rizik od ozljede, bolesti ili pretreniranosti, reci to jasno; ne postavljaj dijagnoze.
- Ako podataka nema dovoljno za neki zaključak, ne nagađaj.
- Duljina: 80 do 160 riječi, običan tekst bez naslova i markdowna, najviše tri kratka odlomka.`;

const SYSTEM_ASK = `Ti si osobni trener izdržljivosti (biciklizam, trčanje, plivanje) u aplikaciji Pedala. Sportaš ti piše izvan treninga: pitanje, kako se osjeća, ili želi nešto promijeniti u planu. Imaš njegov plan za ovaj tjedan, treninge zadnjih tjedana, formu, svoje ranije komentare i dosadašnji razgovor.

Odgovor (polje answer):
- na hrvatskom, toplo i izravno, u drugom licu jednine; najviše 150 riječi, običan tekst bez markdowna;
- konkretno za njegovu situaciju, uz poštovanje njegovih bilješki i odluka;
- kod znakova bolesti, ozljede ili boli savjetuj odmor i, kad treba, liječnika; ne postavljaj dijagnoze.

Promjene plana (polje changes):
- predloži ih samo kad sportaš traži promjenu ili kad je jasno potrebna (bolest, umor, put), inače vrati prazan popis;
- session_id mora biti jedan od navedenih treninga iz plana, a workout_id jedan od navedenih mogućih treninga (ili null);
- replace: zamijeni trening drugim (workout_id); skip: preskoči (npr. bolest, ili zamjena trčanjem ili plivanjem izvan Pedale; workout_id null); restore: vrati izvorni trening (workout_id null);
- ne mijenjaj treninge koji su već odrađeni; reason kratko objašnjava zašto;
- u odgovoru reci što predlažeš: promjene se primjenjuju tek kad ih sportaš potvrdi u aplikaciji.`;

const SYSTEM_WEEK = `Ti si osobni trener izdržljivosti (biciklizam, trčanje, plivanje) u aplikaciji Pedala. Jednom tjedno, subotom, sportašu pišeš pregled proteklih sedam dana.

Pregled:
- što je odrađeno u odnosu na plan i koliko je bio dosljedan (neobavezni treninzi se ne broje kao propušteni);
- kako napreduju bicikl, trčanje i plivanje, prema podacima (snaga, puls, tempo, opterećenje);
- forma i oporavak: kondicija, umor, san, puls u mirovanju i HRV, ako ih ima;
- na što paziti idući tjedan, s jednim ili dva konkretna savjeta za treninge koji slijede.

Pravila: na hrvatskom, toplo i izravno, u drugom licu jednine; poštuj sportaševe bilješke i odluke; kod znakova ozljede, bolesti ili pretreniranosti reci to jasno, bez dijagnoza; ne nagađaj kad podataka nema. Duljina: 120 do 220 riječi, običan tekst bez naslova i markdowna, najviše četiri kratka odlomka.`;

const ASK_SCHEMA = { type: "object", additionalProperties: false, required: ["answer", "changes"], properties: {
  answer: { type: "string" },
  changes: { type: "array", items: { type: "object", additionalProperties: false, required: ["session_id", "action", "workout_id", "reason"], properties: {
    session_id: { type: "string" }, action: { type: "string", enum: ["replace", "skip", "restore"] },
    workout_id: { anyOf: [{ type: "string" }, { type: "null" }] }, reason: { type: "string" } } } } } };

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const enabled = !!process.env.ANTHROPIC_API_KEY;
  if(req.method === "GET") return res.status(200).json({ enabled });
  if(req.method !== "POST") return res.status(405).json({ error: "Dozvoljeni su samo GET i POST" });
  let b = req.body || {};
  if(typeof b === "string"){ try{ b = JSON.parse(b); }catch{ return res.status(400).json({ error: "Neispravan JSON" }); } }
  const icuKey = process.env.INTERVALS_API_KEY || b.icuKey || null;
  try{
    if(b.action === "list"){
      if(!icuKey) return res.status(200).json({ activities: [] });
      const acts = await icu(icuKey, `/athlete/0/activities?oldest=${ymd(Date.now() - 10 * DAY)}&newest=${ymd(Date.now() + DAY)}`);
      return res.status(200).json({ activities: (Array.isArray(acts) ? acts : []).map(a => ({
        id: String(a.id), type: a.type || "", name: a.name || "", start: a.start_date_local || "", external_id: a.external_id || null,
        minutes: a.moving_time ? Math.round(a.moving_time / 60) : null })) });
    }
    if(!["comment", "ask", "week"].includes(b.action)) return res.status(400).json({ error: "Nepoznata akcija" });
    if(!enabled) return res.status(501).json({ error: "Trener nije uključen: na Vercelu dodaj ANTHROPIC_API_KEY i napravi Redeploy." });
    if(b.action === "ask") return ask(b, icuKey, res);
    if(b.action === "week") return week(b, icuKey, res);
    if(!b.ride && !b.icuId) return res.status(400).json({ error: "Nema treninga za komentar" });

    // what the coach looks at; intervals.icu parts are optional (no key, or the service is down)
    const parts = [];
    parts.push(section("Sportaš", { ...pick(b.athlete || {}, ["ftp", "maxHr", "weight"]), danas: ymd(Date.now()) }));
    if(b.notes) parts.push(`## Sportaševe bilješke\n${String(b.notes).slice(0, 2000)}`);
    let exclude = null;
    if(b.ride){ parts.push(section("Trening koji komentiraš (Pedala, trenažer)", trimRide(b.ride))); exclude = b.ride.id; }
    if(icuKey){
      const ctx = await icuContext(icuKey, b.icuId);
      if(b.icuId){
        if(!ctx.one) return res.status(404).json({ error: "Trening nije pronađen na intervals.icu" });
        parts.push(section("Trening koji komentiraš (intervals.icu)", trimIcuActivity(ctx.one)));
        if(b.planned) parts.push(section("Što je plan tražio za taj dan", b.planned));
      }
      parts.push(...ctx.parts(a => String(a.id) !== String(b.icuId) && (!exclude || a.external_id !== exclude)));
    } else if(b.icuId) return res.status(401).json({ error: "Za treninge s intervals.icu treba intervals.icu ključ" });

    const msg = await claude({ system: SYSTEM, content: parts.join("\n\n") + "\n\nNapiši komentar." });
    if(msg.stop_reason === "refusal") return res.status(422).json({ error: "Trener ovaj put nije napisao komentar" });
    const text = msg.content.filter(c => c.type === "text").map(c => c.text).join("\n").trim();
    if(!text) return res.status(502).json({ error: "Trener je vratio prazan komentar" });
    return res.status(200).json({ text, model: msg.model, usage: usage(msg) });
  }catch(e){ return apiError(res, e); }
};

/* a question outside a session, with the plan, so the coach can propose changes the app applies on confirmation */
async function ask(b, icuKey, res){
  const q = String(b.question || "").trim().slice(0, 2000);
  if(!q) return res.status(400).json({ error: "Nema pitanja" });
  const parts = [section("Sportaš", { ...pick(b.athlete || {}, ["ftp", "maxHr", "weight"]), danas: ymd(Date.now()) })];
  if(b.notes) parts.push(`## Sportaševe bilješke\n${String(b.notes).slice(0, 2000)}`);
  if(b.plan){
    parts.push(section("Plan za ovaj tjedan: treninzi (id = session_id) i njihovo stanje", b.plan.sessions || []));
    parts.push(b.plan.options?.length ? section("Mogući treninzi za zamjenu (id = workout_id)", b.plan.options)
      : "## Zamjene\nPopis zamjena nije poslan: možeš predložiti samo skip ili restore. Ako bi trebalo zamijeniti trening drugim, reci sportašu neka to izričito zatraži.");
  } else parts.push("## Plan\nSportaš trenutno nema pokrenut plan, pa promjene plana nisu moguće.");
  if(Array.isArray(b.rides) && b.rides.length) parts.push(section("Vožnje u Pedali zadnja 3 tjedna", b.rides.slice(0, 15)));
  if(icuKey){ const ctx = await icuContext(icuKey); parts.push(...ctx.parts(() => true)); }
  if(Array.isArray(b.comments) && b.comments.length) parts.push(section("Tvoji zadnji komentari treninga", b.comments.slice(0, 3)));
  if(Array.isArray(b.chat) && b.chat.length) parts.push(section("Dosadašnji razgovor (od starijeg prema novijem)", b.chat.slice(-4)));
  const msg = await claude({ system: SYSTEM_ASK, content: parts.join("\n\n") + "\n\n## Sportaš sada piše\n" + q, format: ASK_SCHEMA });
  if(msg.stop_reason === "refusal") return res.status(422).json({ error: "Trener ovaj put nije odgovorio" });
  let out; try{ out = JSON.parse(msg.content.filter(c => c.type === "text").map(c => c.text).join("")); }catch{ return res.status(502).json({ error: "Trener je vratio neispravan odgovor" }); }
  const ids = new Set((b.plan?.sessions || []).map(x => x.id)), opts = new Set((b.plan?.options || []).map(x => x.id));
  const changes = (out.changes || []).filter(c => ids.has(c.session_id) && (c.action !== "replace" || opts.has(c.workout_id)));   // only what the app can apply
  return res.status(200).json({ answer: String(out.answer || "").trim(), changes, model: msg.model, usage: usage(msg) });
}

/* Saturday review of the week: the plan around it, Pedala's rides, intervals.icu and wellness */
async function week(b, icuKey, res){
  const parts = [section("Sportaš", { ...pick(b.athlete || {}, ["ftp", "maxHr", "weight"]), danas: ymd(Date.now()) })];
  if(b.notes) parts.push(`## Sportaševe bilješke\n${String(b.notes).slice(0, 2000)}`);
  if(b.plan) parts.push(section("Plan: proteklih 7 dana i idućih 8, sa stanjem", (b.plan.sessions || []).slice(0, 40)));
  if(Array.isArray(b.rides) && b.rides.length) parts.push(section("Vožnje u Pedali proteklih 7 dana", b.rides.slice(0, 15)));
  if(icuKey){ const ctx = await icuContext(icuKey); parts.push(...ctx.parts(() => true)); }
  const msg = await claude({ system: SYSTEM_WEEK, content: parts.join("\n\n") + "\n\nNapiši tjedni pregled." });
  if(msg.stop_reason === "refusal") return res.status(422).json({ error: "Trener ovaj put nije napisao pregled" });
  const text = msg.content.filter(c => c.type === "text").map(c => c.text).join("\n").trim();
  if(!text) return res.status(502).json({ error: "Trener je vratio prazan pregled" });
  return res.status(200).json({ text, model: msg.model, usage: usage(msg) });
}

async function claude({ system, content, format }){
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",                         // a declined request is retried on a fallback model
    // effort low: short coaching answers, and thinking is most of the cost
    output_config: { effort: "low", ...(format ? { format: { type: "json_schema", schema: format } } : {}) },
    system,
    messages: [{ role: "user", content }],
  });
}
/* tokens and an estimate in dollars at Claude Opus 5.5 prices ($4 / $20 per million), so the app can show what an answer cost */
function usage(msg){
  const u = msg.usage || {}, input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), output = u.output_tokens || 0;
  return { input, output, usd: +((input * 4 + output * 20) / 1e6).toFixed(4) };
}
function apiError(res, e){
  if(e instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: "Anthropic ne prihvaća ANTHROPIC_API_KEY" });
  // out of prepaid credit: a clear message, and 402 so the app stops trying for a while (failed requests cost nothing)
  if(e instanceof Anthropic.APIError && e.status === 400 && /credit balance/i.test(e.message)) return res.status(402).json({ error: "Na Anthropic računu nema kredita. Nadoplati ga na console.anthropic.com → Billing." });
  if(e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "Trener je trenutno zauzet, probaj kasnije" });
  if(e instanceof Anthropic.APIError) return res.status(502).json({ error: `Anthropic greška ${e.status ?? ""}: ${e.message}`.slice(0, 300) });
  return res.status(502).json({ error: "Trener nije dostupan: " + e.message });
}
/* the last four weeks of activities and one week of wellness from intervals.icu (each part optional) */
async function icuContext(key, oneId){
  const [acts, well, one] = await Promise.all([
    icu(key, `/athlete/0/activities?oldest=${ymd(Date.now() - 28 * DAY)}&newest=${ymd(Date.now() + DAY)}`).catch(() => null),
    icu(key, `/athlete/0/wellness?oldest=${ymd(Date.now() - 7 * DAY)}&newest=${ymd(Date.now())}`).catch(() => null),
    oneId ? icu(key, `/activity/${encodeURIComponent(oneId)}?intervals=true`).catch(() => null) : null,
  ]);
  return { one, parts: keep => [
    Array.isArray(acts) && section("Svi treninzi zadnja 4 tjedna (intervals.icu)", acts.filter(keep).map(a => pick({
      datum: a.start_date_local, vrsta: a.type, naziv: a.name, min: a.moving_time && Math.round(a.moving_time / 60),
      km: a.distance && +(a.distance / 1000).toFixed(1), opterecenje: a.icu_training_load, puls: a.average_heartrate,
      snaga: a.icu_average_watts || a.average_watts }, null))),
    Array.isArray(well) && section("Forma i oporavak (intervals.icu wellness, po danima)", well.map(w => pick({
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
