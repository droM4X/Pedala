// Local stand-in for Vercel used by the tests: serves the app and runs the real api/*.js functions,
// with intervals.icu, the YouTube Data API, the OpenRouter API and Vercel Blob replaced by small in-memory fakes.
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const { createRemote } = require("../../lib/remote.js");

const log = [];
let uploads = 0; const seenFit = new Map();
const GOOD_ICU = "Basic " + Buffer.from("API_KEY:goodkey").toString("base64");
const realFetch = global.fetch;
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

global.fetch = async (url, opt = {}) => {
  url = String(url);
  if(url.startsWith("https://www.googleapis.com")) return fakeYouTube(new URL(url));
  if(url.startsWith("https://intervals.icu")) return fakeIntervals(new URL(url), opt);
  if(url.startsWith("https://openrouter.ai")) return fakeOpenRouter(new URL(url), opt);
  return realFetch(url, opt);
};

function fakeYouTube(u){
  const P = u.pathname, q = k => u.searchParams.get(k);
  log.push(`yt ${P} cat=${q("videoCategoryId")}`);
  if(q("key") !== "AIzaSERVER") return J({ error: { errors: [{ reason: "keyInvalid" }], message: "API key not valid" } }, 400);
  if(P.endsWith("/search") && q("type") === "channel") return J({ items: [{ id: { channelId: "UCxxxxxxxxxxxxxxxxxxxxx2" } }] });
  if(P.endsWith("/channels")){
    const id = q("id") || (q("forHandle") === "@bikeworld" ? "UCxxxxxxxxxxxxxxxxxxxxx1" : null);
    if(!id) return J({ items: [] });
    return J({ items: [{ id, snippet: { title: id.endsWith("1") ? "Bike World" : "Ride Channel", thumbnails: { default: { url: "" } } }, contentDetails: { relatedPlaylists: { uploads: "UU" + id.slice(2) } } }] });
  }
  if(P.endsWith("/playlists")) return J({ items: q("id") === "PLmine123456" ? [{ snippet: { title: "Indoor rides" } }] : [] });
  if(P.endsWith("/playlistItems")){
    const pl = q("playlistId");
    return J({ items: [1, 2, 3, 4].map(i => ({ snippet: { title: i === 4 ? "Private video" : `${pl} video ${i}`, videoOwnerChannelTitle: "Owner", thumbnails: { medium: { url: "" } } },
      contentDetails: { videoId: (pl + "v" + i).slice(-11).padStart(11, "x"), videoPublishedAt: `2026-1${pl.endsWith("1") ? 0 : 1}-0${i}T10:00:00Z` } })) });
  }
  if(P.endsWith("/search")) return J({ items: [1, 2, 3].map(i => ({ id: { videoId: "vid0000000" + i }, snippet: { title: "Stelvio ride " + i, channelTitle: "Channel", thumbnails: { medium: { url: "" } } } })) });
  return J({ items: [1, 2, 3].map(i => ({ id: "vid0000000" + i, contentDetails: { duration: "PT1H2M" } })) });
}

