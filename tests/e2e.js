// End-to-end tests in Chromium (Playwright) against tests/support/server.js and the built-in trainer simulator.
// Run: npm i --no-save playwright && npx playwright install chromium && npm test
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { start } = require("./support/server.js");

const results = [];
async function test(name, fn){
  const t0 = Date.now();
  try{ await fn(); results.push(["ok", name, null, Date.now() - t0]); }catch(e){ results.push(["FAIL", name, e, Date.now() - t0]); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = await start(), B = srv.url, browser = await chromium.launch(), pageErrors = [];
  /* a fresh browser profile; fake YouTube player that answers volume questions and records commands */
  async function open({ viewport = { width: 1280, height: 860 }, speed = 100, voices = [], settings, mobile = false, locale = "hr-HR", cookies = [] } = {}){
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, acceptDownloads: true, locale });
    if(cookies.length) await ctx.addCookies(cookies.map(([name, value]) => ({ name, value, url: B })));
    const p = await ctx.newPage(); p.on("pageerror", e => pageErrors.push(e.message)); p.on("dialog", d => d.accept());
    await p.route("https://www.youtube.com/embed/**", r => r.fulfill({ contentType: "text/html", body: `<body><script>
      let vol = 70; addEventListener("message", e => { const d = JSON.parse(e.data);
        if(d.event === "listening") parent.postMessage(JSON.stringify({ event: "infoDelivery", info: { volume: vol } }), "*");
        if(d.event === "command"){ if(d.func === "setVolume") vol = d.args[0]; parent.postMessage({ rec: d.func + "(" + d.args.join(",") + ")" }, "*"); } });</script></body>` }));
    await p.route("https://i.ytimg.com/**", r => r.fulfill({ body: "" }));
    await p.addInitScript(([vs, st]) => {
      window.__spoken = []; window.__rec = []; addEventListener("message", e => { if(e.data?.rec) __rec.push(e.data.rec); });
      speechSynthesis.getVoices = () => vs.map(([name, lang]) => ({ name, lang, voiceURI: name, localService: true }));
      window.SpeechSynthesisUtterance = function(t){ this.text = t; };
      speechSynthesis.speak = u => { __spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 200); };
      if(st && !localStorage.getItem("pedala.settings")) localStorage.setItem("pedala.settings", JSON.stringify(st));
    }, [voices, settings]);
    await p.goto(`${B}/?simspeed=${speed}`); await p.waitForTimeout(400);
    return p;
  }
  const ride = async (p, secs) => { await p.click('[data-view="ride"]'); await p.click("#btn-start"); await p.waitForTimeout(secs); await p.click("#btn-end"); await p.waitForTimeout(500); };

  await test("soft start: flat road before the start and in pause, ERG ramps up from 40% FTP", async () => {
    const p = await open({ speed: 10 });
    await p.click("#chip-trainer"); await p.click("#c-sim");
    await p.evaluate(() => { const t = __pedala.S.trainer; window.__cmd = []; const sp = t.setPower.bind(t), sg = t.setGrade.bind(t);
      t.setPower = w => { __cmd.push(Math.round(w)); sp(w); }; t.setGrade = g => { __cmd.push("g" + g); sg(g); }; });
    await p.evaluate(() => setWorkout(allWorkouts().find(w => w.id === "b-ss")));
    assert.equal(await p.evaluate(() => __cmd.at(-1)), "g0", "flat road before the start");
    await p.click("#btn-start"); await p.waitForTimeout(2200);
    const erg = await p.evaluate(() => __cmd.filter(x => typeof x === "number"));
    assert.equal(erg[0], 92, "first ERG target is 40% of 230 W"); assert.ok(erg.at(-1) > erg[0] + 10, "then ramps toward the target");
    await p.evaluate(() => { __sim.stopped = true; }); await p.waitForTimeout(900);
    assert.equal(await p.evaluate(() => __cmd.at(-1)), "g0", "flat road when auto-paused");
    await p.context().close();
  });

  await test("intervals.icu: a saved ride is uploaded with the key from Settings", async () => {
    const p = await open();
    await p.click('[data-view="settings"]'); await p.fill("#icu-key", "goodkey"); await p.click("#btn-icu"); await p.waitForTimeout(600);
    assert.match(await p.textContent("#icu-status"), /Test Rider/);
    await p.click("#chip-trainer"); await p.click("#c-sim"); await ride(p, 1500); await p.click("#sum-save"); await p.waitForTimeout(1500);
    const icu = await p.evaluate(async () => (await dbAll())[0].icu);
    assert.equal(icu.status, "done"); assert.match(icu.activityId, /^i9\d\d$/);
    await p.context().close();
  });

  await test("plan: start, ride today's session, it is ticked off; calendar has 42 events with reminders", async () => {
    const p = await open({ speed: 200 });
    const monday = await p.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); });
    await p.evaluate(m => store.set("plan", { id: PLAN.id, start: m, done: {}, skipped: {}, times: { wk: "18:00", sun: "09:00" }, remind: 120 }), monday);
    const max = await p.evaluate(() => Math.max(...PLAN.weeks.flatMap(w => w.slice(0, 2)).map(k => totalDur(PLAN_WO["p-" + k])))); assert.ok(max <= 1800, "weekday sessions are 30 min at most");
    const today = await p.evaluate(() => planSessions().find(s => s.today && isRide(s)));
    const ics = await p.evaluate(() => planIcs());
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 98, "42 rides, 28 swims, 28 runs"); assert.equal((ics.match(/TRIGGER:-PT120M/g) || []).length, 98);
    if(today){
      await p.evaluate(() => rideSession(planSessions().find(s => s.today && isRide(s))));
      await p.click("#chip-trainer"); await p.click("#c-sim"); await p.click("#btn-start");
      await p.waitForFunction(() => document.querySelector("#dlg-summary").open, null, { timeout: 120000 });
      await p.click("#sum-save"); await p.waitForTimeout(800);
      assert.ok(await p.evaluate(id => !!plan().done[id], today.id), "today's session is done");
    }
    await p.context().close();
  });

  await test("sync: a second device gets the ride and plan progress", async () => {
    const a = await open(), b = await open();
    await a.evaluate(() => { if(!plan()) store.set("plan", { id: PLAN.id, start: ymd(new Date()), done: {}, skipped: {} }); });
    await a.evaluate(() => syncNow()); await b.evaluate(() => syncNow()); await b.waitForTimeout(800);
    assert.ok(await b.evaluate(async () => (await dbAll()).length) >= 1, "rides arrived");
    assert.ok(await b.evaluate(() => !!plan()), "plan arrived");
    await a.context().close(); await b.context().close();
  });

  await test("voice: everything English without a Croatian voice, Croatian with one; YouTube is turned down while speaking", async () => {
    const en = await open({ voices: [["Samsung English", "en-US"]] });
    await en.click('[data-view="settings"]'); await en.click("#btn-voice-test"); await en.waitForTimeout(300);
    assert.equal((await en.evaluate(() => __spoken))[0], "In 10 seconds: 3 minutes at 265 watts, cadence 90 to 100.");
    await en.evaluate(() => setVideo("dQw4w9WgXcQ")); await en.waitForTimeout(800);
    await en.evaluate(() => say("Test.", true)); await en.waitForTimeout(1200);
    assert.deepEqual(await en.evaluate(() => __rec), ["setVolume(18)", "setVolume(70)"]);
    const hr = await open({ voices: [["Google hrvatski", "hr-HR"], ["Samsung English", "en-US"]] });
    await hr.click('[data-view="settings"]'); await hr.click("#btn-voice-test"); await hr.waitForTimeout(300);
    assert.match((await hr.evaluate(() => __spoken))[0], /^Za 10 sekundi: 3 minute na 265 vata/);
    await en.context().close(); await hr.context().close();
  });

  await test("English: a browser in English gets the whole app in English, Croatian stays for Croatian", async () => {
    const p = await open({ locale: "en-US", speed: 200 });
    const croatian = /[čćžšđ]|\b(je|na|ili|se|za|od|nije|treba|nema|vožnj\w*|trening\w*|Postavke|Spoji|Kreni|Tjedan|Zona|Puls|Kadenca|Brzina|Glazba|Snaga|Vrijeme|Još|Sljedeće)\b/i;
    const visible = () => p.evaluate(() => { const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for(let n; (n = w.nextNode());){ const e = n.parentElement; if(e.closest("script,style,[data-notr]") || !e.getClientRects().length) continue; const t = n.nodeValue.trim(); if(t) out.push(t); }
      document.querySelectorAll("[placeholder],[aria-label]").forEach(e => out.push(e.getAttribute("placeholder") || e.getAttribute("aria-label")));
      return out; });
    const left = [];
    const check = async where => { for(const t of await visible()) if(croatian.test(t) && !/^(Učka|Sljeme|Biokovo)/.test(t)) left.push(where + ": " + t); };
    await check("ride");
    for(const v of ["plan", "workouts", "history", "progress", "settings"]){ await p.click(`[data-view="${v}"]`); await p.waitForTimeout(300); await check(v); }
    await p.click('[data-view="plan"]'); if(await p.$("#plan-go")) await p.click("#plan-go"); await p.waitForTimeout(300); await check("plan started");   // the plan may have come from the sync test
    await p.click("#chip-trainer"); await check("connect"); await p.click("#c-sim");
    await p.evaluate(() => setWorkout(allWorkouts().find(w => w.id === "d-hilo"))); await p.click("#btn-start"); await p.waitForTimeout(2500); await check("riding");
    await p.click("#btn-end"); await p.waitForTimeout(1200); await check("summary"); await p.click("#sum-save"); await p.waitForTimeout(600);
    await p.click('[data-view="history"]'); await p.waitForTimeout(300); await p.locator("[data-rep]").first().click(); await p.waitForTimeout(1000); await check("report");
    assert.deepEqual(left, []);
    assert.equal(await p.textContent('[data-view="workouts"]'), "Workouts");
    assert.equal(await p.evaluate(async () => (await dbAll()).sort((a, b) => b.start - a.start)[0].name), "High and low cadence", "ride saved under its English name");
    await p.context().close();
    const hr = await open({ locale: "en-US", settings: { ftp: 230 } });
    assert.equal(await hr.textContent('[data-view="workouts"]'), "Treninzi", "a device that already used Pedala stays Croatian");
    await hr.click('[data-view="settings"]'); await hr.selectOption('[name="uiLang"]', "en"); await hr.waitForLoadState("load"); await hr.waitForTimeout(400);
    assert.equal(await hr.textContent('[data-view="workouts"]'), "Workouts", "switching the language in Settings");
    await hr.context().close();
  });

  await test("Zwift Click v2: each pod is its own + or − device, or both directions on one pod", async () => {
    const p = await open();
    await p.evaluate(() => {
      const mk = (id, role = null) => { const z = new ZwiftClick(role); z.device = { id, gatt: { connected: true } }; z.kind = "ride"; S.clicks.push(z); return z; };
      window.__r = mk("podRIGHT"); window.__l = mk("podLEFT1");
      // a press and release of button bit 5, then of bit 1: both pods may report the same bits
      window.__press = (z, bit = 5) => { const v = 0x3ffff & ~(1 << bit); z.frame(Uint8Array.from([0x23, 0x08, (v & 0x7f) | 0x80, ((v >> 7) & 0x7f) | 0x80, v >> 14]), false); z.frame(Uint8Array.from([0x23, 0x08, 0xff, 0xff, 0x0f]), false); };
      startCalibration(); __press(__r); __press(__l); S.workout = null; S.gear = 10;
    });
    assert.deepEqual(await p.evaluate(() => store.get("devices").clickRoles), { podRIGHT: "plus", podLEFT1: "minus" });
    assert.deepEqual(await p.evaluate(() => [$("#chip-click-p").textContent, $("#chip-click-p").className, $("#chip-click-m").textContent, $("#chip-click-m").className]),
      ["Click +", "chip on", "Click −", "chip on"]);
    for(const [z, bit] of [["__r", 5], ["__l", 5], ["__l", 1], ["__l", 9]]){ await p.evaluate(([z, bit]) => __press(window[z], bit), [z, bit]); await wait(300); }
    assert.equal(await p.evaluate(() => S.gear), 8, "+1 −1 −1 −1 from 10");
    // picking the other pod with Click +: the two swap roles
    await p.evaluate(async () => {
      if(!navigator.bluetooth) Object.defineProperty(navigator, "bluetooth", { value: {} });
      let next = ""; ZwiftClick.prototype.connect = async function(){ this.device = { id: next, gatt: { connected: false } }; this.kind = "ride"; };
      S.clicks.forEach(z => z.device.gatt.connected = false);
      next = "podLEFT1"; await connectClick("plus");
    });
    assert.deepEqual(await p.evaluate(() => store.get("devices").clickRoles), { podRIGHT: "minus", podLEFT1: "plus" });
    assert.equal(await p.evaluate(() => S.clicks.length), 2, "the same pod is replaced, not added twice");
    // the left pod often sends no presses: both directions on one pod, by button
    await p.evaluate(() => { const r = S.clicks.find(z => z.device.id === "podRIGHT"); window.__r2 = r; startCalibration(); __press(r, 5); __press(r, 1); S.gear = 10; });
    assert.equal(await p.evaluate(() => store.get("devices").clickRoles.podRIGHT), "keys");
    for(const bit of [5, 1, 1, 9]){ await p.evaluate(bit => __press(__r2, bit), bit); await wait(300); }
    assert.equal(await p.evaluate(() => S.gear), 9, "+1 −1 −1 and an unset button does nothing");
    assert.equal(await p.textContent("#chip-click-p"), "Click ±");
    // one tap: Y (bit 6) and the shift button (bit 12) up, B (bit 5) down
    await p.click("[data-view=\"settings\"]"); await p.click("#btn-click-yb"); await p.evaluate(() => { S.gear = 10; });
    for(const bit of [6, 12, 5, 5, 5]){ await p.evaluate(bit => __press(__r2, bit), bit); await wait(300); }
    assert.equal(await p.evaluate(() => S.gear), 9, "Y +1, shift +1, B −3");
    // keys set up before pods had roles still tell which pod is which
    await p.evaluate(() => { settings.clickMap = { "dOLDPD:b5": -1 }; });
    assert.equal(await p.evaluate(() => clickRoleOf("pod-dOLDPD")), "minus");
    await p.context().close();
  });

  await test("coach: a saved ride and a run from intervals.icu each get a comment, Pedala's own upload does not", async () => {
    srv.setEnv({ ANTHROPIC_API_KEY: "sk-test" }); srv.claude.length = 0;
    const p = await open({ settings: { ftp: 160, maxHr: 185, weight: 100, coachAbout: "190 cm, vraćam se nakon pauze", coachMode: "each" } });
    await p.click('[data-view="settings"]'); await p.fill("#icu-key", "goodkey"); await p.click("#btn-icu"); await p.waitForTimeout(600);
    assert.match(await p.textContent("#coach-status"), /uključen \(ANTHROPIC_API_KEY/);
    await p.click("#chip-trainer"); await p.click("#c-sim"); await p.evaluate(() => setWorkout(allWorkouts().find(w => w.id === "b-ss")));
    await p.click("#btn-start"); await p.waitForTimeout(4000); await p.click("#btn-end"); await p.waitForTimeout(500); await p.click("#sum-save");
    await p.waitForFunction(() => Object.entries(store.get("coach", {})).some(([k, n]) => k.startsWith("ride:") && n.text), null, { timeout: 15000 });
    const ride = srv.claude.find(b => b.messages[0].content.includes("Pedala, trenažer"));
    assert.ok(ride, "the ride was sent to the coach");
    assert.equal(ride.model, "claude-opus-5-5"); assert.equal(ride.fallbacks, "default");
    assert.match(ride.messages[0].content, /190 cm, vraćam se nakon pauze/); assert.match(ride.messages[0].content, /po_minutama/);
    assert.match(ride.messages[0].content, /Jutarnje trčanje/, "the last six weeks from intervals.icu are included");
    // the run from the watch gets its own comment when the app checks intervals.icu
    await p.evaluate(() => { coachCheck.at = 0; return coachCheck(); });
    await p.waitForFunction(() => store.get("coach", {})["icu:i777"]?.text, null, { timeout: 15000 });
    assert.ok(!(await p.evaluate(() => store.get("coach", {})["icu:i555"])), "Pedala's own upload is not commented twice");
    await p.click('[data-view="progress"]'); await p.waitForTimeout(500);
    assert.equal(await p.locator("#coach-box .item").count(), 2);
    assert.match(await p.textContent("#coach-box"), /Dobar trening/);
    await p.click('[data-view="history"]'); await p.waitForTimeout(400); await p.locator("[data-rep]").first().click(); await p.waitForTimeout(600);
    assert.match(await p.textContent("#rep-coach"), /Dobar trening/);
    srv.setEnv({ ANTHROPIC_API_KEY: null }); await p.context().close();
  });

  await test("coach: a question gets an answer, a proposed plan change is applied only after confirming", async () => {
    srv.setEnv({ ANTHROPIC_API_KEY: "sk-test" }); srv.claude.length = 0;
    const p = await open();
    await p.evaluate(() => { settings.coachMode = "off"; });   // no weekly review in the middle of this test
    const first = await p.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      store.set("plan", { id: PLAN.id, start: ymd(d), done: {}, skipped: {}, times: { wk: "18:00", sun: "09:00" }, remind: 120 }); return planSessions()[0].id; });
    await p.click('[data-view="progress"]'); await p.waitForTimeout(800);
    await p.fill("#coach-q", "Prehlađen sam, što s ovim tjednom?"); await p.click("#coach-form button");
    await p.waitForFunction(() => coachChat().at(-1)?.a, null, { timeout: 15000 });
    const sent = srv.claude.at(-1);
    assert.equal(sent.output_config.format.type, "json_schema");
    assert.match(sent.messages[0].content, /Prehlađen sam/); assert.match(sent.messages[0].content, /"workout_id":"p-rec"|"id":"p-rec"/);
    assert.match(await p.textContent("#coach-thread"), /Odmori se/);
    assert.match(await p.textContent("#coach-thread"), /≈ \$0\.0[0-9]{2}/, "what the answer cost"); assert.match(await p.textContent("#coach-month"), /≈ \$0\.0/);
    assert.equal(await p.locator("#coach-thread li").count(), 1, "a change for a session that does not exist is dropped");
    assert.ok(!(await p.evaluate(() => plan().swap)), "nothing changes before confirming");
    await p.click("#coach-thread [data-apply]");
    assert.deepEqual(await p.evaluate(() => plan().swap), { [first]: "p-rec" });
    assert.equal(await p.evaluate(id => planSessions().find(x => x.id === id).w.name, first), "Aktivni oporavak");
    assert.match(await p.textContent("#coach-thread"), /Primijenjeno/);
    // a plain question: this week of the plan, no list of swaps, less effort
    await p.evaluate(() => coachQuestion("Kako napredujem?")); const plain = srv.claude.at(-1);
    assert.doesNotMatch(plain.messages[0].content, /Mogući treninzi/); assert.match(plain.messages[0].content, /Plan za ovaj tjedan/);
    assert.equal(plain.output_config.effort, "low");
    assert.ok((plain.messages[0].content.match(/"id":"w\d+-/g) || []).length <= 14, "one or two weeks of the plan");
    srv.setEnv({ ANTHROPIC_API_KEY: null }); await p.context().close();
  });

  await test("plan: swims and runs are in the plan and tick off from intervals.icu, the coach sees the day's target", async () => {
    srv.setEnv({ ANTHROPIC_API_KEY: "sk-test" }); srv.claude.length = 0;
    const p = await open();
    await p.evaluate(() => { settings.icuKey = "goodkey"; settings.coachMode = "each"; store.set("settings", settings);
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 4);   // today is the Friday of week 1
      store.set("plan", { id: PLAN.id, start: ymd(d), done: {}, skipped: {}, extra: true }); });
    const wk1 = await p.evaluate(() => planSessions().filter(x => x.week === 1).map(x => x.day + ":" + (x.w.sport || "ride")));
    assert.deepEqual(wk1, ["mon:swim", "tue:ride", "tue2:run", "wed:swim", "thu:ride", "fri:run", "sun:ride"]);
    assert.match(await p.evaluate(() => planSessions().find(x => x.id === "w1-mon").w.desc), /klizanje na prsima/);
    assert.equal(await p.evaluate(() => planSessions().find(x => x.id === "w5-fri").w.name), "Trčanje · 2,5 km lagano");
    assert.deepEqual(await p.evaluate(() => planSessions().filter(x => x.week === 14 && !x.w.segs).map(x => x.w.name)),
      ["Test · 400 m plivanja", "Brick · 15 min trčanja", "Plivanje · lagano (neobavezno)", "Test · 5 km trčanja"], "week 14: tests for the next block");
    assert.ok(await p.evaluate(() => planSessions().find(x => x.id === "w1-wed").optional), "Wednesday swim is optional");
    await p.click('[data-view="plan"]'); await p.waitForFunction(() => plan().done?.["w1-fri"], null, { timeout: 10000 });
    assert.equal(await p.locator(".sess .opt.missed").count(), 0, "a past optional swim is not missed"); assert.equal(await p.locator(".sess .opt").count() > 0, true);
    assert.equal(await p.evaluate(() => plan().done["w1-fri"]), "icu:i777", "today's run from the watch ticks off Friday's run");
    assert.deepEqual(await p.evaluate(() => ["Run", "TrailRun", "Swim", "OpenWaterSwim", "Ride"].map(icuSport)), ["run", "run", "swim", "swim", null]);
    await p.evaluate(() => { store.set("coach", {}); coachCheck.at = 0; return coachCheck(); });   // comments synced from the earlier coach test
    await p.waitForFunction(() => store.get("coach", {})["icu:i777"]?.text, null, { timeout: 15000 });
    assert.match(srv.claude.find(b => b.messages[0].content.includes("Jutarnje trčanje") && b.messages[0].content.includes("Trening koji komentiraš (intervals.icu)")).messages[0].content, /Što je plan tražio[\s\S]*1 km lagano/);
    // swims and runs added to a running plan count only from the day they were added
    assert.equal(await p.evaluate(() => { const q = { ...plan(), extraFrom: ymd(new Date()) }; return planSessions(q).filter(x => !x.w.segs && x.d < q.extraFrom).length; }), 0);
    await p.evaluate(() => planUpdate(q => { q.extra = false; }));
    assert.equal(await p.evaluate(() => planSessions().length), 42, "swims and runs can be switched off");
    srv.setEnv({ ANTHROPIC_API_KEY: null }); await p.context().close();
  });

  await test("coach: a weekly review instead of a comment after every session", async () => {
    srv.setEnv({ ANTHROPIC_API_KEY: "sk-test" }); srv.claude.length = 0;
    const p = await open(); await p.waitForTimeout(600);
    await p.evaluate(() => { settings.coachMode = "week"; store.set("settings", settings); });   // settings synced from earlier tests say "each"
    await p.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      store.set("plan", { id: PLAN.id, start: ymd(d), done: {}, skipped: {}, extra: true, extraFrom: ymd(d) }); });
    await p.click("#chip-trainer"); await p.click("#c-sim"); await p.click("#btn-start"); await p.waitForTimeout(3000); await p.click("#btn-end"); await p.waitForTimeout(400); await p.click("#sum-save"); await p.waitForTimeout(800);
    assert.ok(!srv.claude.some(b => b.messages[0].content.includes("Pedala, trenažer")), "no comment after the ride");
    await p.evaluate(() => coachWeek(true));
    const key = await p.evaluate(() => "week:" + ymd(lastSaturday()));
    assert.match(await p.evaluate(k => store.get("coach", {})[k]?.text, key), /Dobar trening/);
    const sent = srv.claude.find(b => b.system.includes("pregled proteklih sedam dana"));
    assert.ok(sent, "the weekly review prompt was used"); assert.match(sent.messages[0].content, /Plan: proteklih 7 dana/); assert.match(sent.messages[0].content, /Vožnje u Pedali proteklih 7 dana/);
    assert.equal(await p.evaluate(() => coachWeek()), null, "only once a week");
    srv.setEnv({ ANTHROPIC_API_KEY: null }); await p.context().close();
  });

  await test("strength at home: a 12-week plan of three circuits, a guided session ticks itself off", async () => {
    const p = await open({ speed: 200, voices: [["Google hrvatski", "hr-HR"]] });
    await p.evaluate(() => { settings.voice = true; const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      store.set("plan", { id: STRENGTH.id, start: ymd(d), done: {}, skipped: {} }); });
    const ss = await p.evaluate(() => planSessions().map(x => x.day + ":" + x.w.strength));
    assert.equal(ss.length, 36); assert.deepEqual(ss.slice(0, 3), ["mon:A", "wed:B", "fri:C"]);
    const [w1, w9, w12] = await p.evaluate(() => [0, 8, 11].map(i => { const w = strengthWorkout("A", i); return [w.min, w.steps.filter(s => s.kind === "work").length]; }));
    assert.deepEqual([w1[1], w9[1], w12[1]], [18, 24, 18], "3 rounds, then 4, then an easier last week");
    assert.ok(w1[0] >= 20 && w9[0] <= 45, "20 to 45 minutes");
    await p.click('[data-view="plan"]'); await p.waitForTimeout(300);
    assert.match(await p.textContent("#plan-body"), /Snaga kod kuće/);
    // run Monday's session in the player (200x faster): it announces the exercises and ticks Monday off
    await p.evaluate(() => { const x = planSessions()[0]; startStrength(x.w, x.id); });
    assert.equal(await p.evaluate(() => $("#dlg-strength").open), true);
    await p.waitForFunction(() => !$("#dlg-strength").open, null, { timeout: 30000 });
    assert.match(await p.evaluate(() => plan().done["w1-mon"]), /^app:/);
    const spoken = await p.evaluate(() => __spoken.join(" | "));
    assert.match(spoken, /Čučanj, 30 sekundi/); assert.match(spoken, /Odmor\. Sljedeće: Iskorak unazad/); assert.match(spoken, /Trening je gotov/);
    assert.ok(await p.evaluate(() => findWorkout("s-B-5")?.name.startsWith("Snaga B")), "the coach can swap a session for another circuit");
    await p.context().close();
  });

  await test("profiles: a second person has her own data on her own phone", async () => {
    srv.setEnv({ PEDALA_USER2: "ana", PEDALA_PASSWORD2: "x" });
    const p = await open({ cookies: [["pedala_ns", "ana"], ["pedala_session", "ana.test"]] });
    await p.evaluate(() => syncNow()); await p.waitForTimeout(800);
    assert.equal(await p.evaluate(() => LS), "pedala.ana.");
    assert.equal(await p.evaluate(async () => (await dbAll()).length), 0, "none of the main user's rides");
    assert.equal(await p.evaluate(() => plan()), null, "and not his plan");
    await p.evaluate(() => { store.set("plan", { id: STRENGTH.id, start: "2031-01-06", done: {}, skipped: {} }); return syncNow(); }); await p.waitForTimeout(500);
    assert.ok([...srv.blobs.keys()].some(k => k === "u/ana/state.json"), "her data is stored under her name");
    const main = await open(); await main.evaluate(() => syncNow()); await main.waitForTimeout(800);
    assert.notEqual(await main.evaluate(() => plan()?.start), "2031-01-06", "the main user does not get her plan");
    srv.setEnv({ PEDALA_USER2: null, PEDALA_PASSWORD2: null }); await p.context().close(); await main.context().close();
  });

  await test("feed: favourite channel videos and own playlist", async () => {
    srv.setEnv({ YOUTUBE_API_KEY: "AIzaSERVER" });
    const p = await open();
    await p.fill("#feed-ch", "https://www.youtube.com/@bikeworld"); await p.click("#feed-ch-form button"); await p.waitForTimeout(800);
    assert.equal(await p.locator("#feed-ch-videos .vcard").count(), 3);
    await p.fill("#feed-pl", "https://www.youtube.com/playlist?list=PLmine123456"); await p.click("#feed-pl-form button"); await p.waitForTimeout(800);
    assert.equal(await p.locator("#feed-pl-PLmine123456 .vcard").count(), 3, "private video skipped");
    srv.setEnv({ YOUTUBE_API_KEY: null }); await p.context().close();
  });

  await test("remote: the ride page listens, and a shift from outside moves the gear", async () => {
    const p = await open();
    await p.waitForFunction(() => __pedala.remote?.es?.readyState === 1);
    await p.waitForFunction(() => __pedala.S.gear === 10);
    await fetch(B + "/__remote/shift", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ d: 1 }) });
    await p.waitForFunction(() => __pedala.S.gear === 11, null, { timeout: 3000 });
    assert.equal(await p.evaluate(() => document.querySelector("#chip-remote").classList.contains("on")), false, "no phone yet");
    await p.context().close();
  });

  await test("remote: the phone shifts the running ride, and the chip follows it", async () => {
    const p = await open();
    await p.waitForFunction(() => __pedala.S.gear === 10);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: "en-US" });
    const ph = await ctx.newPage(); ph.on("pageerror", e => pageErrors.push(e.message));
    await ph.goto(B + "/gear.html");
    await ph.waitForFunction(() => document.querySelector("#dot").classList.contains("on"), null, { timeout: 5000 });
    assert.equal(await ph.textContent("#value"), "10", "the phone shows the gear the ride reports");
    assert.equal(await ph.textContent("#title"), "Pedala remote", "the connected title is restored");
    await ph.click("#up");
    await p.waitForFunction(() => __pedala.S.gear === 11, null, { timeout: 3000 });
    await ph.waitForFunction(() => document.querySelector("#value").textContent === "11", null, { timeout: 3000 });
    assert.equal(await p.evaluate(() => document.querySelector("#chip-remote").classList.contains("on")), true);
    await ctx.close();
    await p.waitForFunction(() => !document.querySelector("#chip-remote").classList.contains("on"), null, { timeout: 5000 });
    await p.context().close();
  });
  await test("remote: reconnect escalation preserves address and manual retry connects", async () => {
    const p = await open();
    await p.waitForFunction(() => __pedala.S.gear === 10);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: "en-US" });
    const ph = await ctx.newPage(); ph.on("pageerror", e => pageErrors.push(e.message));
    await ph.addInitScript(() => {
      const Real = window.EventSource;
      let fakes = 1;
      window.EventSource = function(url){
        if(fakes-- > 0 && String(url).includes("__remote")){
          const self = this, ls = {};
          self.readyState = 0;
          self.addEventListener = (t, f) => { (ls[t] = ls[t] || []).push(f); };
          self.close = () => { self.readyState = 2; clearInterval(self.timer); };
          const fire = t => { self["on" + t]?.({}); (ls[t] || []).forEach(f => f({})); };
          let n = 0;
          self.timer = setInterval(() => { if(++n > 5) return clearInterval(self.timer); fire("error"); }, 25);
          return;
        }
        return new Real(url);
      };
    });
    await ph.goto(B + "/gear.html");
    await ph.waitForFunction(() => !document.querySelector("#conn").hidden && /Cannot reach/.test(document.querySelector("#title").textContent), null, { timeout: 5000 });
    assert.equal(await ph.inputValue("#addr"), B, "the reconnect form is prefilled with the server URL");
    await ph.click('#conn button[type="submit"]');
    await ph.waitForFunction(() => document.querySelector("#dot").classList.contains("on"), null, { timeout: 5000 });
    assert.equal(await ph.textContent("#value"), "10", "manual retry receives the ride gear");
    await ctx.close();
    await p.context().close();
  });

  await test("remote modal: the chip opens a centered modal with the link and a QR code, the X closes it", async () => {
    const p = await open();
    await p.evaluate(() => { __pedala.remote.links = ["http://192.168.0.20:8765/gear.html"]; });
    await p.click("#chip-remote");
    const dlg = p.locator("#dlg-remote");
    assert.equal(await dlg.evaluate(d => d.open), true, "the chip opens the modal");
    assert.equal((await p.textContent("#remote-link")).trim(), "http://192.168.0.20:8765/gear.html");
    const svg = p.locator("#qr-box svg");
    assert.equal(await svg.count(), 1, "the QR is drawn");
    const box = await svg.boundingBox();
    const firstPath = await svg.locator("path").getAttribute("d");
    await p.evaluate(() => { __pedala.remote.links = ["http://192.168.7.7:8765/gear.html"]; __pedala.openRemote(); });
    assert.notEqual(await svg.locator("path").getAttribute("d"), firstPath, "the QR changes with the current link");
    assert.equal((await p.textContent("#remote-link")).trim(), "http://192.168.7.7:8765/gear.html");
    await p.evaluate(() => { __pedala.remote.links = []; __pedala.openRemote(); });
    assert.equal(await svg.count(), 0, "a missing address clears the QR");
    assert.equal(await p.locator("#remote-none").isVisible(), true);
    assert.ok(box.width > 100 && box.height > 100, `the QR has a size (${box.width}x${box.height})`);
    const centered = await dlg.evaluate(d => { const r = d.getBoundingClientRect();
      return Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 40 && Math.abs((r.top + r.bottom) / 2 - innerHeight / 2) < 40; });
    assert.equal(centered, true, "the modal is centered");
    await p.click("#dlg-remote [data-close]");
    assert.equal(await dlg.evaluate(d => d.open), false, "the X closes it");
    await p.context().close();
  });
  await test("remote modal: English labels are translated", async () => {
    const p = await open({ locale: "en-US" });
    await p.evaluate(() => __pedala.openRemote());
    assert.equal((await p.textContent("#remote-copy")).trim(), "Copy");
    assert.ok((await p.textContent("#remote-none")).startsWith("No network address"));
    await p.context().close();
  });
  await test("remote modal: without a LAN address it explains instead of drawing a QR", async () => {
    const p = await open();
    await p.evaluate(() => { __pedala.remote.links = []; __pedala.openRemote(); });
    assert.equal(await p.locator("#dlg-remote").evaluate(d => d.open), true);
    assert.equal(await p.locator("#qr-box svg").count(), 0, "no QR without an address");
    assert.equal(await p.locator("#remote-none").isVisible(), true, "an explanation is shown");
    assert.equal((await p.textContent("#remote-link")).trim(), "", "and no link");
    await p.context().close();
  });

  await test("remote: a deployed instance (no /__remote) costs one request and stops", async () => {
    const p = await browser.newContext().then(c => c.newPage());
    let hits = 0;
    await p.route("**/__remote/**", r => { hits++; r.fulfill({ status: 404, body: "no" }); });
    await p.goto(`${B}/?simspeed=100`); await p.waitForTimeout(2000);
    assert.equal(hits, 1, "a failed EventSource is not retried: one request, then it stops");
    await p.waitForTimeout(2000);
    assert.equal(hits, 1, "and it stays stopped");
    assert.equal(await p.evaluate(() => document.querySelector("#chip-remote").classList.contains("on")), false);
    await p.context().close();
  });

  await test("overlay: no heart-rate box without a strap, and the gear box takes its place", async () => {
    const p = await open();
    await p.click("#btn-dash"); await p.evaluate(() => render()); await p.waitForTimeout(200);
    const shown = s => p.evaluate(q => { const el = document.querySelector(q); return !!el && el.getClientRects().length > 0; }, s);
    assert.equal(await shown("#o-hr-box"), false, "no strap: no heart-rate box");
    assert.equal(await shown("#o-gear-box"), true, "the gear box is there instead");
    assert.equal(await p.textContent("#o-gear"), "10");
    assert.equal(await p.textContent("#o-gear-lbl"), "Brzina · omjer 2.04");
    await p.keyboard.press("ArrowUp"); await p.waitForTimeout(150);
    assert.equal(await p.textContent("#o-gear"), "11", "the gear box follows the shift");
    assert.equal(await p.textContent("#o-gear-lbl"), "Brzina · omjer 2.22");
    await p.evaluate(() => { __pedala.S.hrm = {}; render(); });   // a strap appears
    assert.equal(await shown("#o-hr-box"), true, "a strap brings the heart-rate box back");
    assert.equal(await shown("#o-gear-box"), true, "and the gear box stays, beside it");
    await p.context().close();
  });

  await test("ride stats: no heart-rate cell without a strap, and the cadence fills its place", async () => {
    const p = await open();
    const m = () => p.evaluate(() => {
      const st = document.querySelector(".stats"), cad = st.querySelector(".stat.cad"), hr = st.querySelector(".stat.hr");
      const other = st.querySelector(".stat:not(.cad):not(.hr)");
      const w = el => Math.round(el.getBoundingClientRect().width);
      return { cad: w(cad), other: w(other), h: Math.round(st.getBoundingClientRect().height), hrShown: hr.getClientRects().length > 0 };
    });
    let a = await m();
    assert.equal(a.hrShown, false, "no strap: no heart-rate cell");
    assert.ok(a.cad > a.other * 1.5, `the cadence takes the freed cell (${a.cad} vs ${a.other})`);
    const h = a.h;
    await p.evaluate(() => { __pedala.S.hrm = {}; render(); });
    a = await m();
    assert.equal(a.hrShown, true, "a strap brings the heart-rate cell back");
    assert.ok(Math.abs(a.cad - a.other) <= 2, `the cadence shares the row again (${a.cad} vs ${a.other})`);
    assert.ok(a.h <= h, `and the panel is no taller without a strap (${a.h} vs ${h})`);
    await p.context().close();
  });

  await test("phone layout: nothing wider than the screen, the ride view does not scroll", async () => {
    for(const viewport of [{ width: 360, height: 640 }, { width: 384, height: 832 }, { width: 832, height: 384 }]){
      const p = await open({ viewport, mobile: true });
      await p.evaluate(() => setVideo("dQw4w9WgXcQ")); await p.click("#chip-trainer"); await p.click("#c-sim"); await p.click("#btn-start"); await p.waitForTimeout(800);
      const m = await p.evaluate(() => ({ wide: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        scroll: document.querySelector("#view-ride").scrollHeight > document.querySelector("#view-ride").clientHeight + 1,
        over: document.querySelector(".hud").scrollHeight - document.querySelector(".hud").clientHeight }));
      assert.deepEqual(m, { wide: false, scroll: false, over: 0 }, `${viewport.width}x${viewport.height}`);
      await p.context().close();
    }
  });

  await browser.close(); await srv.close();
  if(pageErrors.length) results.push(["FAIL", "no JavaScript errors in the page", new Error(pageErrors.join("; ")), 0]);
  for(const [s, n, e, ms] of results) console.log(`${s === "ok" ? "✓" : "✗"} ${n} (${(ms / 1000).toFixed(1)} s)${e ? "\n    " + e.message : ""}`);
  const failed = results.filter(r => r[0] !== "ok").length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
