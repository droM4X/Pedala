# Telefonos fokozat-távirányító — megvalósítási terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A futó Pedala-példányhoz helyi hálózaton csatlakozó telefonos lap (`gear.html`) + és − gombbal, ami `bump(±1)`-et hív, kapcsolatjelző pöttyel a telefonon és a fő app fejlécében.

**Architecture:** A `lib/remote.js` egy memóriabeli relay (SSE lefelé, POST felfelé), amit a fejlesztői szerver köt be `/__remote/*` alá. Az edzés-oldal `EventSource`-szal hallgat és `POST /__remote/state`-tel publikál; a telefon `EventSource`-szal néz és `POST /__remote/shift`-tel küld. Nincs dependency, nincs WebSocket.

**Tech Stack:** Node 20+ (CommonJS, `node:http`), sima böngészős JS build lépés nélkül, `node --test` nélküli saját mini teszt-harness (`tests/unit.js`, `tests/e2e.js`, Playwright).

**Spec:** `docs/superpowers/specs/2026-11-23-phone-gear-remote-design.md`

## Global Constraints

- **Nincs új dependency.** Sem `ws`, sem semmi más. A futtatáshoz szükséges függőségek száma marad 2.
- **CommonJS** a `lib/`, `tests/`, `api/` alatt (`require`/`module.exports`); az `index.html` és `gear.html` sima böngészős JS, build lépés nélkül.
- **A végpontok `/__remote/` alatt élnek, soha nem `api/` alatt** — az `api/*.js` Vercel-függvénnyé válik.
- **Telepített (Vercel) példányon csendben nem működik:** a lap hibát jelez, de nem indít végtelen kérés-ciklust.
- **`gear.html` angol.** Az `index.html` marad horvát forrás + `ui(hr, en)` / `tr()` fordítás; az új chip felirata `Remote`, fordítás nélkül, mint a `Click +` / `Click −`.
- **Ne nyúlj a `package.json`-hoz és ne commitold a `bun.lock`-ot** — mindkettő előzetesen módosult a munkakönyvtárban.
- A szívverés 10 000 ms, a telefon 25 000 ms-nál régebbi szívverésre pirosra vált.

## Review Focus

1. **A tesztek ne akadjanak be:** a nyitva hagyott SSE válasz miatt a `server.close()` soha nem hívná vissza a callbacket — a `remote.close()`-nak minden streamet le kell zárnia.
2. **A cím a telefonon elérhető legyen:** ha az edzés-oldalt `localhost`-ról nyitják meg, a chipnek a gép LAN-címét kell adnia, különben a telefon nem éri el.
3. **Ne legyen hamis zöld:** alvó telefon felébresztése után a pötty csak akkor zöld, ha az SSE él és 25 s-nál fiatalabb szívverés jött; a szünet alatt piros.
4. **Ne vesszen el váltás:** két gyors koppintás két külön POST; mindkettő továbbmegy, akkor is, ha az állapot-visszajelzés még nem ért körbe.
5. **Az ötödik chip ne törje el a telefonos elrendezést:** 360 px szélességen a fejléc nem csordulhat túl (a meglévő `phone layout` e2e teszt ezt méri).
6. **Telepített példányon ne pörögjön a hurok:** 3 sikertelen csatlakozás után az edzés-oldal feladja, és csak a chipre kattintva próbálja újra.

---

### Task 1: A relay modul

**Files:**
- Create: `lib/remote.js`
- Test: `tests/unit.js` (a jelentés-kimenet elé beszúrva)

**Interfaces:**
- Consumes: semmit (csak `node:http`-t közvetve, a hívó adja a `req`/`res`-t, `node:os`-t).
- Produces:
  - `createRemote({ heartbeatMs = 10000, interfaces = os.networkInterfaces() } = {})` → `{ route(req, res) => boolean, close() }`
  - `lanLinks(host, interfaces)` → `string[]`, mindegyik `http://<host>/gear.html` alakú
  - `module.exports = { createRemote, lanLinks }`

- [ ] **Step 1: Írd meg a bukó teszteket a `tests/unit.js`-be**

