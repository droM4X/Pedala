# Ovl-adatok, remote-vezérlés és engedélyező kapcsolók — megvalósítási terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teljes képernyős adatsáv külön távolság- és sebességdobozt kap; a telefonos remote indít/pauzál/befejez (megerősítéssel); a beállításokban Click- és Puls-engedélyezők rejtik el a nem használt hardver felületét.

**Architecture:** Minden a meglévő mintákat követi: az ovl dobozai sima HTML+CSS a `renderOverlay()`-ben; a remote vezérlés a `lib/remote.js` buta relay-én át új `control` SSE-eseményként jut el a ride-oldal `#btn-start`/`#btn-end` logikájához, az állapot pedig a meglévő `state` esemény `started`/`running` mezőivel bővül; a kapcsolók a `settings` objektum két új, nem szinkronizált kulcsa (`clickOn`, `hrOn`), amik render-időben rejtik a chip-eket, statisztikákat és a „Po pulsu" kategóriát.

**Tech Stack:** sima böngészős JS (nincs build), Node 20+ a tesztekhez, Playwright (e2e, `--no-save` dev-eszköz), natív `<dialog>` a gear.html megerősítéshez.

**Spec:** `docs/superpowers/specs/2026-11-25-ovl-remote-controls-feature-toggles-design.md`

## Global Constraints

- **Nincs új futtatási dependency**; a `package.json`-hoz nem nyúlunk.
- Az új UI-szövegek horvát alapnyelven íródnak, és bekerülnek az angol fordítási dictbe (`"hr": "…"` kulcsok az `index.html`-ben); a `gear.html` angol marad, ahogy most.
- A magyar **hang**bejelentések nem változnak.
- A relay szerződés csak **bővül**: a régi `shift`/`state`/`hello` payloadokat a relay változatlanul elfogadja.
- Alapértékek: **`settings.clickOn = false`, `settings.hrOn = false`**; mindkettő **nem szinkronizálódik** — a `SYNC_SKIP` listához kerülnek.
- A remote Befejezés a **`#btn-end`** útja (`pause(false)` + `openSummary()`), nem a `finishWorkout()`.
- Tesztek: `node --no-warnings tests/unit.js` és `node tests/e2e.js` fusson zölden, és magától lépjen ki.
- Érintett fájlok: `index.html`, `gear.html`, `lib/remote.js`, `tests/unit.js`, `tests/e2e.js`, `README.md`. Az `api/*`, `middleware.js` érintetlen.

## Review Focus

1. **Nyitott összesítő alatt a telefon irányítása** — a telefon Startja az összesítő „Nastavi voziti" gombját kell hogy megnyomja, a Befejezés nem csinál semmit. → 3. feladat e2e-je.
2. **Régi `state`-payload a relayben** — `started`/`running` nélküli POST is érvényes maradjon (204). → 2. feladat unit tesztje.
3. **Érvénytelen `control`** — ismeretlen/hiányzó `a` 400-as, és nem dől el a relay. → 2. feladat unit tesztje.
4. **Telefon állapot nélkül** — nincs ride-oldal → mindkét gomb tiltva; van ride, de nincs elindítva edzés → Befejezés tiltva. → 4. feladat e2e-je.
5. **HR/Click kikapcsolva** — chip-ek, dashboard-statisztika, ovl-doboz és a „Po pulsu" kategória rejtve; a `max pulsus` mező és az összesítő zónái láthatóak maradnak. → 5. feladat e2e-je.

---

### Task 1: Ovl — külön távolság- és sebességdoboz

**Files:**
- Modify: `index.html:445-452` (ovl HTML), `index.html:2057-2058` (`renderOverlay` `#o-x` része), `index.html:169-173` (szűk képernyős `.ovl` szabályok)
- Test: `tests/e2e.js` (remote-tesztek után, új `test()` blokk)

