/* Pedala i18n core: a classic script (UMD for Node tests).
   English is built in and is never a language file. A language file calls PedalaI18n.add({...}). */
(function(root, factory){
  const api = factory();
  if(typeof module === "object" && module.exports) module.exports = api;
  if(root) root.PedalaI18n = api;
})(typeof window !== "undefined" ? window : globalThis, function(){
  "use strict";

  /* ---------- English speech defaults, copied from the app's original builders ---------- */
  const watts = n => `${n} ${n === 1 ? "watt" : "watts"}`;
  function duration(sec){
    sec = Math.round(sec); const m = Math.floor(sec / 60), x = sec % 60;
    const mm = m ? `${m} ${m === 1 ? "minute" : "minutes"}` : "";
    const ss = x ? `${x} ${x === 1 ? "second" : "seconds"}` : "";
    return [mm, ss].filter(Boolean).join(" and ");
  }
  function cadence(lo, hi, any = 999){
    return hi >= any ? `cadence ${lo} or more` : `cadence ${lo} to ${hi}`;
  }
  function segment(seg, ctx = {}){
    const note = seg.note ? seg.note + ". " : "";
    const cad = seg.cad ? ", " + cadence(seg.cad[0], seg.cad[1], ctx.anyCad) : "";
    const d = duration(seg.d);
    let power;
    if(seg.free) power = `${d} free riding`;
    else if(seg.hr) power = `${d} at heart rate ${seg.hr}`;
    else power = Math.abs(seg.loW - seg.hiW) < 5 ? `${d} at ${watts(seg.loW)}` : `${d}, from ${seg.loW} to ${watts(seg.hiW)}`;
    return note + power + cad;
  }
  function lap(lap, _ctx){
    if(lap.cadTgt){   // drill laps: report only the drill parts, stay quiet on recoveries
      if(lap.cadTgt[0] >= 100 || lap.cadTgt[1] <= 70) return `Average cadence ${lap.avgCad}.`;
      return "";
    }
    if(lap.kind === "dist") return `${lap.km} kilometers. Last ${lap.kmLimit} in ${duration(lap.dur)}, average ${watts(lap.avgP)}.`;
    if(lap.score != null && lap.dur >= 30) return lap.kind === "hr" ? `Interval done. Average heart rate ${lap.avgHr}.`
      : `Interval done. Average ${watts(lap.avgP)}, ${lap.score} percent.`;
    return "";
  }
  const finish = route => route ? "You made it to the finish." : "Workout complete. Well done.";
  function strength(step, next){
    if(step.kind === "rest") return `Rest. Next: ${next?.n || ""}.`;
    if(step.kind === "work") return `${step.n || ""}, ${step.s} seconds.`;
    return step.n || "";
  }
  const start = () => "Workout starting.";
  const soon = text => `In 10 seconds: ${text}.`;
  const englishSpeech = { watts, duration, cadence, segment, lap, finish, strength, start, soon };

  /* ---------- registry ---------- */
  const english = { code: "en", name: "English", locale: "en-GB", dir: "ltr", strings: {}, speech: englishSpeech };
  const languages = new Map([["en", english]]);
  const seen = new Set();
  let manifest = [];
  let active = english, code = "en", locale = "en-GB", dir = "ltr", speechLang = "en";
  let record = false;

  function fail(msg){ throw new TypeError("PedalaI18n: " + msg); }
  function checkLanguage(lang){
    if(!lang || typeof lang !== "object") fail("a language must be an object");
    if(typeof lang.code !== "string" || !/^[a-z]{2,3}$/.test(lang.code)) fail("code must be 2 or 3 lowercase letters");
    if(typeof lang.name !== "string" || !lang.name.trim()) fail("name must be a non-empty string");
    if(!lang.strings || typeof lang.strings !== "object" || Array.isArray(lang.strings)) fail("strings must be an object");
    for(const [k, v] of Object.entries(lang.strings)) if(typeof v !== "string") fail(`strings[${JSON.stringify(k)}] must be a string`);
    for(const k of ["plural", "tn", "date", "number"]) if(lang[k] != null && typeof lang[k] !== "function") fail(k + " must be a function");
    if(lang.dir != null && lang.dir !== "ltr" && lang.dir !== "rtl") fail("dir must be ltr or rtl");
    if(lang.locale != null && typeof lang.locale !== "string") fail("locale must be a string");
    if(lang.speech != null){
      if(typeof lang.speech !== "object" || Array.isArray(lang.speech)) fail("speech must be an object");
      for(const [k, v] of Object.entries(lang.speech)) if(typeof v !== "function") fail(`speech.${k} must be a function`);
    }
    return lang;
  }
  function add(lang){
    checkLanguage(lang);
    languages.set(lang.code, lang);
    return lang;
  }
  function use(next){
    const l = languages.get(next);
    if(!l) return false;
    active = l; code = l.code; locale = l.locale || l.code; dir = l.dir || "ltr"; speechLang = l.code;
    return true;
  }

  /* ---------- text ---------- */
  function t(key, vars){
    const k = String(key);
    if(record) seen.add(k);
    const s = active.strings[k] ?? k;
    return s.replace(/\{(\w+)\}/g, (_, name) => vars?.[name] ?? `{${name}}`);
  }
  function tHtml(key, vars){ return t(key, vars); }
  function tn(n, one, other, vars){
    if(typeof active.tn === "function") return active.tn(n, one, other, vars);
    const form = typeof active.plural === "function" ? active.plural(n) : (n === 1 ? "one" : "other");
    return t(form === "one" ? one : other, { ...(vars || {}), n });
  }

  /* ---------- dates and numbers ---------- */
  const dateCache = new Map(), numberCache = new Map();
  function td(value, opts){
    if(typeof active.date === "function") return active.date(value, opts);
    const key = locale + "|" + JSON.stringify(opts || {});
    let f = dateCache.get(key);
    if(!f){ f = new Intl.DateTimeFormat(locale, opts); dateCache.set(key, f); }
    return f.format(value);
  }
  function tnum(n, opts){
    if(typeof active.number === "function") return active.number(n, opts);
    const key = locale + "|" + JSON.stringify(opts || {});
    let f = numberCache.get(key);
    if(!f){ f = new Intl.NumberFormat(locale, opts); numberCache.set(key, f); }
    return f.format(n);
  }

  /* ---------- one-time static DOM pass ---------- */
  const ATTRS = ["placeholder", "aria-label", "title", "alt"];
  function localizeDom(root){
    if(typeof document === "undefined" || !root) return;
    if(root.querySelectorAll){
      root.querySelectorAll("[data-i18n]").forEach(el => {
        if(el.closest("script,style,canvas,noscript")) return;
        const key = el.getAttribute("data-i18n") || el.innerHTML;
        if(!key) return;
        const val = tHtml(key);
        if(val !== key) el.innerHTML = val;   // English leaves the markup exactly as it was
      });
      root.querySelectorAll(ATTRS.map(a => `[${a}]`).join(",")).forEach(el => {
        for(const a of ATTRS){
          if(!el.hasAttribute(a)) continue;
          const v = el.getAttribute(a), out = t(v);
          if(out !== v) el.setAttribute(a, out);
        }
      });
    }
    const doc = root.ownerDocument || root;
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);   // text nodes only
    const nodes = [];
    for(let n; (n = walker.nextNode());) nodes.push(n);
    for(const n of nodes){
      const parent = n.parentElement;
      if(!parent || parent.closest("script,style,canvas,noscript,[data-i18n]")) continue;
      const raw = n.nodeValue, key = raw.trim();
      if(!key) continue;
      const out = t(key);
      if(out !== key) n.nodeValue = raw.replace(key, out);
    }
  }

  /* ---------- manifest and loader ---------- */
  function loadIndex(){
    if(typeof fetch !== "function") return Promise.resolve();
    return fetch("/lang/index.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null).then(j => {
      if(Array.isArray(j)) manifest = j.filter(e => e && typeof e.code === "string" && /^[a-z]{2,3}$/.test(e.code))
        .map(e => ({ code: e.code, name: typeof e.name === "string" ? e.name : e.code, v: e.v }));
    }).catch(() => {});
  }
  const pending = new Map();
  function load(next, version){
    if(typeof next !== "string" || !/^[a-z]{2,3}$/.test(next)) return Promise.resolve(null);
    if(languages.has(next)) return Promise.resolve(languages.get(next));
    if(pending.has(next)) return pending.get(next);
    if(typeof document === "undefined" || typeof fetch !== "function") return Promise.resolve(null);
    const p = new Promise(resolve => {
      let done = false, script = null;
      const timer = setTimeout(() => finish(null), 3000);
      const poll = setInterval(() => { if(languages.has(next)) finish(languages.get(next)); }, 25);
      function finish(l){
        if(done) return;
        done = true; clearTimeout(timer); clearInterval(poll);
        if(!l && script) script.remove();
        resolve(l || null);
      }
      const v = version || manifest.find(e => e.code === next)?.v;
      const url = "/lang/" + next + ".js" + (v ? "?v=" + encodeURIComponent(v) : "");
      fetch(url).then(r => {
        if(done) return;
        if(!r.ok) return finish(null);
        const mime = (r.headers.get("content-type") || "").toLowerCase();
        if(!/javascript|ecmascript/.test(mime)) return finish(null);   // the test server's HTML fallback is not a language
        script = document.createElement("script");
        script.src = url;
        script.onload = () => { if(languages.has(next)) finish(languages.get(next)); };
        script.onerror = () => finish(null);
        document.head.append(script);
      }).catch(() => finish(null));
    });
    pending.set(next, p);
    p.finally(() => pending.delete(next));
    return p;
  }
  function available(){
    const out = new Map();
    for(const e of manifest) out.set(e.code, { code: e.code, name: e.name });
    out.set("en", { code: "en", name: english.name });
    for(const [c, l] of languages) out.set(c, { code: c, name: l.name });
    return [...out.values()];
  }
  const delay = ms => new Promise(r => setTimeout(r, ms));

  async function init(pref){
    let chosen = "";
    try{
      const indexDone = loadIndex();
      if(pref){
        const p = String(pref).toLowerCase();
        if(p === "en") chosen = "en";
        else if(/^[a-z]{2,3}$/.test(p)){
          if(languages.has(p)) chosen = p;
          else if(await load(p)) chosen = p;
        }
        if(!chosen) chosen = "en";
      } else {
        const tags = (typeof navigator !== "undefined" && (navigator.languages || [navigator.language])) || [];
        for(const tag of tags){
          const base = String(tag || "").toLowerCase().split("-")[0];
          if(!/^[a-z]{2,3}$/.test(base)) continue;
          if(base === "en"){ chosen = "en"; break; }
          if(languages.has(base)){ chosen = base; break; }
          if(await load(base)){ chosen = base; break; }
        }
      }
      await Promise.race([indexDone, delay(1500)]);   // the selector likes the index, but boot does not wait for it
    }catch{ chosen = "en"; }
    if(!chosen || !use(chosen)) use("en");
    if(typeof document !== "undefined"){
      document.documentElement.lang = code;
      document.documentElement.dir = dir;
      try{ localizeDom(document); }catch{}
    }
  }

  const api = {
    add, use, t, tHtml, tn, td, tnum, localizeDom, init, load, available,
    setSpeechLang(lang){ speechLang = lang || "en"; },
    languages, seen,
    get speech(){
      if(speechLang === active.code && active.speech && active.speech !== englishSpeech) return Object.assign({}, englishSpeech, active.speech);
      return englishSpeech;
    },
    get code(){ return code; },
    get locale(){ return locale; },
    get active(){ return active; },
    get dir(){ return dir; },
    get speechLang(){ return speechLang; },
    get record(){ return record; },
    set record(v){ record = !!v; },
    get manifest(){ return manifest; },
  };
  return api;
});
