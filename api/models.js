// Vercel serverless function for the model picker: the models one OpenRouter key may actually run.
// The key is the one from Settings (or OPENROUTER_API_KEY on Vercel) and never sits in a URL, so this is a POST.
//   POST /api/models { orKey? } -> { default, models: [{ id, name, priceIn, priceOut, ctx, caps }] }
//     409 { error: "noKey" }                 no key on the device and none on Vercel
//     401 { error: "OpenRouter rejected the API key" }
//     502 { error }                          OpenRouter or the network failed
// /api/v1/models/user is filtered by the account's provider preferences, privacy settings and guardrails,
// so the picker only ever offers models this key may use.
const crypto = require("node:crypto");
const API = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash-1017";
const TTL = 10 * 60000;
const cache = new Map();   // sha256(key) -> { at, body }, so two profiles with two keys never share a list

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  if(req.method !== "POST") return res.status(405).json({ error: "Only POST is allowed" });
  let b = req.body || {};
  if(typeof b === "string"){ try{ b = JSON.parse(b); }catch{ return res.status(400).json({ error: "Invalid JSON" }); } }
  const key = String(b.orKey || process.env.OPENROUTER_API_KEY || "").trim();
  if(!key) return res.status(409).json({ error: "noKey" });
  const fp = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16), hit = cache.get(fp);
  if(hit && Date.now() - hit.at < TTL) return res.status(200).json(hit.body);
  try{
    const r = await fetch(`${API}/models/user?output_modalities=text`, { headers: { Authorization: `Bearer ${key}` } });
    const j = await r.json().catch(() => ({}));
    if(r.status === 401) return res.status(401).json({ error: "OpenRouter rejected the API key" });
    if(!r.ok){
      const e = new Error(String(j.error?.metadata?.raw || j.error?.message || `OpenRouter error ${r.status}`).slice(0, 300));
      e.status = r.status; throw e;
    }
    const body = trim(j.data);
    cache.set(fp, { at: Date.now(), body });
    return res.status(200).json(body);
  }catch(e){
    return res.status(502).json({ error: String(e.message || e).slice(0, 300) });
  }
};

/* only models that can answer a chat request now, with $ per million tokens and what they accept */
function trim(data){
  const models = (Array.isArray(data) ? data : []).filter(m => m && m.id && !m.id.endsWith(":batch")
      && (m.endpoints || []).includes("/api/v1/chat/completions")
      && (m.architecture?.output_modalities || []).includes("text"))
    .map(m => {
      const params = m.supported_parameters || [];
      return { id: m.id, name: m.name || m.id, priceIn: perM(m.pricing?.prompt), priceOut: perM(m.pricing?.completion),
        ctx: m.context_length ?? null,
        caps: { mc: params.includes("max_completion_tokens") && !params.includes("max_tokens"),
          reasoning: params.includes("reasoning") ? "reasoning" : params.includes("reasoning_effort") ? "reasoning_effort" : null,
          schema: params.includes("structured_outputs") } };
    });
  const ids = models.map(m => m.id);
  const def = ids.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : models.length === 1 ? ids[0] : null;
  return { default: def, models };
}
/* per-token string -> US dollars per million tokens, 3 significant digits */
const perM = p => p == null || p === "" || Number.isNaN(Number(p)) ? null : +(Number(p) * 1e6).toPrecision(3);