A jelentés-kimenet (`for(const [s, n, e] of results) console.log(...)`) **elé** szúrd be. A segédek a szekción belül élnek:

```js
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
```

- [ ] **Step 2: Futtasd, hogy bukjon**

Run: `node --no-warnings tests/unit.js`
Expected: FAIL — `Cannot find module '../lib/remote.js'`

- [ ] **Step 3: Írd meg a `lib/remote.js`-t**

Fejléc-komment egy sorban a szerepéről. A viselkedés, amit a tesztek rögzítenek:

- `createRemote({ heartbeatMs })`: memóriabeli `state = { gear: 10, mode: "gear", bias: 1, hrOff: 0 }` (a 10 az `index.html` kezdő fokozata), `rides = new Set()`, `phones = new Set()`, és egy `setInterval` `heartbeatMs`-enként.
- `route(req, res)` csak akkor csinál valamit, ha `req.url` `/^\/__remote(\/|$)/`; egyébként `false` (a hívó továbbenged). A `/__remote/` alatt minden más `true` + 404.
- Minden `/__remote/*` válaszon `access-control-allow-origin: *`; `OPTIONS` → 204 + `allow-methods: GET, POST, OPTIONS` + `allow-headers: content-type`. GET a `/shift`-re → 405. POST a `/events`-re → 405.
- `GET /__remote/events?role=ride|phone`: `content-type: text/event-stream`, `cache-control: no-cache`, `connection: keep-alive`, `res.flushHeaders?.()`, első blokk `retry: 2000`. A `req.on("close")` törli a setből, és értesíti a túloldalt (ride távozás → a phone-ok `state` eseményt kapnak `ride:false`-szal; phone távozás → a ride `phones` eseményt kap). Érvénytelen vagy hiányzó `role` → 400.
- Belépéskor `hello`: ride-nak `{ phones: phones.size, links: lanLinks(req.headers.host, interfaces) }`, phone-nak `{ ...state, ride: rides.size > 0 }`.
- `POST /__remote/shift` `{d}`: `d` csak `1` vagy `-1`, különben 400. Továbbít a ride-oknak: `shift {d}`. 204.
- `POST /__remote/state` `{gear,mode,bias,hrOff}`: `gear` egész 1..24, `mode` ∈ `gear|bias|hr`, különben 400. Eltárolja és a phone-oknak `state {...state, ride: rides.size > 0}`. 204.
- Szívverés: minden kliensnek `ping { t: Date.now() }`.
- `lanLinks(host, interfaces)`: ha a `host` hostneve `localhost` / `127.0.0.1` / `[::1]` / üres, akkor minden nem-`internal` IPv4-re `http://<ip>:<port>/gear.html`; különben `["http://<host>/gear.html"]`. Port a hostból, ha nincs, akkor kimarad.
- `close()`: `clearInterval`, majd minden streamre `res.end()` és a setek ürítése — enélkül a `server.close()` örökre vár.

SSE írás egy belső segéddel: `send(res, event, data)` → `event: <event>\ndata: <JSON>\n\n`.

- [ ] **Step 4: Futtasd, hogy átmenjen**

Run: `node --no-warnings tests/unit.js`
Expected: PASS — a `lib/remote.js` szekció mind a 7 tesztje ✓, a fájl végén `N passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lib/remote.js tests/unit.js
git commit -m "feat: relay for the phone gear remote (SSE down, POST up)"
```

---

### Task 2: Bekötés a szerverbe + az edzés-oldal

**Files:**
- Modify: `tests/support/server.js` (a `start()` belseje és a visszatérési objektum)
- Modify: `index.html` (fejléc ~396. sor, a `const bump` környéke ~3419. sor, init ~3462. sor, CSS ~47. sor)
- Test: `tests/e2e.js`

**Interfaces:**
- Consumes: `createRemote` a `lib/remote.js`-ből (Task 1).
- Produces: a lapon `remote`, `remoteSend()`, `remoteConnect()`, `#chip-remote`; a szerveren a bekötött `/__remote/*`.

- [ ] **Step 1: Írd meg a bukó e2e tesztet**

