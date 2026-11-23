# Remote modal QR — megvalósítási terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Remote` chipre kattintva középen egy modal nyílik (X-szel zárható), felül a `gear.html` LAN-címét tartalmazó QR-kóddal, alatta a linkkel.

**Architecture:** `qr.js` a repó gyökerében egy önálló, dependency-mentes QR-kódoló (byte mód, ECC M, verzió 1–10), `window.QR` a böngészőnek és `module.exports` a node-os tesztnek. Az `index.html` egy új `<dialog id="dlg-remote">`-ot kap, amit a chip kattintása nyit; a QR SVG-ként kerül a modalba.

**Tech Stack:** sima böngészős JS (nincs build), Node 20+ a tesztekhez, Playwright (e2e) és `jsqr` (dekóder) — mindkettő csak `--no-save` dev-eszköz.

**Spec:** `docs/superpowers/specs/2026-11-23-remote-modal-qr-design.md`

## Global Constraints

- **Nincs új futtatási dependency.** A `qr.js` csak saját kód; a `jsqr` és a Playwright `npm i --no-save` eszköz, a `package.json`-hoz nem nyúlunk.
- A `qr.js` UMD-szerű: böngészőben `window.QR`, node-ban `module.exports = { encode, svg }`.
- `QR.encode(text, opts)` → `{ version, size, modules }`, ahol `modules[y][x] === true` a sötét modul; `QR.svg(matrix, opts)` → `<svg …>` string.
- Byte mód, ECC szint **M** alapból, verzió **1–10** (a 10 felettit nem támogatjuk), a legkisebb befogadó verzió automatikusan.
- A fájlok: új `qr.js`; módosul `index.html`, `tests/unit.js`, `tests/e2e.js`, `README.md`. A `gear.html`, `lib/remote.js`, `tests/support/server.js` és `api/*` érintetlen.
- A `#chip-remote` mai viselkedése megmarad: ha az `EventSource` halott (`remote.es === null`), a kattintás előbb újraindítja.
- A modal akkor is működik, ha nincs LAN-cím (`remote.links` üres): ilyenkor QR nélkül, magyarázó sorral.
- A meglévő `dialog` stílus és a `data-close` minta újrahasználva; a modal feliratai a szokásos `ui(hr, en)`/`tr()` úton mennek.
- Teszt: a `node --no-warnings tests/unit.js` és a `node tests/e2e.js` fusson zölden, a folyamat magától lépjen ki.

## Review Focus

1. **A QR valóban dekódolható** — nem elég, hogy mátrixot ad: a `jsqr` round-trip a bizonyíték (rossz ECC-tábla, maszk vagy format info azonnal kiderül).
2. **A payload hossza** — 37–60 karakteres URL-ek (porttal, hosszabb hoszttal) is menjenek; a verzióválasztás ne csorduljon túl.
3. **A modal a valós címre mutasson** — a link a szerver `hello` eseményéből jön, tehát a chip kattintás pillanatában érvényes címet kell mutatnia, és `localhost`-ról nyitva a LAN-címet, ne a `localhost`-ot.
4. **Ne törjön el semmi a meglévő dialógusokon** — a `data-close` handler minden `[data-close]`-ra fut, az új modal gombjai ne ütközzenek.
5. **Billentyűzet és telefon** — Esc zárja a modalt (natív `<dialog>`), és a QR a meglévő sötét témán is olvasható (világos háttér a QR körül, csendes zónával).

---

### Task 1: A QR-kódoló (`qr.js`) round-trip teszttel

**Files:**
- Create: `qr.js`
- Modify: `tests/unit.js` (a jelentés-kimenet elé), `README.md` (a teszt-parancs sora, 92.)

**Interfaces:**
- Consumes: semmit.
- Produces: `QR.encode(text, { ecc = "M" } = {})` → `{ version, size, modules }`, `QR.svg({ size, modules }, { margin = 4 } = {})` → `string`.

- [ ] **Step 1: Telepítsd a dekódert a teszthez**

Run: `npm i --no-save jsqr`
Expected: `node_modules/jsqr` létrejön, a `package.json` **nem** változik (`--no-save`).

- [ ] **Step 2: Írd meg a bukó round-trip tesztet**

A `tests/unit.js`-ben, a jelentés-kimenet (`for(const [s, n, e] of results) console.log(...)`) **elé**:

```js
  /* ---------- qr.js ---------- */
  const QR = require("../qr.js");
  let jsQR;
  try{ jsQR = require("jsqr").default || require("jsqr"); }
  catch{ throw new Error("the QR round-trip test needs the decoder: npm i --no-save jsqr"); }

  /* the matrix as an RGBA buffer the decoder can read: 4 px per module, plus the quiet zone */
  function qrPixels({ size, modules }, margin = 4, scale = 4){
    const px = (size + margin * 2) * scale, data = new Uint8ClampedArray(px * px * 4).fill(255);
    for(let y = 0; y < size; y++) for(let x = 0; x < size; x++) if(modules[y][x])
      for(let dy = 0; dy < scale; dy++) for(let dx = 0; dx < scale; dx++){
        const i = (((y + margin) * scale + dy) * px + ((x + margin) * scale + dx)) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    return { data, width: px, height: px };
  }
  const decodeQr = text => { const m = QR.encode(text), { data, width, height } = qrPixels(m); const r = jsQR(data, width, height); return r && r.data; };

  await test("qr: a URL survives the round trip through a real decoder", () => {
    for(const text of ["http://192.168.0.20:8765/gear.html",
                       "http://my-very-long-laptop-hostname.local:8765/gear.html",
                       "x"])
      assert.equal(decodeQr(text), text, text);
  });
  await test("qr: the shortest version that fits, with a real quiet zone and a square matrix", () => {
    const m = QR.encode("http://192.168.0.20:8765/gear.html");
    assert.ok(m.version >= 1 && m.version <= 10, `version ${m.version}`);
    assert.equal(m.size, 17 + 4 * m.version);
    assert.equal(m.modules.length, m.size); assert.ok(m.modules.every(r => r.length === m.size));
    const svg = QR.svg(m);
    assert.match(svg, /^<svg /); assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  });
  await test("qr: a longer payload gets a bigger version, not a truncated one", () => {
    const short = QR.encode("http://a.b/c"), long = QR.encode("http://192.168.100.200:8765/gear.html?x=" + "y".repeat(60));
    assert.ok(long.version > short.version, `${short.version} -> ${long.version}`);
    assert.equal(decodeQr("http://192.168.100.200:8765/gear.html?x=" + "y".repeat(60)), "http://192.168.100.200:8765/gear.html?x=" + "y".repeat(60));
  });
```

- [ ] **Step 3: Futtasd, hogy bukjon**

Run: `node --no-warnings tests/unit.js`
Expected: FAIL — `Cannot find module '../qr.js'`

- [ ] **Step 4: Írd meg a `qr.js`-t**

Követelmények (a részletek a QR-szabványból, ISO/IEC 18004; a táblázatokat ne tippeld — a round-trip teszt a bíró):

- Byte mód (mode indicator `0100`), ECC **M**, verzió 1–10, a legkisebb befogadó verzió.
- Karakterhossz: 8 bit verzió 1–9-nél, 16 bit a 10-nél; terminátor, byte-padding, `0xEC`/`0x11` kitöltés.
- Reed–Solomon GF(256) fölött (primitív polinom `0x11d`), a verzió/ECC-szint blokk-felosztása szerint, majd interleaving.
- Funkció-minták: sarok-keresők + szeparátorok, időzítő sor/oszlop a 6. indexen, igazítási minták (v2-től), sötét modul, format info 15 bit (BCH, maszk `0x5412`) kétszer, version info 18 bit (v7-től).
- Adatelhelyezés cikkcakkban jobb alulról, a funkció-modulok kihagyásával.
- Maszkolás: mind a 8 maszk, a négy büntetőfeltétel (N1=3, N2=3, N3=40, N4=10) szerinti legjobb választás.
- `encode` a `{ version, size, modules }` objektumot adja; `svg(m, { margin = 4 })` egy `<svg viewBox="0 0 W W">` stringet, egyetlen `<path>`-tal vagy rect-ekkel, fehér háttérrel (a QR a sötét témán is olvasható legyen).
- Export: `if(typeof module === "object" && module.exports) module.exports = { encode, svg }; else globalThis.QR = { encode, svg };`

- [ ] **Step 5: Futtasd, hogy átmenjen**

Run: `node --no-warnings tests/unit.js`
Expected: PASS — a három `qr:` teszt ✓, `0 failed`, a folyamat kilép.

- [ ] **Step 6: Írd be a dekódert a README teszt-parancsába**

A 92. sor (`npm i --no-save playwright && npx playwright install chromium`) mellé/fölé egy sor:
`npm i --no-save jsqr          # the QR round-trip test decodes what qr.js encodes`

- [ ] **Step 7: Commit**

```bash
git add qr.js tests/unit.js README.md
git commit -m "feat: dependency-free QR encoder for the remote link"
```

---

### Task 2: A modal és a chip bekötése

**Files:**
- Modify: `index.html` (dialog a ~684. sor környékén, CSS a `dialog` szabályok mellett ~210., a `#chip-remote` kezelője ~3449., `__pedala` export a fájl végén), `tests/e2e.js`, `README.md`