**Interfaces:**
- Produces: `#o-dist-box` (`<small>Udaljenost</small><b id="o-dist">0.0</b><i>km</i>`), `#o-x` mindig sebességet mutat (`km/h`), a `#o-x-lbl` statikus „Brzina".

- [ ] **Step 1: Sikertelen e2e-teszt írása**

Új blokk a remote-tesztek után; a meglévő free ride-ot (szimulátor, dash) használja, lásd a fájlban a `#btn-start` kattintással induló teszteket:

```js
await test("ovl: distance has its own box before cadence, speed is always shown", async () => {
  const p = ...;                                       // a futó ride-oldal
  await p.waitForFunction(() => !document.querySelector("#ovl").hidden && document.querySelector("#ovl").offsetParent !== null);
  const order = await p.evaluate(() => [...document.querySelectorAll("#ovl > div")].map(d => d.id));
  assert.ok(order.indexOf("o-dist-box") >= 0 && order.indexOf("o-dist-box") < order.indexOf("o-cad-box"), "distance before cadence");
  assert.equal(await p.textContent("#o-x-unit"), "km/h");
  assert.ok(await p.evaluate(() => document.querySelector("#o-dist-box").hidden), "no route: distance hidden");
  await p.evaluate(() => { __pedala.S.route = { len: 50000 }; __pedala.S.dist = 1234; });
  await p.waitForFunction(() => !document.querySelector("#o-dist-box").hidden, null, { timeout: 5000 });
  assert.equal(await p.textContent("#o-dist"), "1.2");
  assert.equal(await p.textContent("#o-x-unit"), "km/h", "speed still visible with a route");
});
```

(Az ovl akkor látszik, ha `overlayOn()` — fullscreen vagy dash mód; a teszt dash módban fut, ahogy a meglévő videó nélküli ride-tesztek.)

- [ ] **Step 2: Futtatás, ellenőrzés hogy elbukik**

Run: `node tests/e2e.js` — Expected: FAIL (`#o-dist-box` nem létezik / `offsetParent` null).

- [ ] **Step 3: Implementálás**

`index.html:448` elé (a `#o-cad-box` sor elé) új doboz a `cad/hr/gear` mintájára:
`<div class="o-hrb" id="o-dist-box" hidden><small id="o-dist-lbl">Udaljenost</small><b id="o-dist">0.0</b><i>km</i></div>`
A `renderOverlay()`-ben (2057-2058) a `#o-x` sorok cseréje: `$("#o-dist-box").hidden = !S.route; o("#o-dist", (S.dist / 1000).toFixed(1)); o("#o-x", (S.live.speed || 0).toFixed(1));` — a `#o-x-lbl`/`#o-x-unit` marad statikus („Brzina" / „km/h"). A szűk képernyős blokkban a `#o-dist-box small`-t úgy rejtsd, ahogy a `#o-gear-box small`-t (170-173).

- [ ] **Step 4: Futtatás, ellenőrzés hogy zöld**

Run: `node --no-warnings tests/unit.js && node tests/e2e.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/e2e.js
git commit -m "ovl: separate distance box before cadence, speed always visible"
```

---

### Task 2: Relay — `control` esemény és `started`/`running` az állapotban

**Files:**
- Modify: `lib/remote.js` (route: új `POST /__remote/control`; state validáció: opcionális logikai `started`, `running`)
- Test: `tests/unit.js:132` alatti remote-blokk mellé

**Interfaces:**
- Produces (a 3-4. feladat fogyasztja):
  - `POST /__remote/control` `{ a: "start" | "pause" | "finish" }` → 204, és `control` SSE-esemény `{ a }` a ride-oldalaknak; bármi más → 400.
  - `POST /__remote/state` opcionális `started`, `running` (logikai) mezőket fogad; hiányuk nem hiba; a `hello`/`state` eseményekben visszajönnek, ha voltak.

- [ ] **Step 1: Sikertelen unit tesztek**

A meglévő `post()`/`sse()` helpersekkel (lásd `tests/unit.js:156-186` környéke):