A `tests/e2e.js`-ben a `phone layout` teszt **elé**:

```js
  await test("remote: the ride page listens, and a shift from outside moves the gear", async () => {
    const p = await open();
    await p.waitForFunction(() => __pedala.S.gear === 10);
    await fetch(B + "/__remote/shift", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ d: 1 }) });
    await p.waitForFunction(() => __pedala.S.gear === 11, null, { timeout: 3000 });
    assert.equal(await p.evaluate(() => document.querySelector("#chip-remote").classList.contains("on")), false, "no phone yet");
    await p.context().close();
  });
```

- [ ] **Step 2: Futtasd, hogy bukjon**

Run: `npm i --no-save playwright && npx playwright install chromium` (ha még nincs), majd `node tests/e2e.js`
Expected: FAIL — a váltás nem érkezik meg (timeout), mert nincs relay a szerverben és nincs `#chip-remote`.

- [ ] **Step 2b: Írd meg a második e2e tesztet: telepített példányon nem pörög**

```js
  await test("remote: on a server without /__remote the chip gives up instead of looping", async () => {
    const p = await browser.newContext().then(c => c.newPage());
    let hits = 0;
    await p.route("**/__remote/**", r => { hits++; r.fulfill({ status: 404, body: "no" }); });
    await p.goto(`${B}/?simspeed=100`); await p.waitForTimeout(2500);
    assert.equal(hits, 3, "three attempts, then it stops");
    assert.equal(await p.evaluate(() => document.querySelector("#chip-remote").classList.contains("on")), false);
    await p.context().close();
  });
```

- [ ] **Step 3: Kösd be a relayt a `tests/support/server.js`-be**

- `const { createRemote } = require("../../lib/remote.js");`
- A `start()` elején: `const remote = createRemote();`
- A kéréskezelőben, **az `api/` ág után és a statikus fájlok előtt**: `if(remote.route(req, res)) return;` — enélkül a POST a statikus ágra esne és az `index.html`-t adná vissza 200-zal.
- A visszatérési objektumba nem kell új kulcs.
- A `close`-ba: `close: () => new Promise(r => { remote.close(); server.close(r); })` — a nyitva hagyott SSE válaszok nélkül a `close` nem hívódna vissza, és a tesztfutás a végén beragadna.

- [ ] **Step 4: Tedd be a chipet és a CSS-t az `index.html`-be**

A `chip-click-m` gomb után:

```html
    <button class="chip" id="chip-remote"><span class="dot"></span><span>Remote</span></button>
```

A `@media (max-width: 520px)` blokkba (a `.chip{padding:4px 9px;…}` sor mellé): `#chip-remote{display:none}` — 360 px-en a fejléc különben túlcsordul, és a `phone layout` e2e teszt elbukik.

- [ ] **Step 5: Írd meg az edzés-oldal kliensét**

A `const bump = …` **elé**:

```js
/* phone remote: the phone (gear.html) shifts through the local server; the relay is /__remote/* */
const remote = { es: null, phones: 0, links: [], tries: 0 };
function remoteState(){ const c = currentSeg(); const mode = !S.workout || c?.s.free ? "gear" : c?.s.hr ? "hr" : "bias";
  return { gear: S.gear, mode, bias: S.bias, hrOff: S.hrOff }; }
function remoteSend(){ if(remote.es?.readyState !== 1) return;
  fetch("/__remote/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(remoteState()) }).catch(() => {}); }
function remoteChip(){ setChip("#chip-remote", remote.phones ? "on" : "", "Remote"); }
function remoteSetPhones(n){ const had = remote.phones; remote.phones = n || 0; remoteChip(); if(!had && remote.phones) remoteSend(); }
function remoteConnect(){
  remote.es?.close(); remote.tries = 0;
  const es = remote.es = new EventSource("/__remote/events?role=ride");
  es.onopen = () => { remote.tries = 0; remoteSend(); };
  es.onerror = () => { if(++remote.tries >= 3){ es.close(); remote.es = null; remote.phones = 0; remoteChip(); } };   // a deployed instance has no /__remote: give up instead of looping
  es.addEventListener("hello", e => { const m = JSON.parse(e.data); remote.links = m.links || []; remoteSetPhones(m.phones); });
  es.addEventListener("phones", e => remoteSetPhones(JSON.parse(e.data).n));
  es.addEventListener("shift", e => { const m = JSON.parse(e.data); if(m.d === 1 || m.d === -1) bump(m.d); });
}
$("#chip-remote").onclick = () => {
  if(!remote.es){ remoteConnect(); return; }
  const l = remote.links[0];
  toast(l ? ui("Távirányító a telefonon: " + l, "On the phone, open " + l) : ui("Távirányító: nincs hálózati cím", "Remote: no network address"));
};
```