**Interfaces:**
- Consumes: `QR.encode`, `QR.svg` a `qr.js`-ből (Task 1), `remote.links` (a szerver `hello` eseménye, `lib/remote.js:29`).
- Produces: `openRemote()` az `index.html`-ben (a `__pedala`-ba is bekerül a tesztelhetőséghez), `#dlg-remote` modal.

- [ ] **Step 1: Írd meg a bukó e2e teszteket**

A `remote: a deployed instance …` teszt **elé**:

```js
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
    assert.ok(box.width > 100 && box.height > 100, `the QR has a size (${box.width}x${box.height})`);
    const centered = await dlg.evaluate(d => { const r = d.getBoundingClientRect();
      return Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 40 && Math.abs((r.top + r.bottom) / 2 - innerHeight / 2) < 40; });
    assert.equal(centered, true, "the modal is centered");
    await p.click("#dlg-remote [data-close]");
    assert.equal(await dlg.evaluate(d => d.open), false, "the X closes it");
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
```

- [ ] **Step 2: Futtasd, hogy bukjon**

Run: `node tests/e2e.js`
Expected: FAIL — nincs `#dlg-remote` (a `locator(...).evaluate` hibát dob).

- [ ] **Step 3: Tedd be a modalt és a CSS-t**

A `#dlg-click` dialog **után** (a `<div class="toast">` elé):

```html
<dialog id="dlg-remote">
  <button class="x" id="remote-x" type="button" data-close aria-label="Zatvori">✕</button>
  <h2>Remote</h2>
  <div id="qr-box"></div>
  <p id="remote-none" hidden>Nema mrežne adrese: otvori Pedalu na računalu u istoj mreži, ili upiši adresu u telefon ručno.</p>
  <p class="remote-link"><b id="remote-link"></b></p>
  <div class="dlg-acts"><button class="btn" id="remote-copy" type="button">Kopiraj</button><button class="btn" data-close>Zatvori</button></div>
</dialog>
```

CSS a `dialog.wide` szabályok mellé: a `dialog#dlg-remote` legyen `position:relative;text-align:center`, az `#qr-box svg{display:block;width:min(260px,60vw);height:auto;margin:0 auto 14px;background:#fff;border-radius:10px;padding:8px}`; a `.x` gomb abszolút a jobb felső sarokban (`position:absolute;top:10px;right:10px;…`).

Ugyanebben a lépésben kösd be a kódolót a fő script **elé** (`index.html:685`, a `<script>` fölé):

```html
<script src="/qr.js"></script>
```

- [ ] **Step 4: Kösd be a chipet és a QR-t**

A `$("#chip-remote").onclick` **helyére**:

```js
function openRemote(){
  const link = remote.links[0] || "";
  $("#remote-link").textContent = link;
  $("#remote-none").hidden = !!link;
  $("#qr-box").innerHTML = link ? QR.svg(QR.encode(link), { margin: 4 }) : "";   // two calls, one place: nothing else draws the QR
  $("#dlg-remote").showModal();
}
$("#chip-remote").onclick = () => { if(!remote.es) remoteConnect(); openRemote(); };   // a dead connection is retried, and the modal opens either way
$("#remote-copy").onclick = () => { const t = remote.links[0]; if(!t) return;
  navigator.clipboard?.writeText(t).then(() => toast(ui("Kopirano", "Copied")), () => toast(t)); };
```

A `__pedala` exportba vedd fel az `openRemote`-t is.

- [ ] **Step 5: Futtasd a teszteket**

Run: `node --no-warnings tests/unit.js && node tests/e2e.js`
Expected: PASS — mindkét új e2e ✓, a meglévő `phone layout` ✓, `0 failed`.

- [ ] **Step 6: Egészítsd ki a README-t**

A meglévő, telefonos távirányítóról szóló bekezdésben egy fél mondat: a `Remote` chipre kattintva QR-kód jelenik meg, amit a telefon beolvas, és ezzel megnyitja a `gear.html`-t.

- [ ] **Step 7: Commit**

```bash
git add index.html tests/e2e.js README.md
git commit -m "feat: the Remote chip opens a modal with a QR code for the phone"
```

---

## Kézi ellenőrzés a végén

1. `npm run dev`, `http://localhost:8765`, kattints a `Remote` chipre: középen a modal, felül a QR, alatta a `http://192.168.x.y:8765/gear.html` link.
2. Olvasd be a QR-t a telefonnal: megnyílik a `gear.html`, és pár másodperc múlva zöld pötty.
3. Esc és a ✕ is zárja a modalt.
4. Ha a telefonon nincs kamera-alkalmazás QR-hez, a Copy gombbal a vágólapra kerül a link.