async function fakeIntervals(u, opt){
  if((opt.headers || {}).Authorization !== GOOD_ICU) return new Response("Access denied", { status: 403 });
  if(u.pathname === "/api/v1/athlete/0" && !opt.method) return J({ id: "i12345", name: "Test Rider" });
  if(u.pathname === "/api/v1/athlete/0/activities" && opt.method === "POST"){
    const buf = new Uint8Array(await opt.body.get("file").arrayBuffer());
    if(String.fromCharCode(...buf.slice(8, 12)) !== ".FIT") return J({ error: "bad file" }, 422);
    const h = Buffer.from(buf).toString("base64");
    log.push(`upload ${u.searchParams.get("name")} ${buf.length} B`);
    if(seenFit.has(h)) return J([{ icu_athlete_id: "i12345", id: seenFit.get(h) }], 200);
    const id = "i" + (900 + ++uploads); seenFit.set(h, id); return J([{ icu_athlete_id: "i12345", id }], 201);
  }
  // reading for the coach: a run from a watch, a ride uploaded by Pedala, wellness
  const today = new Date().toLocaleDateString("sv-SE");   // local YYYY-MM-DD, the same day the app's ymd() computes (UTC would differ just after midnight)
  if(u.pathname === "/api/v1/athlete/0/activities") return J([
    { id: "i777", type: "Run", name: "Jutarnje trčanje", start_date_local: today + "T07:00:00", moving_time: 1800, distance: 5000, average_heartrate: 148, icu_training_load: 38 },
    { id: "i555", type: "VirtualRide", name: "Pedala", external_id: "r-1", start_date_local: today + "T06:00:00", moving_time: 1620, icu_training_load: 38 }]);
  if(u.pathname === "/api/v1/athlete/0/wellness") return J([{ id: today, ctl: 6.2, atl: 15.4, restingHR: 52 }]);
  if(u.pathname === "/api/v1/activity/i777") return J({ id: "i777", type: "Run", name: "Jutarnje trčanje", start_date_local: today + "T07:00:00", moving_time: 1800, distance: 5000,
    average_heartrate: 148, icu_intervals: [{ type: "WORK", moving_time: 900, distance: 2600, average_heartrate: 152 }] });
  return J({ error: "not found" }, 404);
}

/* OpenRouter: a key-scoped model list and OpenAI-compatible chat answers, remembering what was sent */
const orModel = (id, prompt, completion, params, endpoints = ["/api/v1/chat/completions"], modalities = ["text"]) => ({
  id, name: id.toUpperCase(), context_length: 32000, pricing: { prompt, completion }, supported_parameters: params,
  endpoints, architecture: { output_modalities: modalities } });
