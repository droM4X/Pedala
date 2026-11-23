// Unit tests for the server parts: login middleware and api/sync.js (with an in-memory Vercel Blob).
// Run: npm test   (or: node tests/unit.js)
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");

const results = [];
async function test(name, fn){ try{ await fn(); results.push(["ok", name]); }catch(e){ results.push(["FAIL", name, e]); } }

(async () => {
  /* ---------- middleware.js ---------- */
  const { default: mw } = await import(pathToFileURL(path.join(__dirname, "..", "middleware.js")).href);
  const req = (p, init = {}) => new Request("https://pedala.example" + p, init);
  process.env.PEDALA_USER = "rider"; process.env.PEDALA_PASSWORD = "Tajna-šifra 1";

  await test("middleware: install files are public", async () => {
    for(const p of ["/manifest.webmanifest", "/sw.js", "/icons/icon-192.png"]) assert.equal(await mw(req(p)), undefined, p);
  });
  await test("middleware: pages show the login form (Croatian or English), api answers 401", async () => {
    const page = await mw(req("/", { headers: { accept: "text/html" } }));
    const html = await page.text(); assert.equal(page.status, 200); assert.match(html, /action="\/__login"/);
    assert.match(html, /Password/, "English without Accept-Language");
    assert.match(await (await mw(req("/", { headers: { accept: "text/html", "accept-language": "hr-HR,hr;q=0.9,en;q=0.8" } }))).text(), /Lozinka/, "Croatian for a Croatian browser");
    assert.equal((await mw(req("/api/intervals"))).status, 401);
    assert.equal((await mw(req("/icons/../index.html", { headers: { accept: "text/html" } }))).status, 200);   // normalized to /index.html: login form
  });
  let cookie;
  await test("middleware: wrong password is refused, right one sets a year-long cookie", async () => {
    const post = body => mw(req("/__login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }));
    assert.match((await post("user=rider&password=nope&next=/")).headers.get("location"), /e=1/);
    const ok = await post("user=rider&password=" + encodeURIComponent("Tajna-šifra 1") + "&next=/plan");
    assert.equal(ok.headers.get("location"), "/plan");
    cookie = ok.headers.get("set-cookie"); assert.match(cookie, /Max-Age=31536000/); assert.match(cookie, /HttpOnly/);
    assert.equal((await post("user=rider&password=" + encodeURIComponent("Tajna-šifra 1") + "&next=//evil.example")).headers.get("location"), "/");
  });
  await test("middleware: the cookie lets requests through until the password changes", async () => {
    const withCookie = () => mw(req("/api/sync", { headers: { cookie: cookie.split(";")[0] } }));
    assert.equal(await withCookie(), undefined);
    process.env.PEDALA_PASSWORD = "nova"; assert.equal((await withCookie()).status, 401);
    process.env.PEDALA_PASSWORD = "Tajna-šifra 1";
  });
  await test("middleware: a second profile logs in with its own password and gets its own namespace", async () => {
    process.env.PEDALA_USER2 = "ana"; process.env.PEDALA_PASSWORD2 = "druga";
    const post = body => mw(req("/__login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }));
    assert.match((await post("user=ana&password=" + encodeURIComponent("Tajna-šifra 1") + "&next=/")).headers.get("location"), /e=1/, "not with the main password");
    const ok = await post("user=ana&password=druga&next=/"), set = ok.headers.getSetCookie();
    assert.match(set[0], /^pedala_session=ana\./); assert.match(set[1], /^pedala_ns=ana;/); assert.doesNotMatch(set[1], /HttpOnly/);
    assert.equal(await mw(req("/api/sync", { headers: { cookie: set[0].split(";")[0] } })), undefined);
    assert.equal((await mw(req("/api/sync", { headers: { cookie: set[0].split(";")[0].replace("ana.", "rider.") } }))).status, 401, "a token is only good for its own user");
    const main = (await post("user=rider&password=" + encodeURIComponent("Tajna-šifra 1") + "&next=/")).headers.getSetCookie();
    assert.match(main[1], /^pedala_ns=; .*Max-Age=0/, "the main user has no namespace");
  });
  await test("middleware: a session cookie from before profiles still works", async () => {
    const legacy = (await import("node:crypto")).createHmac("sha256", "Tajna-šifra 1").update("pedala-session:rider").digest("base64url");
    assert.equal(await mw(req("/api/sync", { headers: { cookie: "pedala_session=" + legacy } })), undefined);
  });
  await test("middleware: without PEDALA_PASSWORD nobody gets in", async () => {
    const saved = process.env.PEDALA_PASSWORD; delete process.env.PEDALA_PASSWORD;
    assert.equal((await mw(req("/"))).status, 503); process.env.PEDALA_PASSWORD = saved;
  });

  /* ---------- api/sync.js ---------- */
  const blob = require("@vercel/blob"), store = new Map();
  blob.put = async (p, body) => { store.set(p, { url: "mem://" + p, pathname: p, body, uploadedAt: new Date() }); return { url: "mem://" + p }; };
  blob.get = async p => store.has(p) ? { statusCode: 200, stream: new Response(store.get(p).body).body } : null;
  blob.list = async ({ prefix }) => ({ blobs: [...store.values()].filter(b => b.pathname.startsWith(prefix)), hasMore: false });
  blob.del = async urls => { for(const u of [].concat(urls)) store.delete(String(u).replace("mem://", "")); };
  process.env.BLOB_READ_WRITE_TOKEN = "test";
  const sync = require("../api/sync.js");
  const call = async (method, url, body) => { let out; await sync({ method, url, body }, { setHeader(){}, status(c){ this.c = c; return this; }, json(o){ out = { status: this.c, body: o }; } }); return out; };
  const ride = id => ({ id, start: 1, name: "X", m: { tss: 1 }, samples: [[1, 100]] });

  await test("sync: rides go up and come back", async () => {
    assert.equal((await call("POST", "/api/sync", { action: "ride", ride: ride("r-1") })).status, 200);
    assert.equal((await call("POST", "/api/sync", { action: "ride", ride: ride("r-2") })).status, 200);
    assert.equal((await call("GET", "/api/sync?ride=r-1")).body.id, "r-1");
    assert.equal((await call("GET", "/api/sync?ride=none")).status, 404);
  });
  await test("sync: plan progress from two devices is merged, newer settings win", async () => {
    const plan = (at, done) => ({ at, data: { id: "odrzivi14", start: "2026-11-09", done, skipped: {} } });
    await call("POST", "/api/sync", { action: "state", sections: { plan: plan(100, { "w1-tue": "r-1" }), settings: { at: 100, data: { ftp: 160 } } } });
    const m = (await call("POST", "/api/sync", { action: "state", sections: { plan: plan(200, { "w1-thu": "r-2" }), settings: { at: 300, data: { ftp: 165 } } } })).body;
    assert.deepEqual(Object.keys(m.sections.plan.data.done).sort(), ["w1-thu", "w1-tue"]);
    assert.equal(m.sections.settings.data.ftp, 165);
    const stale = (await call("POST", "/api/sync", { action: "state", sections: { settings: { at: 50, data: { ftp: 999 } } } })).body;
    assert.equal(stale.sections.settings.data.ftp, 165);
  });
  await test("sync: a deleted ride is removed everywhere", async () => {
    const m = (await call("POST", "/api/sync", { action: "state", sections: {}, deleted: ["r-2"] })).body;
    assert.deepEqual(m.rides, ["r-1"]); assert.ok(!store.has("rides/r-2.json"));
  });
  await test("sync: a second profile has its own rides and plan", async () => {
    const anaCall = async (method, url, body) => { let out; await sync({ method, url, body, headers: { cookie: "pedala_session=ana.x" } }, { setHeader(){}, status(c){ this.c = c; return this; }, json(o){ out = { status: this.c, body: o }; } }); return out; };
    assert.equal((await anaCall("POST", "/api/sync", { action: "ride", ride: ride("r-ana") })).status, 200);
    const mine = (await anaCall("POST", "/api/sync", { action: "state", sections: {} })).body;
    assert.deepEqual(mine.rides, ["r-ana"]); assert.deepEqual(mine.sections, {});
    assert.ok(store.has("u/ana/rides/r-ana.json"));
    const main = (await call("POST", "/api/sync", { action: "state", sections: {} })).body;
    assert.ok(!main.rides.includes("r-ana"), "the main user does not see her rides");
    assert.equal((await anaCall("GET", "/api/sync?ride=r-1")).status, 404);
  });
  await test("sync: without a Blob token it reports 501", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN; assert.equal((await call("GET", "/api/sync")).status, 501); process.env.BLOB_READ_WRITE_TOKEN = "test";
  });

  /* ---------- api/coach.js ---------- */
  const coach = require("../api/coach.js"), realFetch = global.fetch;
  const callCoach = async (method, body) => { let out; await coach({ method, body }, { setHeader(){}, status(c){ this.c = c; return this; }, json(o){ out = { status: this.c, body: o }; } }); return out; };
  const coachRide = { id: "r-9", name: "Sweet spot", start: "2026-11-17T18:00:00Z", m: { duration: 1620, avgP: 134 }, laps: [], minutes: { podaci: [[0, 89, 59, 120]] } };
  await test("coach: off without ANTHROPIC_API_KEY", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    assert.deepEqual((await callCoach("GET")).body, { enabled: false });
    assert.equal((await callCoach("POST", { action: "comment", ride: coachRide })).status, 501);
  });
  await test("coach: no credit left gives a clear 402", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    global.fetch = async () => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }), { status: 400, headers: { "content-type": "application/json" } });
    try{ const r = await callCoach("POST", { action: "comment", ride: coachRide }); assert.equal(r.status, 402); assert.match(r.body.error, /nema kredita/); }
    finally{ global.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY; }
  });
  await test("coach: a refusal is reported, not shown as a comment", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test"; let sent;
    global.fetch = async (url, opt) => { sent = JSON.parse(opt.body); return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5",
      content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null }, usage: { input_tokens: 1, output_tokens: 0 } }), { headers: { "content-type": "application/json" } }); };
    try{
      assert.equal((await callCoach("POST", { action: "comment", ride: coachRide, notes: "190 cm" })).status, 422);
      assert.equal(sent.model, "claude-opus-5-5"); assert.equal(sent.output_config.effort, "low");
      assert.match(sent.messages[0].content, /190 cm/); assert.match(sent.messages[0].content, /Sweet spot/);
    }finally{ global.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY; }
  });

  /* ---------- lib/remote.js ---------- */
  const http = require("node:http"), { createRemote, lanLinks } = require("../lib/remote.js");

  async function relay(heartbeatMs){                      // a relay egy csupasz szerveren, hogy a szerver-bekötést ne ez tesztelje
    const r = createRemote({ heartbeatMs });
    const srv = http.createServer((req, res) => { if(!r.route(req, res)){ res.statusCode = 404; res.end("no"); } });
    await new Promise(ok => srv.listen(0, ok));
    const base = `http://127.0.0.1:${srv.address().port}`;
    return { base, r, close: () => new Promise(ok => { r.close(); srv.close(ok); }) };
  }
  const sse = base => new Promise((ok, bad) => {              // egy nyitott SSE csatorna, a beérkező eseményekkel
    const box = { events: [] }, req = http.get(base, res => {
      res.setEncoding("utf8"); let buf = "";
      res.on("data", c => { buf += c; let i; while((i = buf.indexOf("\n\n")) >= 0){ box.events.push(parseSse(buf.slice(0, i))); buf = buf.slice(i + 2); } ok({ box, end: () => req.destroy() }); });
    });
    req.on("error", bad);
  });
  const parseSse = block => { const e = {}; for(const line of block.split("\n")){
    if(line.startsWith("event:")) e.event = line.slice(6).trim();
    else if(line.startsWith("data:")) e.data = JSON.parse(line.slice(5).trim()); } return e; };
  const waitFor = async (f, ms = 2000) => { const t0 = Date.now();
    while(Date.now() - t0 < ms){ if(f()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error("timeout"); };
  const post = (base, path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  await test("remote: a shift from the phone reaches the ride page", async () => {
    const s = await relay();
    try{
      const ride = await sse(s.base + "/__remote/events?role=ride");
      assert.equal((await post(s.base, "/__remote/shift", { d: 1 })).status, 204);
      await waitFor(() => ride.box.events.some(e => e.event === "shift"));
      assert.deepEqual(ride.box.events.find(e => e.event === "shift").data, { d: 1 });
      // two quick taps: both arrive, in order, nothing is merged away
      await Promise.all([post(s.base, "/__remote/shift", { d: -1 }), post(s.base, "/__remote/shift", { d: 1 })]);
      await waitFor(() => ride.box.events.filter(e => e.event === "shift").length === 3);
      assert.deepEqual(ride.box.events.filter(e => e.event === "shift").map(e => e.data.d), [1, -1, 1]);
      ride.end();
    }finally{ await s.close(); }
  });
  await test("remote: the phone gets the gear the ride reports, also if it joins later", async () => {
    const s = await relay();
    try{
      assert.equal((await post(s.base, "/__remote/state", { gear: 7, mode: "gear", bias: 1, hrOff: 0 })).status, 204);
      const phone = await sse(s.base + "/__remote/events?role=phone");
      await waitFor(() => phone.box.events.some(e => e.event === "hello"));
      assert.deepEqual(phone.box.events.find(e => e.event === "hello").data, { gear: 7, mode: "gear", bias: 1, hrOff: 0, ride: false });
      phone.end();
    }finally{ await s.close(); }
  });
  await test("remote: the phone learns when a ride joins and when it leaves", async () => {
    const s = await relay();
    try{
      const phone = await sse(s.base + "/__remote/events?role=phone");
      await waitFor(() => phone.box.events.some(e => e.event === "hello"));
      const ride = await sse(s.base + "/__remote/events?role=ride");
      await waitFor(() => phone.box.events.some(e => e.event === "state" && e.data.ride === true));
      ride.end();
      await waitFor(() => phone.box.events.some(e => e.event === "state" && e.data.ride === false));
      phone.end();
    }finally{ await s.close(); }
  });
  await test("remote: the ride page hears the number of connected phones", async () => {
    const s = await relay();
    try{
      const ride = await sse(s.base + "/__remote/events?role=ride");
      await waitFor(() => ride.box.events.some(e => e.event === "hello"));
      assert.equal(ride.box.events.find(e => e.event === "hello").data.phones, 0);
      const phone = await sse(s.base + "/__remote/events?role=phone");
      await waitFor(() => ride.box.events.some(e => e.event === "phones" && e.data.n === 1));
      phone.end();
      await waitFor(() => ride.box.events.some(e => e.event === "phones" && e.data.n === 0));
      ride.end();
    }finally{ await s.close(); }
  });
  await test("remote: a heartbeat arrives even when nothing happens", async () => {
    const s = await relay(60);
    try{
      const phone = await sse(s.base + "/__remote/events?role=phone");
      await waitFor(() => phone.box.events.filter(e => e.event === "ping").length >= 2);
      phone.end();
    }finally{ await s.close(); }
  });
  await test("remote: a bad shift is refused, CORS is open for the phone page", async () => {
    const s = await relay();
    try{
      assert.equal((await post(s.base, "/__remote/shift", { d: 5 })).status, 400);
      assert.equal((await post(s.base, "/__remote/shift", {})).status, 400);
      assert.equal((await post(s.base, "/__remote/state", { gear: 99 })).status, 400);
      assert.equal((await fetch(s.base + "/__remote/shift")).status, 405);
      const opt = await fetch(s.base + "/__remote/shift", { method: "OPTIONS" });
      assert.equal(opt.status, 204); assert.equal(opt.headers.get("access-control-allow-origin"), "*");
      assert.match(opt.headers.get("access-control-allow-headers"), /content-type/);
    }finally{ await s.close(); }
  });
  await test("remote: http links for the phone, using the LAN address instead of localhost", () => {
    const ifs = { en0: [{ family: "IPv4", address: "192.168.0.20", internal: false }],
                  lo0: [{ family: "IPv4", address: "127.0.0.1", internal: true }] };
    assert.deepEqual(lanLinks("localhost:8765", ifs), ["http://192.168.0.20:8765/gear.html"]);
    assert.deepEqual(lanLinks("127.0.0.1:8765", ifs), ["http://192.168.0.20:8765/gear.html"]);
    assert.deepEqual(lanLinks("192.168.0.20:8765", ifs), ["http://192.168.0.20:8765/gear.html"]);
  });

  for(const [s, n, e] of results) console.log(`${s === "ok" ? "✓" : "✗"} ${n}${e ? "\n    " + e.message : ""}`);
  const failed = results.filter(r => r[0] !== "ok").length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