- A `bump`-ban a `applyControl(); render();` után: `remoteSend();` — így minden helyi váltás (gomb, Click, kurzor) azonnal kimegy a telefonra.
- Az init IIFE-ben, az `autoConnect()` **elé**: `remoteChip(); remoteConnect(); setInterval(() => { if(remote.phones) remoteSend(); }, 2000);`

- [ ] **Step 6: Futtasd a teszteket**

Run: `node --no-warnings tests/unit.js && node tests/e2e.js`
Expected: PASS — mindkét új e2e teszt ✓, a `phone layout` teszt is ✓ (nincs túlcsordulás), `0 failed`, és a futás a végén magától kilép (ha beragad, a `remote.close()` hiányzik a szerver `close`-ából).

- [ ] **Step 7: Commit**

```bash
git add index.html tests/support/server.js tests/e2e.js
git commit -m "feat: ride page listens for and publishes to the phone remote"
```

---

### Task 3: A telefonos lap

**Files:**
- Create: `gear.html`
- Modify: `README.md` (a `### Zwift Click v2` szakasz után)
- Test: `tests/e2e.js`

**Interfaces:**
- Consumes: `/__remote/events?role=phone`, `POST /__remote/shift` (Task 1); a szerver statikusan kiszolgálja a repó gyökeréből (nem kell bekötés).
- Produces: kész lap, amit a chip által mutatott címen nyit meg a telefon.

- [ ] **Step 1: Írd meg a bukó e2e tesztet**

A `remote: the ride page listens…` teszt után:

```js
  await test("remote: the phone shifts the running ride, and the chip follows it", async () => {
    const p = await open();
    await p.waitForFunction(() => __pedala.S.gear === 10);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: "en-US" });
    const ph = await ctx.newPage(); ph.on("pageerror", e => pageErrors.push(e.message));
    await ph.goto(B + "/gear.html");
    await ph.waitForFunction(() => document.querySelector("#dot").classList.contains("on"), null, { timeout: 5000 });
    assert.equal(await ph.textContent("#value"), "10", "the phone shows the gear the ride reports");
    await ph.click("#up");
    await p.waitForFunction(() => __pedala.S.gear === 11, null, { timeout: 3000 });
    await ph.waitForFunction(() => document.querySelector("#value").textContent === "11", null, { timeout: 3000 });
    assert.equal(await p.evaluate(() => document.querySelector("#chip-remote").classList.contains("on")), true);
    await ctx.close();
    await p.waitForFunction(() => !document.querySelector("#chip-remote").classList.contains("on"), null, { timeout: 5000 });
    await p.context().close();
  });
```

- [ ] **Step 2: Futtasd, hogy bukjon**

Run: `node tests/e2e.js`
Expected: FAIL — a `gear.html` 404 (a dev szerver ilyenkor az `index.html`-t adja vissza, tehát `#dot` nincs).

- [ ] **Step 3: Írd meg a `gear.html`-t**

Egy fájl, saját CSS, angol feliratok, `lang="en"`, `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`, `touch-action:manipulation`, `user-select:none`, sötét háttér. Szerkezet (ezekkel az id-kkal):

```html
<header><span id="dot"></span><span id="title">Pedala remote</span></header>
<div id="readout"><b id="value">–</b><small id="sub"></small></div>
<div id="pad">
  <button id="up" aria-label="Harder gear">+</button>
  <button id="down" aria-label="Easier gear">−</button>
</div>
<form id="conn" hidden><input id="addr" inputmode="url" autocomplete="off" spellcheck="false" placeholder="192.168.1.20:8765"><button type="submit">Connect</button></form>
```