```js
await test("remote: control reaches the ride page, invalid actions are rejected", async () => {
  const s = server(); const ride = await sse(s.base + "/__remote/events?role=ride");
  assert.equal((await post(s.base, "/__remote/control", { a: "finish" })).status, 204);
  assert.equal((await post(s.base, "/__remote/control", { a: "stop" })).status, 400);
  assert.equal((await post(s.base, "/__remote/control", {})).status, 400);
  const m = await once(ride, "control"); assert.equal(m.a, "finish");
});
await test("remote: state carries started/running, and stays valid without them", async () => {
  const s = server();
  assert.equal((await post(s.base, "/__remote/state", { gear: 7, mode: "gear", bias: 1, hrOff: 0, started: true, running: false })).status, 204);
  const phone = await sse(s.base + "/__remote/events?role=phone");
  assert.deepEqual(pick(await once(phone, "hello"), ["started", "running"]), { started: true, running: false });
  assert.equal((await post(s.base, "/__remote/state", { gear: 7, mode: "gear", bias: 1, hrOff: 0 })).status, 204, "old payload still valid");
});
```

(A `pick`/`once` helper ha nincs, a meglévő minta szerint 2-3 sor.)

- [ ] **Step 2: Futtatás, ellenőrzés hogy elbukik**

Run: `node --no-warnings tests/unit.js` — Expected: FAIL (400/`control` esemény nincs).

- [ ] **Step 3: Implementálás a `lib/remote.js`-ben**

A `shift` route mintájára új ág: érvényes `a` esetén `notify(rides, "control", { a: body.a })`, egyébként `fail(400)`. A `/__remote/state` validációba a két új mező **opcionálusan**: ha jelen vannak, logikainak kell lenniük (különben 400), a state-be `Object.assign`-nal kerülnek csak akkor, ha logikaiak. A telefon `hello`-ja a state-szel együtt adja tovább, ahogy most.

- [ ] **Step 4: Futtatás, ellenőrzés hogy zöld**

Run: `node --no-warnings tests/unit.js` — Expected: PASS (a meglévő remote-tesztek is).

- [ ] **Step 5: Commit**

```bash
git add lib/remote.js tests/unit.js
git commit -m "remote: control events and started/running in the relay state"
```

---

### Task 3: Ride-oldal — `control` kezelés és állapot-küldés

**Files:**
- Modify: `index.html:3465-3466` (`remoteState()`), `index.html:1971` (`render()` vége), `index.html:3473-3478` (`remoteConnect()` listener-ek)
- Test: `tests/e2e.js` (a meglévő remote-tesztekhez csatlakozva)

**Interfaces:**
- Consumes: a 2. feladat relay-szerződése (`control` esemény, state-mezők).
- Produces: `remoteState()` tartalmaz `started: !!S.started, running: !!S.running`; a ride-oldal kezelői a 4. feladat viselkedését adják.

- [ ] **Step 1: Sikertelen e2e-teszt**

A meglévő „remote: the ride page listens" teszt mintájára (ride-oldal + sim):

```js
await test("remote: control from outside starts, pauses and finishes the ride", async () => {
  const p = ...;                                        // ride-oldal, edzés el sem indult még
  await fetch(B + "/__remote/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: "start" }) });
  await p.waitForFunction(() => __pedala.S.running === true);
  await fetch(B + "/__remote/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: "start" }) });
  await p.waitForFunction(() => __pedala.S.running === false);
  await fetch(B + "/__remote/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: "finish" }) });
  await p.waitForFunction(() => document.querySelector("#dlg-summary").open);
  // a summary alatt a start = "Nastavi voziti", a finish nem csinál semmit
  await fetch(B + "/__remote/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: "finish" }) });
  await new Promise(r => setTimeout(r, 300));
  assert.ok(await p.evaluate(() => document.querySelector("#dlg-summary").open), "finish ignored under the summary");
  await fetch(B + "/__remote/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: "start" }) });
  await p.waitForFunction(() => !document.querySelector("#dlg-summary").open && __pedala.S.running === true);
});
```

