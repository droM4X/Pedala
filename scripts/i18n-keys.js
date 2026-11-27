// Dev tool: walk every view and dialog with the seen-key recorder and write lang/keys.json.
// The app records the keys it passes through t()/tHtml() and the one-time static DOM pass when it is
// opened with ?i18n=keys, so one English walk covers the live text. Literal t()/tHtml() calls and
// data-i18n values are added from index.html for branches a walk cannot reach (confirm/prompt text,
// error paths), and the two language-select lists are ordinary English keys.
//
//   npm run i18n:keys
//
// Needs the dev-only Playwright install used by the e2e tests:
//   npm i --no-save playwright && npx playwright install chromium
// The walker is not part of npm test; it is slow and only run when the key list needs refreshing.
const fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const { start } = require("../tests/support/server.js");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "lang", "keys.json");
const HTML = path.join(ROOT, "index.html");

/* Literal keys that a walk cannot always execute: confirm()/prompt() text, error toasts, and markup
   that is replaced wholesale. Also every data-i18n value (the walk sees those too, but the HTML file
   stays the source and a missing dialog must not drop one). */
function staticKeys(html){
  const out = new Set(), add = s => { const k = s.trim(); if(k) out.add(k); };
  const unquote = s => s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => {
    if(c[0] === "u") return String.fromCharCode(parseInt(c.slice(1), 16));
    return { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" }[c] ?? c;
  });
  for(const m of html.matchAll(/\b(?:t|tHtml)\(\s*"((?:\\.|[^"\\])*)"/g)) add(unquote(m[1]));
  for(const m of html.matchAll(/\btn\(\s*[^,()]+,\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"/g)){ add(unquote(m[1])); add(unquote(m[2])); }
  for(const m of html.matchAll(/data-i18n="([^"]*)"/g)) add(m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  return out;
}

/* A key list is the translator's source: drop the empty strings some empty attributes produce, bare
   numbers/times/symbols, and URLs that are never translated. Everything else, including proper nouns
   and units, stays so the language file can decide. */
/* text nodes the static pass splits at inline markup; they are never translated */
const NOISE = new Set(["Ped", "ala", "Pedala", "Pedala v"]);
const useful = k => /\p{L}/u.test(k) && !/^https?:\/\//i.test(k) && !NOISE.has(k);

(async () => {
  const srv = await start(), B = srv.url;
  srv.setEnv({ YOUTUBE_API_KEY: "AIzaSERVER", ANTHROPIC_API_KEY: "sk-test" });
  const browser = await chromium.launch(), pageErrors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "en-US" });
  /* a saved English voice, and remembered devices so the Settings status has text to show */
  await ctx.addInitScript(() => {
    speechSynthesis.getVoices = () => [{ name: "English Voice", lang: "en-US", voiceURI: "English Voice", localService: true }];
    window.SpeechSynthesisUtterance = function(text){ this.text = text; };
    speechSynthesis.speak = u => setTimeout(() => u.onend && u.onend(), 0);
    if(!localStorage.getItem("pedala.settings")) localStorage.setItem("pedala.settings", JSON.stringify({ hrOn: true, clickOn: true, coachMode: "off" }));
    if(!localStorage.getItem("pedala.devices")) localStorage.setItem("pedala.devices", JSON.stringify({ trainer: "t1", hr: "h1", clicks: ["c1"], clickRoles: { c1: "plus" } }));
  });
  const p = await ctx.newPage();
  p.on("pageerror", e => pageErrors.push(e.message));
  p.on("dialog", d => d.accept());
  await p.route("https://www.youtube.com/embed/**", r => r.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await p.route("https://i.ytimg.com/**", r => r.fulfill({ body: "" }));

  const step = async (name, fn) => { process.stdout.write("  " + name + "… "); await fn(); console.log("ok"); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = async sel => { await p.click(sel); await wait(120); };
  const view = async name => { await click(`[data-view="${name}"]`); await wait(250); };

  try{
    console.log("i18n keys: walking the app");
    await p.goto(`${B}/?i18n=keys&simspeed=200`);
    await p.waitForFunction(() => window.__pedala && document.documentElement.dataset.i18n === "ready", null, { timeout: 10000 });

    await step("stage picker, video and music", async () => {
      await p.evaluate(() => {
        store.set("recentVideos", [{ id: "dQw4w9WgXcQ", title: "Imported video title", channel: "Some channel" }]);
        store.set("recentMusic", [{ id: "dQw4w9WgXcQ", title: "Imported song" }]);
        showPicker();
      });
      await p.waitForSelector("#vid-recent .vcard");
      await p.waitForSelector("#mus-recent .vcard");
      await p.waitForFunction(() => document.querySelectorAll("#feed-today .vcard").length > 0, null, { timeout: 10000 }).catch(() => {});
      await p.fill("#vid-url", "stelvio"); await p.press("#vid-url", "Enter");
      await p.waitForSelector("#vid-results .vcard", { timeout: 10000 });
      await p.fill("#mus-url", "workout"); await p.press("#mus-url", "Enter");
      await p.waitForSelector("#mus-results .vcard", { timeout: 10000 });
      await p.evaluate(() => { setVideo("dQw4w9WgXcQ"); setDash(); });
      await wait(100);
      await p.evaluate(() => { showPicker(); setMusic({ id: "dQw4w9WgXcQ" }); });
      await p.evaluate(() => setMusic({ list: "PLmine123456" }));
      await p.evaluate(() => { setMusic(null); setDash(); });
    });

    await step("Ride HUD, route and every built-in interval", async () => {
      await p.evaluate(() => {
        S.live = { power: 200, cadence: 90, hr: 150, speed: 28 };
        setRoute(BUILTIN_ROUTES[1]);
        render();
        S.route = null; store.set("lastRoute", null);
        for(const w of allWorkouts()){
          setWorkout(w);
          let acc = 0;
          for(let i = 0; i < w.segs.length; i++){ S.woT = acc; render(); acc += w.segs[i].d; }
        }
        setWorkout({ id: "keys-free", name: "Keys free", segs: [
          { d: 60, lo: .5, hi: .5, free: true }, { d: 60, lo: .5, hi: .5, free: true }, { d: 60, lo: .5, hi: .5 }] });
        S.woT = 0; render(); S.woT = 60; render(); S.woT = 120; render();
        setWorkout(allWorkouts().find(w => w.id === "b-ss"));
        S.soft = { k: .4 }; S.running = true; render();
        S.soft = null; S.running = false; setWorkout(null); render();
      });
    });

    await step("Settings, device status and the Click timer", async () => {
      await view("settings");
      await p.click("#btn-voice-test");
      await click("#btn-bt-auto");
      await p.evaluate(() => {
        btState.api = true; btState.permitted = 1;
        btState.roles = { trainer: "connected", hr: "waiting for it to switch on", clickPlus: "waiting for it to switch on",
          clickMinus: "connected", click: "did not show up (open the app again)" };
        renderBtState();
        new ZwiftClick("keys").onStatus("on");
      });
      await click("#btn-click-cal");
      await p.evaluate(() => document.querySelector("#dlg-click").close());
    });

    await step("Workouts, routes and import errors", async () => {
      await p.evaluate(() => store.set("workouts", [{ id: "z-keys", name: "Endurance 60", desc: "Imported ride.", segs: [{ d: 60, lo: .5, hi: .5 }], imported: true }]));
      await view("workouts");
      const uploads = [
        ["#zwo-file", "bad.zwo", "not xml"],
        ["#zwo-file", "empty.zwo", "<workout_file><name>x</name></workout_file>"],
        ["#zwo-file", "nosegs.zwo", "<workout></workout>"],
        ["#gpx-file", "bad.gpx", "not xml"],
        ["#gpx-file", "empty.gpx", "<gpx></gpx>"],
        ["#gpx-file", "flat.gpx", '<gpx><trk><trkseg><trkpt lat="45" lon="13"/><trkpt lat="45.001" lon="13.001"/></trkseg></trk></gpx>'],
        ["#gpx-file", "short.gpx", '<gpx><trk><trkseg><trkpt lat="45" lon="13"><ele>100</ele></trkpt><trkpt lat="45.0001" lon="13.0001"><ele>101</ele></trkpt></trkseg></trk></gpx>']
      ];
      for(const [sel, name, body] of uploads){ await p.setInputFiles(sel, { name, mimeType: "text/xml", buffer: Buffer.from(body) }); await wait(250); }
    });

    await step("History with saved rides", async () => {
      await p.evaluate(async () => {
        const ride = (id, extra) => ({ id, start: Date.now() - 3600e3, workoutId: null, name: "Imported ride", route: false, ftp: 230, maxHr: 190,
          samples: Array.from({ length: 120 }, (_, i) => [i, 180 + (i % 40), 90, 150, 0, 60 * (i + 1), 0]),
          m: { duration: 120, avgP: 200, maxP: 260, np: 210, tss: 20, IF: .87, kj: 24, distance: 2000, avgHr: 150, maxHr: 175, avgCad: 90,
            best: { s5: 600, m1: 450, m5: 330, m20: 260 } }, laps: [], ...extra });
        await dbPut(ride("r-keys-1", { laps: [{ name: "Interval 1", kind: "power", t0: 0, dur: 60, km: .5, avgP: 200, avgHr: 150, avgCad: 90,
          tgt: 210, score: 95, hit: true }], workoutId: "b-ss" }));
        await dbPut(ride("r-keys-2", { start: Date.now() - 2 * 3600e3, laps: [{ name: "Lap 1", kind: "dist", t0: 0, dur: 10, km: .2, avgP: 180, avgCad: 88 }] }));
      });
      await view("history");
      await p.waitForFunction(() => document.querySelectorAll("#ride-list [data-rep]").length === 2, null, { timeout: 5000 });
      for(const i of [0, 1]){
        await p.locator("#ride-list [data-rep]").nth(i).click();
        await p.waitForFunction(() => /Ride timeline|Laps|Intervals/.test(document.querySelector("#rep-body").textContent), null, { timeout: 5000 });
        await wait(300);
        await p.evaluate(() => document.querySelector("#dlg-report").close());
      }
    });

    await step("Plan start cards", async () => { await view("plan"); await p.waitForSelector("#plan-go"); });

    await step("running plan, every week and session", async () => {
      await p.fill("#plan-start", "2026-11-25");   // a Wednesday: the walk also sees the Monday confirm
      await click("#plan-go");
      await p.evaluate(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const start = ymd(d);
        store.set("plan", { id: PLAN.id, start, extra: true, extraFrom: start, times: { wk: "18:00", sun: "09:00" }, remind: 120,
          done: { "w1-tue": "r-keys-1" }, skipped: { "w1-thu": true }, swap: { "w1-sun": "p-rec" } });
      });
      await view("plan");
      await p.waitForFunction(() => document.querySelectorAll("#plan-weeks .week").length === 14, null, { timeout: 5000 });
      await p.evaluate(() => { for(const x of planSessions()){ openSession(x); document.querySelector("#dlg-sess").close(); } });
      await p.evaluate(() => { planToday(); store.set("planToldOn", ""); planToday(); });
      await click("#plan-restart");                 // prompt text, accepted empty
    });

    await step("strength plan and guided player", async () => {
      await p.evaluate(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        store.set("plan", { id: STRENGTH.id, start: ymd(d), done: {}, skipped: {} });
      });
      await view("plan");
      await p.waitForFunction(() => document.querySelectorAll("#plan-weeks .week").length === 12, null, { timeout: 5000 });
      await p.evaluate(() => { for(const x of planSessions()){ openSession(x); document.querySelector("#dlg-sess").close(); } });
      for(const k of ["A", "B", "C"]){
        await p.evaluate(k => startStrength(strengthWorkout(k, 0)), k);
        await click("#wk-pause"); await click("#wk-pause");
        await p.evaluate(() => { for(let i = 0; i < 400 && document.querySelector("#dlg-strength").open; i++) document.querySelector("#wk-skip").onclick(); });
        await wait(100);
      }
      await p.evaluate(() => startStrength(strengthWorkout("A", 0)));
      await click("#wk-end");
      await p.evaluate(() => document.querySelector("#dlg-strength").close());
    });

    await step("Progress, coach box and thread", async () => {
      await p.evaluate(() => {
        const now = Date.now(), id = planSessions()[0]?.id || "w1-mon";
        store.set("coach", {
          "ride:r-keys-1": { text: "Good workout.", at: now, title: "Imported ride", date: now, usd: .003 },
          "ride:r-keys-2": { pending: true, at: now, title: "Imported ride", date: now },
          "icu:i777": { error: "boom", at: now, title: "Jutarnje trčanje", date: now }
        });
        store.set("coachChat", [
          { q: "I have a cold, what about this week?", at: now - 2000, a: "Rest instead.", usd: .004,
            changes: [{ session_id: id, action: "replace", workout_id: "p-rec", reason: "cold" },
              { session_id: id, action: "skip", workout_id: null }, { session_id: id, action: "restore", workout_id: null }] },
          { q: "Next week?", at: now - 1000, pending: true },
          { q: "Anything else?", at: now - 500, error: "no answer" }
        ]);
      });
      await view("progress");
      await wait(500);
    });

    await step("Ride, summary and report FTP estimate", async () => {
      await view("ride");
      await click("#chip-trainer"); await click("#c-sim");
      await click("#btn-start"); await wait(900);
      await click("#btn-start");                 // Pause, then Resume
      await click("#btn-start"); await wait(300);
      await click("#btn-end");
      await p.waitForSelector("#dlg-summary[open]", { timeout: 5000 });
      await p.evaluate(() => document.querySelector("#dlg-summary").close());
      await p.evaluate(() => {
        S.workout = allWorkouts().find(w => w.id === "b-ramp"); S.route = null; S.startMs = Date.now() - 120e3; S.laps = []; S.lap = null;
        S.samples = Array.from({ length: 120 }, (_, i) => [i, 300 + (i % 40), 90, 150, 0, 60 * (i + 1), 0]);
        openSummary();
      });
      await p.waitForSelector("#dlg-summary[open]", { timeout: 5000 });
      await p.evaluate(() => document.querySelector("#dlg-summary").close());
    });

    await step("remote dialog", async () => {
      await p.evaluate(() => { __pedala.remote.links = ["http://192.168.0.20:8765/gear.html"]; __pedala.openRemote(); });
      await wait(200);
      await p.evaluate(() => { __pedala.remote.links = []; __pedala.openRemote(); });
      await wait(200);
      await p.evaluate(() => document.querySelector("#dlg-remote").close());
    });

    const seen = await p.evaluate(() => [...PedalaI18n.seen]);
    const literals = staticKeys(fs.readFileSync(HTML, "utf8"));
    const keys = [...new Set([...seen, ...literals])].filter(useful).sort((a, b) => a.localeCompare(b));
    fs.writeFileSync(OUT, JSON.stringify(keys, null, 2) + "\n");
    console.log(`\nkeys: ${keys.length} (${seen.length} seen in the walk, ${literals.size} static literals) → ${path.relative(ROOT, OUT)}`);
    if(pageErrors.length) throw new Error("page errors:\n" + pageErrors.join("\n"));
  } finally{
    await browser.close(); await srv.close();
  }
})().catch(e => { console.error("\ni18n keys failed: " + (e?.stack || e)); process.exit(1); });