Viselkedés:

- Tároló kulcs `pedala.remote.addr`; a cím alapból a tárolt érték, ha nincs, akkor `location.origin`. Normalizálás: trim, záró `/`-k le, `http://` előtag ha hiányzik.
- **Induláskor azonnal csatlakozik**, ha van cím (nem kell koppintani). A `#conn` űrlap csak akkor látszik, ha nincs cím, vagy 5 egymást követő hiba után (ilyenkor `#title` = `Cannot reach …`), illetve a címmező mindig elérhető egy kis `change` linkről.
- Csatorna: `new EventSource(base + "/__remote/events?role=phone")`. `onopen` → eltárolja a címet, `#conn` elrejtve, `last = Date.now()`. Események: `hello`/`state` → `st = data`, `last = Date.now()`, render; `ping` → `last = Date.now()`.
- **Pötty:** zöld (`#dot.on`) ha `es.readyState === 1 && Date.now() - last < 25000`; piros, ha nem. 3 másodperces watchdog: ha nyitott a csatorna, de a `last` 25 s-nél régebbi, `es.close()` + újracsatlakozás (félig nyitott kapcsolat ellen). Újracsatlakozás: 5 hiba után űrlap, egyébként az `EventSource` saját újrapróbálkozása.
- **Kijelző:** `mode === "gear"` → `#value` = `st.gear`, `#sub` = `Gear · 24`; `mode === "bias"` → `#value` = `Math.round(st.bias*100) + "%"`, `#sub` = `Intensity`; `mode === "hr"` → `#value` = `(st.hrOff > 0 ? "+" : "") + st.hrOff`, `#sub` = `HR offset`. Ha `st.ride === false`: `#sub` = `No ride running`, a gombok `disabled`, a pötty piros, a `#title` = `Pedala remote`.
- **Gombok:** `#up` → `{d:1}`, `#down` → `{d:-1}`; `POST base + "/__remote/shift"`, `content-type: application/json`, `keepalive: true`, hiba esetén csendben elnyelve (a pötty úgyis elárulja). A gombok `click`-re mennek, nem `pointerdown`-ra.
- Két gomb töltse ki a képernyő alsó kétharmadát, minimum 96 px magas, `font-size` ~48 px, hogy kesztyűben/hüvelykujjal is eltalálható legyen; a `#up` felül, a `#down` alul.

- [ ] **Step 4: Futtasd a teszteket**

Run: `node tests/e2e.js && node --no-warnings tests/unit.js`
Expected: PASS — a `remote: the phone shifts…` ✓, `0 failed`.

- [ ] **Step 5: Írd meg a README bekezdést**

A `README.md`-ben a `### Zwift Click v2` szakasz után, hat sorban: miért van (a podok elalszanak), hogyan kell megnyitni (`http://<a gép LAN-címe>:8765/gear.html`, a címet a fejléc `Remote` chipje mutatja), hogy a gombok ugyanazt teszik, mint a Click, hogy a zöld pötty a kapcsolat, és hogy Vercelre telepítve nem működik. A `README.hr.md`-hez nem nyúlunk.

- [ ] **Step 6: Commit**

```bash
git add gear.html README.md tests/e2e.js
git commit -m "feat: phone remote page (gear.html) with + and - shift buttons"
```

---

## Kézi ellenőrzés a végén

1. `npm run dev`, majd a gép Chrome-jában `http://localhost:8765`.
2. A fejlécben `Remote` chip; kattints rá: kiírja a `http://192.168.x.y:8765/gear.html` címet.
3. Nyisd meg ezt a címet a telefonon (azonos hálózat): zöld pötty, a fokozat ugyanaz, mint a gépen.
4. Koppints `+`-ra: a gép képernyőjén a fokozat eggyel feljebb lép.
5. Zárd le a telefont / aludjon el: a chip pöttye elalszik; ébreszd fel: magától újra zöld, a fokozat helyes.