- [ ] **Step 2: Futtatás, ellenőrzés hogy elbukik**

Run: `node tests/e2e.js` — Expected: FAIL (nincs `control` listener, `S.running` nem változik).

- [ ] **Step 3: Implementálás**

- `remoteState()` (3465-3466): a visszaadott objektum kapja a `started: !!S.started, running: !!S.running` mezőket.
- `render()` (1971) legvégén: változás-követő küldés — `const rs = JSON.stringify(remoteState()); if(remote.es?.readyState === 1 && rs !== remote.sent){ remote.sent = rs; remoteSend(); }` (a `remote` objektum kap egy `sent: ""` mezőt).
- `remoteConnect()`-ben új listener: `es.addEventListener("control", e => { const m = JSON.parse(e.data); if(m.a === "finish"){ if(!$("#dlg-summary").open) $("#btn-end").click(); } else if(m.a === "start" || m.a === "pause"){ if($("#dlg-summary").open){ if(m.a === "start") $("#sum-resume").click(); } else $("#btn-start").click(); } });`
  — a `#btn-end` tiltott állapotban (nem indult el edzés) nem csinál semmit, a `#btn-start` a saját toggle-logikája szerint indulít/pauzál/folytat.

- [ ] **Step 4: Futtatás, ellenőrzés hogy zöld**

Run: `node --no-warnings tests/unit.js && node tests/e2e.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/e2e.js
git commit -m "remote: the ride page obeys control events and reports started/running"
```

---

### Task 4: gear.html — Start/Befejezés sor és megerősítő modal

