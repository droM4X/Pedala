// Virtual coach: a short comment in Croatian on one training session, written by Claude (Anthropic API).
// The key is ANTHROPIC_API_KEY on Vercel; without it the coach is off. Context comes from intervals.icu
// (INTERVALS_API_KEY on Vercel, or the key the app sends): the last six weeks of activities and wellness.
//   GET  /api/coach                                    -> { enabled: true | false }
//   POST /api/coach { action: "list", icuKey }         -> { activities: [...] }   intervals.icu, last 10 days
//   POST /api/coach { action: "comment", icuKey, notes, athlete, ride | icuId } -> { text, model }
//     ride:  a ride recorded in Pedala (summary, laps, minute-by-minute power, cadence and heart rate)
//     icuId: any activity on intervals.icu (runs and swims from a watch, outdoor rides…)
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
    if(b.action !== "comment") return res.status(400).json({ error: "Nepoznata akcija" });
    if(!enabled) return res.status(501).json({ error: "Trener nije uključen: na Vercelu dodaj ANTHROPIC_API_KEY i napravi Redeploy." });
    if(!b.ride && !b.icuId) return res.status(400).json({ error: "Nema treninga za komentar" });

    // what the coach looks at; intervals.icu parts are optional (no key, or the service is down)
    const parts = [];
    parts.push(section("Sportaš", { ...pick(b.athlete || {}, ["ftp", "maxHr", "weight"]), danas: ymd(Date.now()) }));
    if(b.notes) parts.push(`## Sportaševe bilješke\n${String(b.notes).slice(0, 2000)}`);
    let exclude = null;
    if(b.ride){ parts.push(section("Trening koji komentiraš (Pedala, trenažer)", trimRide(b.ride))); exclude = b.ride.id; }
    if(icuKey){
      const [acts, well, one] = await Promise.all([
        icu(icuKey, `/athlete/0/activities?oldest=${ymd(Date.now() - 42 * DAY)}&newest=${ymd(Date.now() + DAY)}`).catch(() => null),
        icu(icuKey, `/athlete/0/wellness?oldest=${ymd(Date.now() - 14 * DAY)}&newest=${ymd(Date.now())}`).catch(() => null),
        b.icuId ? icu(icuKey, `/activity/${encodeURIComponent(b.icuId)}?intervals=true`).catch(() => null) : null,
      ]);
      if(b.icuId){
        if(!one) return res.status(404).json({ error: "Trening nije pronađen na intervals.icu" });
        parts.push(section("Trening koji komentiraš (intervals.icu)", trimIcuActivity(one)));
      }
      if(Array.isArray(acts)) parts.push(section("Svi treninzi zadnjih 6 tjedana (intervals.icu)",
        acts.filter(a => String(a.id) !== String(b.icuId) && (!exclude || a.external_id !== exclude)).map(a => pick({
          datum: a.start_date_local, vrsta: a.type, naziv: a.name, min: a.moving_time && Math.round(a.moving_time / 60),
          km: a.distance && +(a.distance / 1000).toFixed(1), opterecenje: a.icu_training_load, puls: a.average_heartrate,
          snaga: a.icu_average_watts || a.average_watts }, null))));
      if(Array.isArray(well)) parts.push(section("Forma i oporavak (intervals.icu wellness, po danima)", well.map(w => pick({
        datum: w.id, kondicija: w.ctl && Math.round(w.ctl), umor: w.atl && Math.round(w.atl), puls_mirovanje: w.restingHR, hrv: w.hrv,
        san_h: w.sleepSecs && +(w.sleepSecs / 3600).toFixed(1), tezina: w.weight }, null))));
    } else if(b.icuId) return res.status(401).json({ error: "Za treninge s intervals.icu treba intervals.icu ključ" });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",                       // a declined request is retried on a fallback model
      output_config: { effort: "medium" },
      system: SYSTEM,
      messages: [{ role: "user", content: parts.join("\n\n") + "\n\nNapiši komentar." }],
    });
    if(msg.stop_reason === "refusal") return res.status(422).json({ error: "Trener ovaj put nije napisao komentar" });
    const text = msg.content.filter(c => c.type === "text").map(c => c.text).join("\n").trim();
    if(!text) return res.status(502).json({ error: "Trener je vratio prazan komentar" });
    return res.status(200).json({ text, model: msg.model });
  }catch(e){
    if(e instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: "Anthropic ne prihvaća ANTHROPIC_API_KEY" });
    if(e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "Trener je trenutno zauzet, probaj kasnije" });
    if(e instanceof Anthropic.APIError) return res.status(502).json({ error: `Anthropic greška ${e.status ?? ""}: ${e.message}`.slice(0, 300) });
    return res.status(502).json({ error: "Trener nije dostupan: " + e.message });
  }
};

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
