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
  async function open({ viewport = { width: 1280, height: 860 }, speed = 100, voices = [], settings, mobile = false, locale = "en-US", cookies = [], keys = false } = {}){
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
    await p.goto(`${B}/?simspeed=${speed}${keys ? "&i18n=keys" : ""}`);
    await p.waitForFunction(() => window.__pedala && document.documentElement.dataset.i18n === "ready", null, { timeout: 5000 });
    return p;
  }
  const ride = async (p, secs) => { await p.click('[data-view="ride"]'); await p.click("#btn-start"); await p.waitForTimeout(secs); await p.click("#btn-end"); await p.waitForTimeout(500); };

  await test("i18n: a dropped-in language file registers itself and translates the static shell", async () => {
    const p = await open({ settings: { lang: "zz" } });
    assert.match(await p.textContent('[data-view="ride"]'), /^zz:Ride$/);
    assert.match(await p.textContent("h1"), /^zz:/);
    assert.equal(await p.evaluate(() => document.documentElement.lang), "zz");
    assert.equal(await p.evaluate(() => PedalaI18n.languages.has("zz")), true);
    await p.click('[data-view="settings"]');
    assert.match(await p.textContent("#view-settings h2"), /zz:/);
    assert.match(await p.textContent("#btn-start"), /zz:Start/);
    await p.context().close();
  });

  await test("i18n: an unknown language falls back to English with no page error", async () => {
    const errorsBefore = pageErrors.length;
    const p = await open({ settings: { lang: "xx" } });
    assert.equal(await p.textContent('[data-view="ride"]'), "Ride");
    assert.equal(await p.evaluate(() => document.documentElement.lang), "en");
    assert.equal(pageErrors.length, errorsBefore);
    await p.context().close();
  });

  await test("i18n: the ?i18n=keys recorder collects static and dynamic keys", async () => {
    const p = await open({ keys: true });
    assert.equal(await p.evaluate(() => PedalaI18n.record), true, "the recorder is on");
    const seen = await p.evaluate(() => [...PedalaI18n.seen]);
    assert.ok(seen.includes("Settings"), "a key from the static shell is recorded");
    assert.ok(seen.includes("Free ride"), "a key from the first render is recorded");
    await p.evaluate(() => setWorkout(allWorkouts().find(w => w.id === "b-ss")));
    const more = await p.evaluate(() => [...PedalaI18n.seen]);
    assert.ok(more.includes("Target"), "a key rendered later is recorded");
    assert.ok(more.includes("Interval {i} of {n}"), "a key with placeholders is recorded");
    await p.context().close();

    const q = await open();
    assert.equal(await q.evaluate(() => PedalaI18n.record), false, "the recorder is off without the switch");
    assert.equal(await q.evaluate(() => PedalaI18n.seen.size), 0);
    await q.context().close();
  });

  await test("i18n: Settings lists the dropped-in language and switching reloads", async () => {
    const p = await open({ settings: { lang: "zz" } });
    await p.click('[data-view="settings"]');
    assert.equal(await p.locator('[name="lang"] option[value="zz"]').textContent(), "Testish");
    await Promise.all([p.waitForNavigation(), p.selectOption('[name="lang"]', "en")]);
    await p.waitForFunction(() => document.documentElement.dataset.i18n === "ready" && document.documentElement.lang === "en");
    assert.equal(await p.textContent('[data-view="ride"]'), "Ride");
    await p.context().close();
  });

  await test("i18n: a running ride blocks the language change", async () => {
    const p = await open({ settings: { lang: "zz" } });
    await p.click("#chip-trainer"); await p.click("#c-sim"); await p.click("#btn-start"); await p.waitForTimeout(300);
    await p.click('[data-view="settings"]');
    await p.evaluate(() => { window.__stillHere = true; });
    await p.selectOption('[name="lang"]', "en");
    await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => window.__stillHere), true, "the page did not reload");
    assert.equal(await p.evaluate(() => store.get("settings", {}).lang), "zz", "the language is not saved");
    assert.match(await p.textContent("#toast"), /Finish the ride before changing the language/);
    assert.equal(await p.evaluate(() => document.querySelector('[name="lang"]').value), "zz", "the select is restored");
    await p.context().close();
  });

  await test("i18n: built-in labels translate, generated labels compose, imported names stay", async () => {
    const p = await open();
    await p.click('[data-view="workouts"]');
    assert.ok((await p.textContent("#wo-list")).includes("Endurance 60"));
    assert.equal(await p.evaluate(() => workoutLabel(extraWorkout("run", 4))), "Run · 2.5 km easy");
    assert.equal(await p.evaluate(() => workoutLabel(PLAN_WO["p-z50"])), "Zone 2 · 50 min");
    assert.equal(await p.evaluate(() => sessionDesc(PLAN_WO["p-z50"])), "Steady Zone 2 ride (65% of FTP). Conversational pace, cadence 85–95.");
    assert.equal(await p.evaluate(() => sessionLabel(strengthWorkout("A", 0))), "Strength A · legs and glutes");
    assert.match(await p.evaluate(() => sessionDesc(strengthWorkout("A", 0))), /^3 rounds: squat,/);
    assert.equal(await p.evaluate(() => workoutLabel(BUILTIN_ROUTES[0])), "Sljeme (Cener, Sljemenska cesta)");
    assert.equal(await p.evaluate(() => BUILTIN_ROUTES.find(r => r.id === "c-alpe").name), "Alpe d'Huez (Bourg d'Oisans)");
    await p.context().close();

    const z = await open({ settings: { lang: "zz" } });
    await z.evaluate(() => { store.set("workouts", [{ id: "z-endurance", name: "Endurance 60", desc: "Imported ride.", segs: [{ d: 60, lo: .5, hi: .5 }], imported: true }]); renderWorkouts(); });
    const names = await z.$$eval("#wo-list .item h3", els => els.map(e => e.textContent));
    assert.ok(names.includes("zz:Endurance 60"), "a built-in workout label is translated");
    assert.ok(names.includes("Endurance 60"), "the imported name is unchanged");
    assert.equal(await z.evaluate(() => workoutLabel(extraWorkout("brick", 0))), "zz:Brick · 5 min run");
    assert.equal(await z.evaluate(() => workoutLabel(PLAN_WO["p-z125"])), "zz:Zone 2 · 2.1 zz:h");
    assert.match(await z.evaluate(() => sessionDesc(PLAN_WO["p-z50"])), /^zz:Steady Zone 2 ride/);
    assert.match(await z.evaluate(() => workoutLabel(BUILTIN_ROUTES[0])), /^zz:Sljeme/);
    await z.click('[data-view="plan"]');
    assert.match(await z.textContent("#plan-body"), /zz:Sustainable 14 weeks/);
    await z.context().close();
  });

  await test("i18n: Ride view labels are dynamic, video titles stay as they are", async () => {
    const p = await open({ settings: { lang: "zz" } });
    assert.equal(await p.textContent("#tgt-lbl"), "zz:Free ride");
    assert.equal(await p.textContent("#bias-lbl"), "zz:Intensity");
    assert.equal(await p.textContent("#cad-lbl"), "zz:Cadence");
    await p.evaluate(() => { store.set("recentVideos", [{ id: "dQw4w9WgXcQ", title: "Imported video title", channel: "Some channel" }]); renderRecent(); });
    assert.equal(await p.locator("#vid-recent .vcard b").first().textContent(), "Imported video title");
    await p.evaluate(() => setWorkout(allWorkouts().find(w => w.id === "b-ss")));
    assert.equal(await p.textContent("#tgt-lbl"), "zz:Target");
    assert.match(await p.textContent("#iv-lbl"), /^zz:Interval 1 of \d+$/);
    await p.context().close();
  });

  await test("i18n: workout lists, history, progress and reports translate, imported names stay", async () => {
    const z = await open({ settings: { lang: "zz" } });
    await z.click('[data-view="workouts"]');
    await z.waitForFunction(() => document.querySelectorAll("#wo-list .vsect").length > 0);
    const sections = await z.$$eval("#wo-list .vsect", els => els.map(e => e.textContent));
    assert.ok(sections.includes("zz:Base workouts"), "a workout category is translated");
    assert.ok(sections.includes("zz:Strength at home"), "the strength category is translated");
    const picks = await z.$$eval("#wo-list [data-pick]", els => els.map(e => e.textContent));
    assert.ok(picks.includes("zz:Select"), "the workout action is translated");
    assert.ok((await z.textContent("#wo-list")).includes("zz:To exhaustion, usually 20–30 min"), "the test workout description is translated");
    const routes = await z.$$eval("#route-list [data-pick]", els => els.map(e => e.textContent));
    assert.ok(routes.length && routes.every(x => x === "zz:Ride"), "the route action is translated");
    await z.evaluate(() => { store.set("workouts", [{ id: "z-end", name: "Endurance 60", desc: "My import.", segs: [{ d: 60, lo: .5, hi: .5 }], imported: true }]); renderWorkouts(); });
    assert.ok((await z.$$eval("#wo-list .item h3", els => els.map(e => e.textContent))).includes("Endurance 60"), "an imported workout name stays");

    await z.evaluate(async () => {
      await dbPut({ id: "r-zz", start: Date.now() - 3600e3, workoutId: null, name: "Imported ride", route: false, ftp: 230, maxHr: 190,
        samples: Array.from({ length: 120 }, (_, i) => [i, 180 + (i % 40), 90, 150, 0, 60 * (i + 1), 0]),
        m: { duration: 120, avgP: 200, maxP: 260, np: 210, tss: 20, IF: .87, kj: 24, distance: 2000, avgHr: 150, maxHr: 175, avgCad: 90, best: { s5: 600, m1: 450, m5: 330, m20: 260 } }, laps: [] });
    });
    await z.click('[data-view="history"]');
    await z.waitForFunction(() => document.querySelectorAll("#ride-list [data-rep]").length === 1);
    assert.match(await z.textContent("#weekbar"), /zz:Last 7 days/);
    assert.match(await z.textContent("#weekbar"), /zz:ride/);
    assert.ok((await z.$$eval("#ride-list .item h3", els => els.map(e => e.textContent)))[0].startsWith("Imported ride "), "the ride name stays");
    assert.match(await z.textContent("#ride-list"), /zz:Report/);
    assert.match(await z.textContent("#ride-list"), /zz:W avg/);
    assert.match(await z.textContent("#ride-list"), /zz:Best: 5 s 600 W/);
    await z.click("#ride-list [data-rep]");
    await z.waitForFunction(() => /zz:Ride timeline/.test(document.querySelector("#rep-body").textContent));
    const report = await z.textContent("#rep-body");
    assert.match(report, /zz:Power distribution/);
    assert.match(report, /zz:Power curve/);
    assert.match(report, /zz:Best of the last 90 days/);
    assert.match(await z.textContent("#rep-grid"), /zz:Time/);
    assert.match(await z.textContent("#rep-grid"), /zz:Cadence/);
    await z.evaluate(() => document.querySelector("#dlg-report").close());

    await z.evaluate(() => {
      window.__fills = []; const proto = CanvasRenderingContext2D.prototype;
      if(!proto.__origFillText) proto.__origFillText = proto.fillText;
      proto.fillText = function(s, ...a){ window.__fills.push(String(s)); return proto.__origFillText.call(this, s, ...a); };
    });
    await z.click('[data-view="progress"]');
    await z.waitForFunction(() => window.__fills.some(x => x.startsWith("zz:Today: fitness")));
    assert.match(await z.textContent("#pg-totals"), /zz:Last 30 days/);
    assert.match(await z.textContent("#pg-totals"), /zz:Distance/);
    assert.equal(await z.textContent("#pg-best small"), "zz:5 s");

    await z.evaluate(() => {
      S.workout = null; S.route = null; S.startMs = Date.now() - 120e3; S.laps = []; S.lap = null;
      S.samples = Array.from({ length: 120 }, (_, i) => [i, 180 + (i % 40), 90, 150, 0, 60 * (i + 1), 0]);
      openSummary();
    });
    await z.waitForFunction(() => document.querySelector("#dlg-summary").open);
    assert.equal(await z.textContent("#sum-title"), "zz:Free ride", "the summary title is translated");
    assert.match(await z.textContent("#sum-grid"), /zz:Average/, "the summary grid is translated");
    assert.match(await z.textContent("#sum-grid"), /zz:Best minute/);
    await z.evaluate(() => document.querySelector("#dlg-summary").close());
    await z.context().close();
  });

  await test("i18n: dates, numbers and plurals follow the active locale", async () => {
    const p = await open();
    assert.deepEqual(await p.evaluate(() => ({
      short: shortDate(new Date(2026, 10, 27).getTime()),
      day: shortDay(new Date(2026, 10, 27)),
      coach: coachDate(new Date(2026, 10, 27, 14, 30).getTime()),
      full: PedalaI18n.td(new Date(2026, 10, 27, 14, 30, 5).getTime(), { dateStyle: "short", timeStyle: "medium" }),
      dur: fmtDur(300), hour: fmtDur(3600), zone: zoneTime(125),
      num: numFixed(1234.5, 1),
      one: PedalaI18n.tn(1, "{n} ride", "{n} rides", { n: 1 }),
      many: PedalaI18n.tn(2, "{n} ride", "{n} rides", { n: 2 })
    })), { short: "27/11", day: "Fri 27/11", coach: "Fri 27/11, 14:30", full: "27/11/2026, 14:30:05", dur: "5 min", hour: "1 h", zone: "2.1 h", num: "1234.5", one: "1 ride", many: "2 rides" });
    await p.context().close();

    const z = await open({ settings: { lang: "zz" } });
    assert.deepEqual(await z.evaluate(() => ({
      short: shortDate(new Date(2026, 10, 27).getTime()),
      dur: fmtDur(300), hour: fmtDur(3600), zone: zoneTime(125),
      many: PedalaI18n.tn(2, "{n} ride", "{n} rides", { n: 2 })
    })), { short: "27/11", dur: "5 zz:min", hour: "1 zz:h", zone: "2.1 zz:h", many: "zz:2 rides" });
    await z.context().close();
  });

  await test("i18n: Hungarian translates the UI, dates, numbers and ride plurals", async () => {
    const errorsBefore = pageErrors.length;
    const p = await open({ settings: { lang: "hu" } });
    assert.equal(await p.textContent('[data-view="ride"]'), "Tekerés");
    assert.equal(await p.textContent('[data-view="settings"] .tl'), "Beállítások");
    assert.equal(await p.evaluate(() => document.documentElement.lang), "hu");
    assert.equal(await p.evaluate(() => document.documentElement.dir), "ltr");
    assert.equal(await p.textContent("#tgt-lbl"), "Szabad tekerés");
    assert.deepEqual(await p.evaluate(() => ({
      short: shortDate(new Date(2026, 10, 27).getTime()),
      day: shortDay(new Date(2026, 10, 27)),
      full: PedalaI18n.td(new Date(2026, 10, 27, 14, 30, 5).getTime(), { dateStyle: "short", timeStyle: "medium" }),
      num: numFixed(1234.5, 1),
      one: PedalaI18n.tn(1, "{n} ride", "{n} rides", { n: 1 }),
      many: PedalaI18n.tn(2, "{n} ride", "{n} rides", { n: 2 })
    })), { short: "11. 27.", day: "11. 27., P", full: "2026. 11. 27. 14:30:05", num: "1234,5", one: "1 tekerés", many: "2 tekerés" });
    await p.evaluate(() => setWorkout(allWorkouts().find(w => w.id === "b-ss")));
    assert.equal(await p.textContent("#tgt-lbl"), "Cél");
    assert.match(await p.textContent("#iv-lbl"), /^Intervallum 1 \/ \d+$/);
    await p.click('[data-view="settings"]');
    assert.equal(await p.locator('[name="lang"] option[value="hu"]').textContent(), "Magyar");
    const note = p.locator('p[data-i18n^="A free training analysis service"]');
    assert.match(await note.textContent(), /^Ingyenes edzésanalízis-szolgáltatás/);
    assert.match(await note.evaluate(el => el.innerHTML), /<b>API-kulcsot<\/b>/);

    // a real ride with a workout: the HUD, start/pause and interval labels stay Hungarian
    await p.click('[data-view="ride"]');
    await p.click("#chip-trainer"); await p.click("#c-sim");
    await p.click("#btn-start"); await p.waitForTimeout(400);
    assert.equal(await p.textContent("#tgt-lbl"), "Cél");
    assert.equal(await p.textContent("#btn-start"), "Szünet");
    assert.match(await p.textContent("#iv-lbl"), /^Intervallum 1 \/ \d+$/);
    assert.equal(pageErrors.length, errorsBefore);
    await p.click("#btn-end");
    await p.waitForSelector("#dlg-summary[open]", { timeout: 5000 });
    await p.evaluate(() => document.querySelector("#dlg-summary").close());
    await p.context().close();
  });

  await test("i18n: plan, strength player, settings status and confirms translate; coach text stays raw", async () => {
    const z = await open({ settings: { lang: "zz" } });
    await z.click('[data-view="plan"]');
    await z.waitForFunction(() => /zz:Start plan/.test(document.querySelector("#plan-body").textContent));
    const start = await z.textContent("#plan-body");
    assert.match(start, /zz:Start plan/, "the plan start button is translated");
    assert.match(start, /zz:Length:/, "the generated plan length line is translated");

    await z.evaluate(() => {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      store.set("plan", { id: PLAN.id, start: ymd(d), done: {}, skipped: {}, times: { wk: "18:00", sun: "09:00" }, remind: 120 });
      renderPlan();
    });
    await z.waitForFunction(() => /zz:Calendar and reminder/.test(document.querySelector("#plan-body").textContent));
    const plan = await z.textContent("#plan-body");
    assert.match(plan, /zz:Calendar and reminder/, "the calendar heading is translated");
    assert.match(plan, /zz:Download calendar \(\.ics\)/, "the calendar button is translated");
    assert.match(plan, /zz:Reminder/, "the reminder label is translated");

    const wk = await z.evaluate(() => {
      startStrength(strengthWorkout("A", 0));
      const warm = { phase: document.querySelector("#wk-phase").textContent, next: document.querySelector("#wk-next").textContent,
        pause: document.querySelector("#wk-pause").textContent };
      while(WK.steps[WK.i]?.kind !== "work") wkNext();
      const work = { phase: document.querySelector("#wk-phase").textContent, cue: document.querySelector("#wk-cue").textContent };
      clearInterval(WK.timer);
      return { warm, work };
    });
    assert.equal(wk.warm.phase, "zz:Warm-up", "the strength phase is translated");
    assert.match(wk.warm.next, /^zz:Next: zz:/, "the next exercise label is translated");
    assert.equal(wk.warm.pause, "zz:Pause", "the pause button is translated");
    assert.equal(wk.work.phase, "zz:Round 1/3 · exercise 1/6", "the strength round line is translated");
    assert.match(wk.work.cue, /^zz:/, "the exercise cue is translated");
    await z.evaluate(() => document.querySelector("#dlg-strength").close());

    await z.click('[data-view="settings"]');
    assert.equal(await z.textContent("#icu-status"), "zz:Not connected.", "the intervals.icu status is translated");

    await z.click('[data-view="plan"]');
    let confirmMsg = "";
    z.removeAllListeners("dialog");
    z.once("dialog", d => { confirmMsg = d.message(); d.accept(); });
    await z.click("#plan-stop");
    await z.waitForTimeout(100);
    assert.equal(confirmMsg, "zz:End the plan? Your rides stay in History.", "the confirm text is translated");
    await z.context().close();
  });

  await test("i18n: coach comments and titles stay raw in a translated UI", async () => {
    const z = await open({ settings: { lang: "zz" } });
    await z.evaluate(() => {
      store.set("coach", { "ride:raw": { text: "Coach text stays raw.", at: Date.now(), title: "Imported ride" } });
      showView("progress");
    });
    await z.waitForFunction(() => /Coach text stays raw\./.test(document.querySelector("#coach-list").textContent));
    const list = await z.textContent("#coach-list");
    assert.match(list, /Coach text stays raw\./);
    assert.doesNotMatch(list, /zz:Coach text/);
    assert.match(list, /Imported ride/, "a coaching note title is left as it was saved");
    await z.context().close();
  });

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

  await test("voice: English-only speech; YouTube is turned down while speaking", async () => {
    const en = await open({ voices: [["Samsung English", "en-US"]] });
    await en.click('[data-view="settings"]'); await en.click("#btn-voice-test"); await en.waitForTimeout(300);
    assert.equal((await en.evaluate(() => __spoken))[0], "In 10 seconds: 3 minutes at 265 watts, cadence 90 to 100.");
    await en.evaluate(() => setVideo("dQw4w9WgXcQ")); await en.waitForTimeout(800);
    await en.evaluate(() => say("Test.", true)); await en.waitForTimeout(1200);
    assert.deepEqual(await en.evaluate(() => __rec), ["setVolume(18)", "setVolume(70)"]);
    await en.context().close();
  });

  await test("voice: a dropped-in language speaks with its own voice", async () => {
    // the saved English voice does not match Testish, so it is ignored in favour of the Testish voice
    const z = await open({ settings: { lang: "zz", voiceName: "Samsung English" }, voices: [["Samsung English", "en-US"], ["Testish Voice", "zz-ZZ"]] });
    await z.click('[data-view="settings"]');
    assert.equal(await z.evaluate(() => pickVoice().voiceURI), "Testish Voice");
    assert.deepEqual(await z.evaluate(() => [...document.querySelectorAll('[name="voiceName"] option')].map(o => o.textContent)),
      ["zz:Automatic", "Testish Voice · zz-ZZ"], "only voices for the active language are listed");
    await z.click("#btn-voice-test"); await z.waitForTimeout(300);
    assert.match((await z.evaluate(() => __spoken))[0], /^zz:soon /, "the voice test speaks Testish");
    await z.context().close();
  });

  await test("voice: a language without a voice falls back to English announcements and says so", async () => {
    const z = await open({ settings: { lang: "zz" }, voices: [["Samsung English", "en-US"]] });
    await z.click('[data-view="settings"]');
    assert.equal(await z.textContent("#voice-note"),
      "zz:There is no Testish voice on this device; announcements are in English (Samsung English).");
    assert.deepEqual(await z.evaluate(() => [...document.querySelectorAll('[name="voiceName"] option')].map(o => o.textContent)),
      ["zz:Automatic", "Samsung English · en-US"], "English voices are listed when the language has none");
    await z.click("#btn-voice-test"); await z.waitForTimeout(300);
    assert.equal((await z.evaluate(() => __spoken))[0], "In 10 seconds: 3 minutes at 265 watts, cadence 90 to 100.");
    await z.context().close();
  });

  await test("voice: Hungarian is spoken with a hu-HU voice, and a missing one falls back with a Hungarian notice", async () => {
    const hu = await open({ settings: { lang: "hu" }, voices: [["Google magyar", "hu-HU"], ["Samsung English", "en-US"]] });
    await hu.click('[data-view="settings"]'); await hu.click("#btn-voice-test"); await hu.waitForTimeout(300);
    assert.equal((await hu.evaluate(() => __spoken))[0], "10 másodperc múlva: 3 perc 265 watton, kadencia 90 és 100 között.");
    assert.match(await hu.textContent("#voice-note"), /^A bemondások Magyar nyelven szólnak/);

    await hu.click('[data-view="ride"]');
    await hu.evaluate(() => { S.workout = { ftp: 230, builtin: true }; say(() => segmentSpeech({ d: 200, free: true, note: "High cadence, stay seated", cad: [90, CAD_ANY] }), true); S.workout = null; });
    await hu.waitForTimeout(100);
    assert.equal((await hu.evaluate(() => __spoken)).at(-1), "Magas kadencia, maradj ülve. 3 perc 20 másodperc szabadon, kadencia 90 vagy több");

    await hu.evaluate(() => { S.workout = { ftp: 230 }; S.bias = 1; say(() => segmentSpeech({ d: 200, lo: 200 / settings.ftp, hi: 265 / settings.ftp }), true); S.workout = null; });
    await hu.waitForTimeout(100);
    assert.equal((await hu.evaluate(() => __spoken)).at(-1), "3 perc 20 másodperc, 200-tól 265 watton");

    await hu.evaluate(() => { S.workout = { ftp: 230 }; S.hrOff = 0; say(() => segmentSpeech({ d: 180, hr: 145 / settings.maxHr }), true); S.workout = null; });
    await hu.waitForTimeout(100);
    assert.equal((await hu.evaluate(() => __spoken)).at(-1), "3 perc 145-ös pulzuson");
    await hu.evaluate(() => { S.workout = { ftp: 230 }; S.hrOff = 0; say(() => segmentSpeech({ d: 180, hr: 150 / settings.maxHr }), true); S.workout = null; }); await hu.waitForTimeout(100);
    assert.equal((await hu.evaluate(() => __spoken)).at(-1), "3 perc 150-es pulzuson");

    await hu.evaluate(() => { S.workout = null; S.dist = 12000; lapResult({ kind: "dist", name: "Lap 1", dur: 200, avgP: 250, kmLimit: 5 }); });
    await hu.waitForTimeout(100);
    assert.equal((await hu.evaluate(() => __spoken)).at(-1), "12 kilométer. Az utolsó 5 kilométer 3 perc 20 másodperc alatt, átlag 250 watt.");

    const wk = await hu.evaluate(() => {
      startStrength({ name: "Test", min: 1, steps: [{ kind: "work", n: "Squat", s: 1 }, { kind: "rest", s: 30 }, { kind: "work", n: "Glute bridge", s: 1 }] });
      clearInterval(WK.timer);
      const first = __spoken.at(-1);
      wkNext(); const rest = __spoken.at(-1);
      wkNext(); const second = __spoken.at(-1);
      document.querySelector("#dlg-strength").close();
      return { first, rest, second };
    });
    assert.deepEqual(wk, { first: "Guggolás, 1 másodperc.", rest: "Pihenő. Következik: Csípőhíd.", second: "Csípőhíd, 1 másodperc." });
    await hu.context().close();

    const none = await open({ settings: { lang: "hu" }, voices: [["Samsung English", "en-US"]] });
    await none.click('[data-view="settings"]'); await none.waitForTimeout(200);
    assert.equal(await none.textContent("#voice-note"), "Ezen az eszközön nincs Magyar hang; a bemondások angolul szólnak (Samsung English).");
    await none.click("#btn-voice-test"); await none.waitForTimeout(300);
    assert.equal((await none.evaluate(() => __spoken))[0], "In 10 seconds: 3 minutes at 265 watts, cadence 90 to 100.");
    await none.context().close();
  });

  await test("laps: the free-ride lap length comes from Settings, and the average is announced at that length", async () => {
    const p = await open({ voices: [["Samsung English", "en-US"]] });
    await p.click('[data-view="settings"]'); await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => document.querySelector('[name="lapKm"]').value), "5", "the lap length starts at 5 km");
    await p.fill('[name="lapKm"]', "1"); await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => settings.lapKm), 1, "the lap length is saved");
    const r = await p.evaluate(() => {
      S.workout = null; S.lap = null; S.dist = 0; S.laps = []; S.live = { power: 200, cadence: 90, hr: 0 };
      lapTick(null, 0);                     // opens lap 1
      S.dist = 900; lapTick(null, 0);       // 0.9 km: still lap 1
      const one = S.laps.length;
      S.dist = 1200; lapTick(null, 0);      // 1.2 km: lap 1 closes, lap 2 opens
      return { one, two: S.laps.length, kmLimit: S.laps[0]?.kmLimit };
    });
    assert.equal(r.one, 0, "no lap before the lap length is reached");
    assert.equal(r.two, 1, "a lap closes at the configured length");
    assert.equal(r.kmLimit, 1, "the lap carries the length it was ridden at");
    await p.waitForTimeout(300);
    assert.match((await p.evaluate(() => __spoken)).at(-1), /^1 kilometer\. Last 1 in 2 seconds, average 200 watts\.$/);
    await p.context().close();
  });

  await test("video control: three auto-pause modes, the speed one waits for the coast-down", async () => {
    const p = await open({ settings: { pauseOn: "speed" } });   // no trainer: S.live stays exactly as the test sets it
    await p.click('[data-view="settings"]'); await p.waitForTimeout(200);
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('[name="pauseOn"] option')].map(o => o.textContent)),
      ["Do not stop", "When I stop pedalling", "When speed below 3 km/h"]);
    assert.equal(await p.evaluate(() => document.querySelector('[name="pauseOn"]').value), "speed", "speed is the default");
    await p.click('[data-view="ride"]');
    const still = await p.evaluate(() => {
      S.started = true; S.running = true; S.autoPaused = false; S.idle = 0; S.grace = 0; S.workout = null; S.route = null; S.v = 20 / 3.6;
      S.live = { power: 0, cadence: 0, hr: 0, speed: 20 };
      for(let i = 0; i < 10; i++) tick();
      return { running: S.running, speed: Math.round(S.v * 3.6) };
    });
    assert.equal(still.running, true, "coasting above 3 km/h keeps the ride running");
    assert.ok(still.speed > 3, "the speed fell but stayed above 3 km/h: " + still.speed);
    const between = await p.evaluate(() => {
      S.v = 2 / 3.6; S.idle = 0; S.grace = 0; S.running = true; S.autoPaused = false;
      for(let i = 0; i < 5; i++) tick();
      return { running: S.running, autoPaused: S.autoPaused };
    });
    assert.equal(between.running, false, "2 km/h is below the 3 km/h threshold and stops the ride");
    const stopped = await p.evaluate(() => {
      S.v = 0.2 / 3.6; S.idle = 0; S.grace = 0; S.running = true; S.autoPaused = false;
      for(let i = 0; i < 5; i++) tick();
      return { running: S.running, autoPaused: S.autoPaused };
    });
    assert.equal(stopped.running, false, "a near standstill stops the ride");
    assert.equal(stopped.autoPaused, true, "and it is flagged as an automatic pause");
    await p.context().close();
  });

  await test("video control: a start and a resume give the rider time to spin up before auto-pause", async () => {
    const p = await open({ settings: { pauseOn: "speed" } });   // no trainer: S.live stays exactly as the test sets it
    const g = await p.evaluate(() => {
      S.started = true; S.running = true; S.autoPaused = true; S.workout = null; S.route = null; S.live = { power: 0, cadence: 0, hr: 0, speed: 0 };
      S.v = 0; resume();
      const grace = S.grace;
      for(let i = 0; i < 10; i++) tick();      // 10 s standing still inside the grace
      return { grace, running: S.running, left: S.grace };
    });
    assert.ok(g.grace >= 10, "a resume grants a grace window: " + g.grace);
    assert.equal(g.running, true, "the grace keeps the ride running while the rider spins up");
    assert.ok(g.left > 0, "10 s of standing still is still inside the grace: " + g.left);
    const gone = await p.evaluate(() => {
      S.idle = 0;                             // the grace runs out
      for(let i = 0; i < 20; i++) tick();
      return { running: S.running, autoPaused: S.autoPaused };
    });
    assert.equal(gone.running, false, "once the grace is over a standstill pauses again");
    assert.equal(gone.autoPaused, true);
    const up = await p.evaluate(() => {       // spinning up drops the grace at once
      S.running = true; S.autoPaused = false; S.v = 0; S.live = { power: 150, cadence: 80, hr: 0, speed: 0 };
      S.grace = 15; S.v = 15 / 3.6;
      tick();
      return S.grace;
    });
    assert.equal(up, 0, "being above 3 km/h ends the grace immediately");
    await p.context().close();
  });

  await test("video control: an old on/off auto-pause setting becomes cadence or off", async () => {
    const p = await open();
    const got = await p.evaluate(() => {
      const out = {};
      for(const [old, key] of [[false, "off"], [true, "on"]]){ settings.pauseOn = null; settings.autoPause = old; migratePauseOn(); out[key] = settings.pauseOn; }
      settings.pauseOn = null; delete settings.autoPause; migratePauseOn(); out.fresh = settings.pauseOn;
      settings.pauseOn = "cadence"; settings.autoPause = true; migratePauseOn(); out.chosen = settings.pauseOn;
      return out;
    });
    assert.equal(got.off, "off", "an old 'off' becomes Do not stop");
    assert.equal(got.on, "cadence", "an old 'on' becomes When I stop pedalling");
    assert.equal(got.fresh, "speed", "a device without the old setting takes the new default");
    assert.equal(got.chosen, "cadence", "a real menu choice is never overwritten by the old key");
    await p.context().close();
  });

  await test("English everywhere, in every browser", async () => {
    const p = await open({ speed: 200 });
    const croatian = /[čćžšđ]|\b(je|na|ili|se|za|od|nije|treba|nema|vožnj\w*|trening\w*|Postavke|Spoji|Kreni|Tjedan|Zona|Puls|Kadenca|Brzina|Glazba|Snaga|Vrijeme|Još|Sljedeće)\b/i;
    const visible = () => p.evaluate(() => { const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for(let n; (n = w.nextNode());){ const e = n.parentElement; if(e.closest("script,style") || !e.getClientRects().length) continue; const t = n.nodeValue.trim(); if(t) out.push(t); }
      document.querySelectorAll("[placeholder],[aria-label]").forEach(e => out.push(e.getAttribute("placeholder") || e.getAttribute("aria-label")));
      return out; });
    const left = [];
    const check = async where => { for(const t of await visible()) if(croatian.test(t) && !/^(Učka|Sljeme|Biokovo)/.test(t)) left.push(where + ": " + t); };
    await check("ride");
    for(const v of ["plan", "workouts", "history", "progress", "settings"]){ await p.click(`[data-view="${v}"]`); await p.waitForTimeout(300); await check(v); }
    await p.click('[data-view="plan"]'); if(await p.$("#plan-go")) await p.click("#plan-go"); await p.waitForTimeout(300); await check("plan started");
    await p.click("#chip-trainer"); await check("connect"); await p.click("#c-sim");
    await p.evaluate(() => setWorkout(allWorkouts().find(w => w.id === "d-hilo"))); await p.click("#btn-start"); await p.waitForTimeout(2500); await check("riding");
    await p.click("#btn-end"); await p.waitForTimeout(1200); await check("summary"); await p.click("#sum-save"); await p.waitForTimeout(600);
    await p.click('[data-view="history"]'); await p.waitForTimeout(300); await p.locator("[data-rep]").first().click(); await p.waitForTimeout(1000); await check("report");
    assert.deepEqual(left, []);
    assert.equal(await p.textContent('[data-view="workouts"]'), "Workouts");
    assert.equal(await p.evaluate(async () => (await dbAll()).sort((a, b) => b.start - a.start)[0].name), "High and low cadence", "ride saved under its English name");
    await p.context().close();
  });

  await test("stale language settings are ignored", async () => {
    const errorsBefore = pageErrors.length;
    const p = await open({ settings: { uiLang: "hr", voiceLang: "hu" }, voices: [["Samsung English", "en-US"]] });
    assert.equal(await p.textContent('[data-view="workouts"]'), "Workouts");
    await p.click('[data-view="settings"]'); await p.click("#btn-voice-test"); await p.waitForTimeout(300);
    assert.equal((await p.evaluate(() => __spoken))[0], "In 10 seconds: 3 minutes at 265 watts, cadence 90 to 100.");
    assert.equal(pageErrors.length, errorsBefore);
    await p.context().close();
  });

  await test("Zwift Click v2: each pod is its own + or − device, or both directions on one pod", async () => {
    const p = await open({ settings: { clickOn: true } });
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
    assert.match(await p.textContent("#coach-status"), /coach is on.*ANTHROPIC_API_KEY/);
    await p.click("#chip-trainer"); await p.click("#c-sim"); await p.evaluate(() => setWorkout(allWorkouts().find(w => w.id === "b-ss")));
    await p.click("#btn-start"); await p.waitForTimeout(4000); await p.click("#btn-end"); await p.waitForTimeout(500); await p.click("#sum-save");
    await p.waitForFunction(() => Object.entries(store.get("coach", {})).some(([k, n]) => k.startsWith("ride:") && n.text), null, { timeout: 15000 });
    const ride = srv.claude.find(b => b.messages[0].content.includes("Pedala, indoor trainer"));
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
    assert.match(await p.textContent("#coach-box"), /Good workout/);
    await p.click('[data-view="history"]'); await p.waitForTimeout(400); await p.locator("[data-rep]").first().click(); await p.waitForTimeout(600);
    assert.match(await p.textContent("#rep-coach"), /Good workout/);
    srv.setEnv({ ANTHROPIC_API_KEY: null }); await p.context().close();
  });

  await test("coach: a question gets an answer, a proposed plan change is applied only after confirming", async () => {
    srv.setEnv({ ANTHROPIC_API_KEY: "sk-test" }); srv.claude.length = 0;
    const p = await open();
    await p.evaluate(() => { settings.coachMode = "off"; });   // no weekly review in the middle of this test
    const first = await p.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      store.set("plan", { id: PLAN.id, start: ymd(d), done: {}, skipped: {}, times: { wk: "18:00", sun: "09:00" }, remind: 120 }); return planSessions()[0].id; });
    await p.click('[data-view="progress"]'); await p.waitForTimeout(800);
    await p.fill("#coach-q", "I have a cold, what about this week?"); await p.click("#coach-form button");
    await p.waitForFunction(() => coachChat().at(-1)?.a, null, { timeout: 15000 });
    const sent = srv.claude.at(-1);
    assert.equal(sent.output_config.format.type, "json_schema");
    assert.match(sent.messages[0].content, /I have a cold/); assert.match(sent.messages[0].content, /"workout_id":"p-rec"|"id":"p-rec"/);
    assert.match(await p.textContent("#coach-thread"), /Rest and do an easy recovery session/);
    assert.match(await p.textContent("#coach-thread"), /≈ \$0\.0[0-9]{2}/, "what the answer cost"); assert.match(await p.textContent("#coach-month"), /≈ \$0\.0/);
    assert.equal(await p.locator("#coach-thread li").count(), 1, "a change for a session that does not exist is dropped");
    assert.ok(!(await p.evaluate(() => plan().swap)), "nothing changes before confirming");
    await p.click("#coach-thread [data-apply]");
    assert.deepEqual(await p.evaluate(() => plan().swap), { [first]: "p-rec" });
    assert.equal(await p.evaluate(id => planSessions().find(x => x.id === id).w.name, first), "Active recovery");
    assert.match(await p.textContent("#coach-thread"), /Applied/);
    // a plain question: this week of the plan, no list of swaps, less effort
    await p.evaluate(() => coachQuestion("Kako napredujem?")); const plain = srv.claude.at(-1);
    assert.doesNotMatch(plain.messages[0].content, /Available replacement sessions/); assert.match(plain.messages[0].content, /This week's plan/);
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
    assert.match(await p.evaluate(() => planSessions().find(x => x.id === "w1-mon").w.desc), /glide on your front/);
    assert.equal(await p.evaluate(() => planSessions().find(x => x.id === "w5-fri").w.name), "Run · 2.5 km easy");
    assert.deepEqual(await p.evaluate(() => planSessions().filter(x => x.week === 14 && !x.w.segs).map(x => x.w.name)),
      ["Test · 400 m swim", "Brick · 15 min run", "Swim · easy (optional)", "Test · 5 km run"], "week 14: tests for the next block");
    assert.ok(await p.evaluate(() => planSessions().find(x => x.id === "w1-wed").optional), "Wednesday swim is optional");
    await p.click('[data-view="plan"]'); await p.waitForFunction(() => plan().done?.["w1-fri"], null, { timeout: 10000 });
    assert.equal(await p.locator(".sess .opt.missed").count(), 0, "a past optional swim is not missed"); assert.equal(await p.locator(".sess .opt").count() > 0, true);
    assert.equal(await p.evaluate(() => plan().done["w1-fri"]), "icu:i777", "today's run from the watch ticks off Friday's run");
    assert.deepEqual(await p.evaluate(() => ["Run", "TrailRun", "Swim", "OpenWaterSwim", "Ride"].map(icuSport)), ["run", "run", "swim", "swim", null]);
    await p.evaluate(() => { store.set("coach", {}); coachCheck.at = 0; return coachCheck(); });   // comments synced from the earlier coach test
    await p.waitForFunction(() => store.get("coach", {})["icu:i777"]?.text, null, { timeout: 15000 });
    assert.match(srv.claude.find(b => b.messages[0].content.includes("Jutarnje trčanje") && b.messages[0].content.includes("Session to comment on (intervals.icu)")).messages[0].content, /What the plan called for that day[\s\S]*1 km easy/);
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
    assert.ok(!srv.claude.some(b => b.messages[0].content.includes("Pedala, indoor trainer")), "no comment after the ride");
    await p.evaluate(() => coachWeek(true));
    const key = await p.evaluate(() => "week:" + ymd(lastSaturday()));
    assert.match(await p.evaluate(k => store.get("coach", {})[k]?.text, key), /Good workout/);
    const sent = srv.claude.find(b => b.system.includes("Every Saturday"));
    assert.ok(sent, "the weekly review prompt was used"); assert.match(sent.messages[0].content, /Plan: past 7 days/); assert.match(sent.messages[0].content, /Pedala rides from the past 7 days/);
    assert.equal(await p.evaluate(() => coachWeek()), null, "only once a week");
    srv.setEnv({ ANTHROPIC_API_KEY: null }); await p.context().close();
  });

  await test("strength at home: a 12-week plan of three circuits, a guided session ticks itself off", async () => {
    const p = await open({ speed: 200, voices: [["Samsung English", "en-US"]] });
    await p.evaluate(() => { settings.voice = true; const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      store.set("plan", { id: STRENGTH.id, start: ymd(d), done: {}, skipped: {} }); });
    const ss = await p.evaluate(() => planSessions().map(x => x.day + ":" + x.w.strength));
    assert.equal(ss.length, 36); assert.deepEqual(ss.slice(0, 3), ["mon:A", "wed:B", "fri:C"]);
    const [w1, w9, w12] = await p.evaluate(() => [0, 8, 11].map(i => { const w = strengthWorkout("A", i); return [w.min, w.steps.filter(s => s.kind === "work").length]; }));
    assert.deepEqual([w1[1], w9[1], w12[1]], [18, 24, 18], "3 rounds, then 4, then an easier last week");
    assert.ok(w1[0] >= 20 && w9[0] <= 45, "20 to 45 minutes");
    await p.click('[data-view="plan"]'); await p.waitForTimeout(300);
    assert.match(await p.textContent("#plan-body"), /Strength at home/);
    // run Monday's session in the player (200x faster): it announces the exercises and ticks Monday off
    await p.evaluate(() => { const x = planSessions()[0]; startStrength(x.w, x.id); });
    assert.equal(await p.evaluate(() => $("#dlg-strength").open), true);
    await p.waitForFunction(() => !$("#dlg-strength").open, null, { timeout: 30000 });
    assert.match(await p.evaluate(() => plan().done["w1-mon"]), /^app:/);
    const spoken = await p.evaluate(() => __spoken.join(" | "));
    assert.match(spoken, /Squat, 30 seconds/); assert.match(spoken, /Rest\. Next: Reverse lunge, alternating/); assert.match(spoken, /Workout complete\. Well done/);
    assert.ok(await p.evaluate(() => findWorkout("s-B-5")?.name.startsWith("Strength B")), "the coach can swap a session for another circuit");
    await p.evaluate(() => { WK.paused = true; startStrength({ name: "Reset check", steps: [{ kind: "work", n: "Squat", s: 1 }], min: 1 }); });
    await p.waitForFunction(() => !$("#dlg-strength").open, null, { timeout: 5000 });
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

  await test("remote: control from outside starts, pauses and finishes the ride", async () => {
    const p = await open({ speed: 100 });
    await p.click("#chip-trainer"); await p.click("#c-sim");
    await p.waitForFunction(() => __pedala.remote?.es?.readyState === 1);
    assert.equal(await p.evaluate(() => __pedala.S.started), false, "fresh page: the ride has not started");
    const post = a => fetch(B + "/__remote/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a }) });
    await post("start");
    await p.waitForFunction(() => __pedala.S.running === true);
    await p.waitForTimeout(300);   // 30 simulated seconds: enough samples for a summary
    await post("start");
    await p.waitForFunction(() => __pedala.S.running === false);
    await post("finish");
    await p.waitForFunction(() => document.querySelector("#dlg-summary").open);
    await post("finish");
    await new Promise(r => setTimeout(r, 300));
    assert.ok(await p.evaluate(() => document.querySelector("#dlg-summary").open), "finish ignored under the summary");
    await post("start");
    await p.waitForFunction(() => !document.querySelector("#dlg-summary").open && __pedala.S.running === true);
    await p.context().close();
  });

  await test("remote: the phone shifts the running ride, and the chip follows it", async () => {
    const p = await open();
    await p.waitForFunction(() => Number.isFinite(__pedala.S.gear));
    const g0 = await p.evaluate(() => __pedala.S.gear);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: "en-US" });
    const ph = await ctx.newPage(); ph.on("pageerror", e => pageErrors.push(e.message));
    await ph.goto(B + "/gear.html");
    await ph.waitForFunction(() => document.querySelector("#dot").classList.contains("on"), null, { timeout: 5000 });
    await ph.waitForFunction(g => document.querySelector("#value").textContent === String(g), g0, { timeout: 5000 });
    assert.equal(await ph.textContent("#title"), "Pedala remote", "the connected title is restored");
    await ph.click("#up");
    await p.waitForFunction(g => __pedala.S.gear === g + 1, g0, { timeout: 3000 });
    await ph.waitForFunction(g => document.querySelector("#value").textContent === String(g + 1), g0, { timeout: 3000 });
    assert.equal(await p.evaluate(() => document.querySelector("#chip-remote").classList.contains("on")), true);
    await ctx.close();
    await p.waitForFunction(() => !document.querySelector("#chip-remote").classList.contains("on"), null, { timeout: 5000 });
    await p.context().close();
  });
  await test("remote: the phone starts, pauses and finishes with a confirm dialog", async () => {
    const p = await open({ speed: 100 });
    await p.click("#chip-trainer"); await p.click("#c-sim");
    await p.waitForFunction(() => __pedala.remote?.es?.readyState === 1);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: "en-US" });
    const ph = await ctx.newPage(); ph.on("pageerror", e => pageErrors.push(e.message));
    await ph.goto(B + "/gear.html");
    await ph.waitForFunction(() => document.querySelector("#dot").classList.contains("on"), null, { timeout: 5000 });
    assert.equal(await ph.evaluate(() => document.querySelector("#fin").disabled), true, "connected, but the ride has not started: finish is disabled");
    await ph.click("#go");
    await p.waitForFunction(() => __pedala.S.running === true, null, { timeout: 3000 });
    await p.waitForTimeout(300);   // 30 simulated seconds: enough samples for a summary
    await ph.waitForFunction(() => document.querySelector("#go").textContent === "Pause", null, { timeout: 3000 });
    await ph.click("#go");
    await p.waitForFunction(() => __pedala.S.running === false, null, { timeout: 3000 });
    await ph.waitForFunction(() => document.querySelector("#go").textContent === "Start", null, { timeout: 3000 });
    await ph.click("#fin");
    await ph.waitForFunction(() => document.querySelector("#confirm").open);
    await ph.click("#fin-no");                            // cancel: the ride is not finished
    assert.ok(await p.evaluate(() => !document.querySelector("#dlg-summary").open));
    await ph.click("#fin"); await ph.click("#fin-yes");
    await p.waitForFunction(() => document.querySelector("#dlg-summary").open, null, { timeout: 3000 });
    await ctx.close();
    await p.context().close();
  });
  await test("remote: reconnect escalation preserves address and manual retry connects", async () => {
    const p = await open();
    await p.waitForFunction(() => Number.isFinite(__pedala.S.gear));
    const g0 = await p.evaluate(() => __pedala.S.gear);
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
    await ph.waitForFunction(g => document.querySelector("#value").textContent === String(g), g0, { timeout: 5000 });
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
    await p.evaluate(() => { __pedala.remote.links = ["http://192.168.0.20:8765/gear.html"]; __pedala.openRemote(); });
    assert.equal((await p.textContent("#remote-copy")).trim(), "Copy");
    assert.equal((await p.textContent("#remote-scan")).trim(), "Scan the code with your phone or tablet");
    assert.equal(await p.locator("#remote-scan").isVisible(), true, "the hint shows above the code");
    await p.evaluate(() => { __pedala.remote.links = []; __pedala.openRemote(); });
    assert.equal(await p.locator("#remote-scan").isVisible(), false, "and it goes away with the code");
    assert.ok((await p.textContent("#remote-none")).startsWith("The remote only works while Pedala runs"));
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

  await test("ovl: distance has its own box before cadence, speed is always shown", async () => {
  const p = await open();
  await p.click("#btn-dash"); await p.evaluate(() => render()); await p.waitForTimeout(200);
  assert.ok(await p.evaluate(() => document.querySelector("#o-hr-box").hidden), "default settings: no heart-rate box without the toggle");
    await p.waitForFunction(() => !document.querySelector("#ovl").hidden && document.querySelector("#ovl").offsetParent !== null);
    const order = await p.evaluate(() => [...document.querySelectorAll("#ovl > div")].map(d => d.id));
    assert.ok(order.indexOf("o-dist-box") >= 0 && order.indexOf("o-dist-box") < order.indexOf("o-cad-box"), "distance before cadence");
    assert.equal(await p.textContent("#o-x-unit"), "km/h");
    assert.ok(await p.evaluate(() => document.querySelector("#o-dist-box").hidden), "no route: distance hidden");
    /* no ride is running, so the distance stays exactly where the test puts it */
    await p.evaluate(() => { __pedala.S.route = { len: 50000, ele: new Array(5001).fill(0) }; __pedala.S.dist = 1234; render(); });
    await p.waitForFunction(() => !document.querySelector("#o-dist-box").hidden, null, { timeout: 5000 });
    assert.equal(await p.textContent("#o-dist"), "1.2");
    assert.equal(await p.textContent("#o-x-unit"), "km/h", "speed still visible with a route");
    await p.context().close();
  });

  await test("overlay: no heart-rate box without a strap, and the gear box takes its place", async () => {
    const p = await open({ settings: { hrOn: true } });
    await p.click("#btn-dash"); await p.evaluate(() => render()); await p.waitForTimeout(200);
    const shown = s => p.evaluate(q => { const el = document.querySelector(q); return !!el && el.getClientRects().length > 0; }, s);
    assert.equal(await shown("#o-hr-box"), false, "no strap: no heart-rate box");
    assert.equal(await shown("#o-gear-box"), true, "the gear box is there instead");
    assert.equal(await p.textContent("#o-gear"), "10");
    assert.equal(await p.textContent("#o-gear-lbl"), "Gear · ratio 2.04");
    await p.keyboard.press("ArrowUp"); await p.waitForTimeout(150);
    assert.equal(await p.textContent("#o-gear"), "11", "the gear box follows the shift");
    assert.equal(await p.textContent("#o-gear-lbl"), "Gear · ratio 2.22");
    await p.evaluate(() => { __pedala.S.hrm = {}; render(); });   // a strap appears
    assert.equal(await shown("#o-hr-box"), true, "a strap brings the heart-rate box back");
    assert.equal(await shown("#o-gear-box"), true, "and the gear box stays, beside it");
    await p.context().close();
  });

  await test("ride stats: no heart-rate cell without a strap, and the cadence fills its place", async () => {
    const p = await open({ settings: { hrOn: true } });
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

  await test("settings: Click and HR toggles hide their UI", async () => {
    const p = await open({ settings: { clickOn: false, hrOn: false } });
    assert.ok(await p.evaluate(() => $("#chip-click-p").hidden && $("#chip-click-m").hidden));
    assert.ok(await p.evaluate(() => $("#chip-hr").hidden));
    assert.ok(await p.evaluate(() => $(".stat.hr").hidden));
    assert.equal(await p.evaluate(() => document.querySelector(".stat.hr").getClientRects().length), 0, "the pulse cell is really not displayed");
    assert.ok(await p.evaluate(() => $("#click-details").hidden), "the Click setup section is folded away");
    await p.click('[data-view="workouts"]');
    assert.ok(!(await p.textContent("#wo-list")).includes("By heart rate"), "no heart-rate workouts without a strap");
    await p.click('[data-view="settings"]');
    assert.ok(await p.evaluate(() => $("#hr-on").checked === false && $("#click-on").checked === false), "both toggles start unticked");
    assert.equal(await p.evaluate(() => document.querySelector("#hr-on").closest("label").textContent.trim()), "Enable", "the HR toggle says Enable");
    assert.equal(await p.evaluate(() => document.querySelector("#click-on").closest("label").textContent.trim()), "Enable", "the Click toggle says Enable");
    assert.equal(await p.evaluate(() => [...document.querySelectorAll("h2.section-title")].some(h => h.textContent.trim() === "Heart Rate Strap (HR)")), true, "the HR section is titled Heart Rate Strap (HR)");
    await p.evaluate(() => document.querySelector("#hr-on").click());   // ticking takes effect at once
    await p.evaluate(() => document.querySelector("#click-on").click());
    assert.ok(!(await p.evaluate(() => $("#chip-hr").hidden)));
    assert.ok(!(await p.evaluate(() => $("#chip-click-p").hidden)) && !(await p.evaluate(() => $("#chip-click-m").hidden)), "both Click chips are back");
    assert.ok(!(await p.evaluate(() => $("#click-details").hidden)));
    await p.context().close();
  });

  await browser.close(); await srv.close();
  if(pageErrors.length) results.push(["FAIL", "no JavaScript errors in the page", new Error(pageErrors.join("; ")), 0]);
  for(const [s, n, e, ms] of results) console.log(`${s === "ok" ? "✓" : "✗"} ${n} (${(ms / 1000).toFixed(1)} s)${e ? "\n    " + e.message : ""}`);
  const failed = results.filter(r => r[0] !== "ok").length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