**Files:**
- Modify: `gear.html` (HTML, CSS, JS — a `#pad` után, a `render()`-ben, a gomb-eseményekben)
- Test: `tests/e2e.js` (a meglévő „the phone shifts" teszt blokkja után)

**Interfaces:**
- Consumes: `POST /__remote/control` (2. feladat), `hello`/`state` payload `started`/`running` (2-3. feladat).
- Produces: `#go` (Start/Pauza felirat), `#fin` (Befejezés), `#confirm` natív `<dialog>` Igen (`#fin-yes`) / Mégse (`#fin-no`) gombokkal.

- [ ] **Step 1: Sikertelen e2e-teszt**

A meglévő telefonos teszt mintájára (ride-oldal fut, `ph` = gear.html):

```js
await test("remote: the phone starts, pauses and finishes with a confirm dialog", async () => {
  const p = ..., ph = ...;                               // ride + gear.html csatlakozva
  await ph.click("#go");  await p.waitForFunction(() => __pedala.S.running === true);
  assert.equal(await ph.textContent("#go"), "Pause");
  await ph.click("#go");  await p.waitForFunction(() => __pedala.S.running === false);
  assert.equal(await ph.textContent("#go"), "Start");
  await ph.click("#fin"); await ph.waitForFunction(() => document.querySelector("#confirm").open);
  await ph.click("#fin-no");                            // mégse: nem fejezi be
  assert.ok(await p.evaluate(() => !document.querySelector("#dlg-summary").open));
  await ph.click("#fin"); await ph.click("#fin-yes");
  await p.waitForFunction(() => document.querySelector("#dlg-summary").open);
});
```

- [ ] **Step 2: Futtatás, ellenőrzés hogy elbukik**

Run: `node tests/e2e.js` — Expected: FAIL (`#go` nem létezik).

- [ ] **Step 3: Implementálás a `gear.html`-ben**

- HTML a `#pad` után: `<div id="ctrl"><button id="go">Start</button><button id="fin">Finish</button></div>` és `<dialog id="confirm"><p>Finish the workout?</p><div class="cacts"><button id="fin-yes">Finish</button><button id="fin-no">Cancel</button></div></dialog>` (a lap angol marad).
- CSS: `#ctrl{display:flex;gap:12px;padding-bottom:10px}` — a gombok kb. fele akkora mint a `#pad` gombok (`min-height:56px;font-size:22px`), a `#pad{flex:1}` helyett a `#pad` kapjon helyet a `#ctrl` fölött.
- JS: a `render()`-ben `st.ride === false` → `#go` és `#fin` is `disabled` (mint most a `+/-`); egyébként `#go.disabled = false`, `#fin.disabled = !st.started`; `#go` felirat: `st.running ? "Pause" : "Start"`.
- `#go.onclick`: `POST base + "/__remote/control" {a:"start"}` (a meglévő `+/-` fetch-minta, `keepalive`).
- `#fin.onclick`: `#confirm.showModal()`; `#fin-no` → `close()`; `#fin-yes` → `close()` + `POST {a:"finish"}`.
- README: a remote-ról szóló bekezdéshez egy mondat a két új gombról.

- [ ] **Step 4: Futtatás, ellenőrzés hogy zöld**

Run: `node --no-warnings tests/unit.js && node tests/e2e.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gear.html tests/e2e.js README.md
git commit -m "remote: start/pause and finish with confirm on the phone"
```

---

### Task 5: Beállítások — Puls- és Click-engedélyezők

**Files:**
- Modify: `index.html:594-596` környéke (új szekciók az `intervals.icu` előtt), `index.html:620-623` (Zwift Click blokk áthelyezése), `index.html:710` (`SYNC_SKIP`), `index.html:725` (settings alapértékek), `index.html:2171` (`renderWorkouts` groups), `index.html:2049` környéke (`renderOverlay` `#o-hr-box`), `index.html:3376-3385` (`autoConnect`), `index.html:3461`/`3357` (chip-ek rejtése), `tests/e2e.js:31` környéke (settings-előretöltés)
- Test: `tests/e2e.js` (új blokk a végén)

**Interfaces:**
- Produces: `settings.clickOn`, `settings.hrOn` (default `false`, `SYNC_SKIP`-en), `#click-on`/`#hr-on` checkboxok a beállításokban, `applyToggles()` futtatásidőben.

- [ ] **Step 1: Sikertelen e2e-teszt**

A meglévő settings-előretöltés mintájára (`tests/e2e.js:31`):

```js
// az oldal betöltése előtt: localStorage "pedala.settings" = { clickOn: false, hrOn: false }
await test("settings: Click and HR toggles hide their UI", async () => {
  const p = ...;                                        // betöltés az előretöltött settings-szel
  assert.ok(await p.evaluate(() => document.querySelector("#chip-click-p").hidden));
  assert.ok(await p.evaluate(() => document.querySelector("#chip-hr").hidden));
  assert.ok(await p.evaluate(() => document.querySelector(".stat.hr").hidden));
  await p.click('[data-view="workouts"]');              // a workout-választó nézet
  assert.ok(!(await p.textContent("#wo-list")).includes("Po pulsu"));
  await p.click('[data-view="settings"]');
  await p.evaluate(() => document.querySelector("#hr-on").click());   // bepipálás → azonnal él
  await p.evaluate(() => document.querySelector("#click-on").click());
  assert.ok(!(await p.evaluate(() => document.querySelector("#chip-hr").hidden)));
  assert.ok(!(await p.evaluate(() => document.querySelector("#chip-click-p").hidden)));
});
```

(Alap, bepipálatlan állapotban a chip-ek `hidden` attribútummal rejtettek; a pontos nézetváltó szelektorokat a fájlban meglévő `data-view` minta adja.)

- [ ] **Step 2: Futtatás, ellenőrzés hogy elbukik**

Run: `node tests/e2e.js` — Expected: FAIL (a chip-ek látszanak / `#hr-on` nincs).

- [ ] **Step 3: Implementálás**

- **Settings alapértékek + szinkron** (725, 710): a `settings` defaultok közé `clickOn: false, hrOn: false`; a `SYNC_SKIP` listára `clickOn`, `hrOn`.
- **HTML**: a `</form>` (594) után, az `intervals.icu` cím (596) elé két szekció, sorrendben:
  1. **Puls**: `<h2 class="section-title">Puls</h2>` + `<p class="note">Pulsmetar je narukvica ili prsluk koji bežično šalje tvoj puls. Ako ga uključiš, gumb Puls gore desno spaja ga, a Pedala pokazuje puls uživo i nudi treninge po pulsu.</p>` + `<label class="check note" style="display:flex"><input type="checkbox" id="hr-on"> Koristim pulsmetar</label>` (az `#icu-auto` mintájára).
  2. **Zwift Click**: a mai szekció (620-623) ide kerül át, a címe után egy `#click-on` checkbox (`Koristim Zwift Click`), a többi tartalom (note + gombok + napló) egy `#click-details` divben, ami `hidden`, ha nincs engedélyezve.
  Angol fordítás a dictbe: a két note és a két checkbox-címke pontos szövege párban (`"…": "A heart rate strap is a wristband or chest belt that sends your pulse wirelessly. If you enable it, the HR button in the top right connects it, and Pedala shows your live pulse and offers heart-rate workouts."`, `"Koristim pulsmetar": "I use a heart rate strap"`, `"Koristim Zwift Click": "I use a Zwift Click"`).
- **Viselkedés**: `$("#hr-on").onchange` / `$("#click-on").onchange` az `#icu-auto` mintájára (`settings.hrOn = e.target.checked; store.set("settings", settings);`), plusz meghívja az `applyToggles()`-t; a beállításoknézet-populate helyén (ahol `$("#icu-auto").checked` állítódik, `index.html:2413`) a két új checkbox is visszatöltődjön.
- **`applyToggles()`** (induláskor + onchange-ből): `#chip-click-p`, `#chip-click-m`, `#chip-hr`, `.stat.hr` és `#click-details` `hidden` attribútumát állítja (`settings.clickOn` / `settings.hrOn` szerint). Ha a `.stat.hr`-t CSS `display` szabály felülírná, a `[hidden]` érvényesítéséhez adj hozzá egy `.stat[hidden]{display:none}` szabályt.
- **Ovl** (`renderOverlay`, ~2049): `$("#o-hr-box").hidden = !hrOn || !settings.hrOn`.
- **Workout-választó** (2171): a groups ciklusban `if(cat === "hr" && !settings.hrOn) continue;`.
- **Auto-connect** (`autoConnect`, 3376-3385): a `dev.id === k.hr` ág csak `settings.hrOn` mellett fusson, a `clicks.includes(dev.id)` ág csak `settings.clickOn` mellett (pl. `else if(dev.id === k.hr && settings.hrOn)`).
- README: rövid említés, hogy a Click és a pulsmeter engedélyezendő a beállításokban.

- [ ] **Step 4: Futtatás, ellenőrzés hogy zöld**

Run: `node --no-warnings tests/unit.js && node tests/e2e.js` — Expected: PASS (a teljes sor).

- [ ] **Step 5: Commit**

```bash
git add index.html tests/e2e.js README.md
git commit -m "settings: Click and heart-rate enable toggles, placed before intervals.icu"
```

---

### Task 6: Vég-ellenőrzés

- [ ] **Step 1: Teljes sor + alapállapot ellenőrzés**

Run: `node --no-warnings tests/unit.js && node tests/e2e.js` — Expected: minden PASS. Gyors kézi ellenőrzés alapböngészőben: alapértékekkel (minden kapcsoló ki) a felső chipsorban csak a trenažer/eszköz-chip-ek látszanak, és a beállítások új sorrendje: űrlap → Puls → Zwift Click → intervals.icu.

- [ ] **Step 2: Commit (ha volt még javítás)**

```bash
git add -A && git commit -m "ovl, remote, settings toggles: final polish"
```