const DEFAULT_OR = () => ({ models: [
  orModel("deepseek/deepseek-v4.1-flash-1017", "0.00000004", "0.0000001", ["max_tokens", "reasoning", "structured_outputs"]),
  orModel("acme/plain-model", "0.000001", "0.000002", ["max_tokens"]),
  orModel("deepseek/deepseek-v4.1-flash-1017:batch", "0.00000002", "0.00000005", ["max_tokens"]),
  orModel("acme/image-only", "0.00001", "0.00002", ["max_tokens"], ["/api/v1/chat/completions"], ["image"]),
], cost: 0.02, fail: null, delay: 0 });
let or = DEFAULT_OR();
const openrouter = [], openrouterAuth = [];
async function fakeOpenRouter(u, opt){
  const auth = (opt.headers || {}).Authorization || "";
  if(u.pathname === "/api/v1/models/user"){
    if(!auth.startsWith("Bearer sk-") || auth === "Bearer sk-bad") return J({ error: { message: "No auth credentials found" } }, 401);
    if(or.fail) return J({ error: { message: "Provider returned error", code: or.fail } }, or.fail);
    const models = or.models, delay = or.delay;   // capture now, so a later patch cannot change this request's answer
    if(delay) await new Promise(r => setTimeout(r, delay));
    log.push(`openrouter models ${models.length}`);
    return J({ data: models });
  }
  if(u.pathname === "/api/v1/chat/completions"){
    const body = JSON.parse(opt.body); openrouter.push(body); openrouterAuth.push(auth);
    log.push(`openrouter ${body.model} ${(body.messages?.[1]?.content || "").length} chars`);
    if(or.fail){
      const message = or.fail === 403 ? "Request blocked: model not allowed by your guardrail" : "Provider returned error";
      return J({ error: { message, code: or.fail } }, or.fail);
    }
    const user = body.messages?.[1]?.content || "";
    if(body.response_format || user.includes("## The athlete's message")){   // a question: swap the first plan session, plus one invalid change
      const id = user.match(/"id":"(w\d+-\w+)"/)?.[1];
      const out = { answer: "Rest and do an easy recovery session instead of this workout.", changes: [
        { session_id: id, action: "replace", workout_id: "p-rec", reason: "cold" }, { session_id: "w99-xyz", action: "skip", workout_id: null, reason: "does not exist" }] };
      return J({ model: body.model, choices: [{ message: { content: JSON.stringify(out) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5000, completion_tokens: 300, cost: or.cost } });
    }
    return J({ model: body.model, choices: [{ message: { content: "Good workout. Your heart rate is steady; keep it up." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3000, completion_tokens: 400, cost: or.cost } });
  }
  return J({ error: { message: "not found" } }, 404);
}

/* Vercel Blob, private store, in memory */
const blob = require("@vercel/blob"), blobs = new Map();
blob.put = async (pathname, body) => { blobs.set(pathname, { url: "mem://" + pathname, pathname, body, uploadedAt: new Date() }); return { url: "mem://" + pathname, pathname }; };
blob.get = async p => blobs.has(p) ? { statusCode: 200, stream: new Response(blobs.get(p).body).body } : null;
blob.list = async ({ prefix }) => ({ blobs: [...blobs.values()].filter(b => b.pathname.startsWith(prefix)), hasMore: false });
blob.del = async urls => { for(const u of [].concat(urls)) blobs.delete(String(u).replace("mem://", "")); };
process.env.BLOB_READ_WRITE_TOKEN = "test";

const api = { intervals: require("../../api/intervals.js"), youtube: require("../../api/youtube.js"), sync: require("../../api/sync.js"), coach: require("../../api/coach.js"), models: require("../../api/models.js") };
const TYPES = { ".png": "image/png", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".html": "text/html; charset=utf-8" };

function start(port = 0){
  const remote = createRemote();
  const server = http.createServer(async (req, res) => {
    res.status = c => { res.statusCode = c; return res; };
    res.json = o => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); return res; };
    const name = req.url.match(/^\/api\/(\w+)/)?.[1];
    if(name && api[name]){
      let raw = ""; for await (const c of req) raw += c;
      req.body = (req.headers["content-type"] || "").includes("json") && raw ? JSON.parse(raw) : raw;
      return api[name](req, res);
    }
    if(req.url.startsWith("/api/")){ res.statusCode = 404; return res.end("not found"); }
    if(remote.route(req, res)) return;
    const pathname = decodeURIComponent(req.url.split("?")[0]);
    if(pathname.startsWith("/lang/")){
      const fixture = path.join(ROOT, "tests", "fixtures", "lang", path.posix.basename(pathname));
      if(fs.existsSync(fixture) && fs.statSync(fixture).isFile()){
        res.setHeader("content-type", TYPES[path.extname(fixture)] || "text/javascript"); return res.end(fs.readFileSync(fixture));
      }
      const real = path.join(ROOT, pathname);
      if(real.startsWith(ROOT + path.sep) && !real.includes("node_modules") && fs.existsSync(real) && fs.statSync(real).isFile()){
        res.setHeader("content-type", TYPES[path.extname(real)] || "application/octet-stream"); return res.end(fs.readFileSync(real));
      }
      res.statusCode = 404; res.setHeader("content-type", "text/plain"); return res.end("language not found");
    }
    const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    if(req.url !== "/" && file.startsWith(ROOT + path.sep) && !file.includes("node_modules") && fs.existsSync(file) && fs.statSync(file).isFile()){
      res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream"); return res.end(fs.readFileSync(file));
    }
    res.setHeader("content-type", TYPES[".html"]); res.end(fs.readFileSync(path.join(ROOT, "index.html")));
  });
  return new Promise(resolve => server.listen(port, () => resolve({
    url: `http://localhost:${server.address().port}`, log, blobs, openrouter, openrouterAuth,
    setEnv(vars){ for(const [k, v] of Object.entries(vars)){ if(v == null) delete process.env[k]; else process.env[k] = v; } },
    setOpenRouter(patch = {}){ if(patch.reset) or = DEFAULT_OR(); for(const k of ["models", "cost", "fail", "delay"]) if(k in patch) or[k] = patch[k]; return or; },
    close: () => new Promise(r => { remote.close(); server.close(r); }),
  })));
}
module.exports = { start };
if(require.main === module) start(+process.env.PORT || 8765).then(s => console.log("Pedala test server on " + s.url));
