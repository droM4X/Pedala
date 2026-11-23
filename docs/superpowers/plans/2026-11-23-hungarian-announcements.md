# Magyar bemondások — megvalósítási terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hangos bemondások magyarul is szóljanak, kizárólag a beszédre vonatkozóan, kézzel kiválasztva — a felület nyelve (HR/EN) és a képernyős szövegek érintetlenül.

**Architecture:** A beszédnyelv ma `spLang()` → `hr`/`en`, a mondatokat a `L(horvát, angol)` pár adja, a számokat a `watts`/`sayDur`/`cadSay` építi. A változás harmadik nyelvet ad ehhez a réteghez: `spLang()` → `hr`/`en`/`hu`, `L(hr, en, hu)`, magyar ágak a szám-segédekben, és egy `hu` opció a beállításokban. Semmi nem nyúl a `tr()`/`ui()`/`EN` szótárhoz.

**Tech Stack:** sima böngészős JS (`index.html`, nincs build), Node 20+ a tesztekhez, Playwright e2e a hanginjektáló harness-szel (`open({ voices })`, `__spoken`).

**Spec:** `docs/superpowers/specs/2026-11-23-hungarian-announcements-design.md`

## Global Constraints

- **Minden módosítás `index.html`-ben** (a voice szakasz ~1478–1535. sor) és `tests/e2e.js`-ben; a `README.md` *Voice* szakasza egy bekezdéssel bővül.
- `spLang()` három értéket ad: `"hr" | "en" | "hu"`. `L(hr, en, hu)` — ha a magyar hiányzik, **angolra** esik vissza.
- Az `auto` beállítás **soha** nem választ magyart: magyar csak `voiceLang === "hu"` esetén.
- Egy mondat egy nyelven szól; horvát–magyar keveredés tilos.
- A horvát `plural()` és a horvát/angol szövegek **változatlanok** — a magyar ág mellettük jelenik meg, nem helyettük.
- A felület (`tr`, `ui`, `EN` szótár, `notify`) nem kap magyar szót; a magyar csak a `speechSynthesis` bemenetére kerül.
- A beállítás neve a legördülőben `Magyar`, értéke `hu`; a magyar hang hiányát a meglévő figyelmeztető sor jelzi.
- Nincs új dependency, nincs build lépés.

## Review Focus

1. **A magyar számnevek helyesek** — szám után nincs többes jel (`3 perc`, `250 watt`, `12 kilométer`), és nem a horvát `plural()` fut le.
2. **Nem keveredik a nyelv** — egy mondat minden eleme ugyanazon a nyelven szól, akkor is, ha a hang kiválasztása később változik.
3. **Hiányzó magyar hang esetén nem lesz csend** — angolra esik vissza, és a beállításokban látszik az ok.
4. **Az `auto` nem csúszik át magyarra** — magyar böngésző + `auto` továbbra is angol/horvát.
5. **A horvát és angol bemondások bitre ugyanazok maradnak** — a meglévő e2e elvárások (`Za 10 sekundi: 3 minute na 265 vata`, `In 10 seconds: 3 minutes at 265 watts…`) változtatás nélkül zöldek.
6. **A hang kipróbálása gomb** a beállított nyelven szól, nem a felület nyelvén.

---

### Task 1A: Nyelvi csatlakozás és a Beállítások (még magyar szöveg nélkül)

**Files:** `index.html` (voice szakasz ~1478–1535., beállítások markupja ~589., EN szótár ~735.), `tests/e2e.js`

**Interfaces:**
- Consumes: a meglévő `voices()`, `say()`, `fillVoices()`, `pickVoice()`, `spLang()`.
- Produces: `isHu(v)`; `spLang() → "hr"|"en"|"hu"`; `L(hr, en, hu)` (a magyar hiányában angolra esik vissza); `settings.voiceLang === "hu"`; `pickVoice()` magyar ága; `#voice-note` magyar eset kezelése; a hiányzó magyar hang figyelmeztetése horvát forrással + EN szótár-bejegyzéssel.

- [ ] **Step 1: Írd meg a bukó e2e tesztet**

A `voice: auto never picks Hungarian…` teszt **elé**:

```js
  await test("voice: the Settings offer Hungarian, name it, and notice when the device has no Hungarian voice", async () => {
    const ok = await open({ voices: [["Google magyar", "hu-HU"], ["Samsung English", "en-US"]], settings: { voice: true, voiceLang: "hu", uiLang: "en" } });
    await ok.click('[data-view="settings"]'); await ok.waitForTimeout(200);
    assert.equal(await ok.evaluate(() => __pedala.S && document.querySelector('[name="voiceLang"] option[value="hu"]')?.textContent.trim()), "Magyar");
    assert.match(await ok.textContent("#voice-note"), /Hungarian/, "the note names the language in use");
    await ok.context().close();

    const none = await open({ voices: [["Samsung English", "en-US"]], settings: { voice: true, voiceLang: "hu", uiLang: "en" } });
    await none.click('[data-view="settings"]'); await none.waitForTimeout(200);
    assert.match(await none.textContent("#voice-note"), /Hungarian/, "the note says the Hungarian voice is missing");
    assert.match(await none.textContent("#voice-note"), /English/, "and what it falls back to");
    await none.context().close();
  });
```

- [ ] **Step 2: Futtasd, hogy bukjon** — `node tests/e2e.js` → FAIL (nincs `hu` opció).

- [ ] **Step 3: Implementáld a csatlakozást** — `isHu`, háromágú `spLang()`, `L(hr, en, hu)`, `pickVoice()` magyar ága (`voiceLang === "hu"` → első `isHu` hang, ha nincs: angol), `#voice-note` magyar ágai (`ui(hr, en)` úton, a UI nyelvén), a `hu` opció a legördülőben, `fillVoices()` csoportosítás, `say()` figyelmeztetés magyar hang hiányára (horvát forrás + **EN szótár-bejegyzés**, különben az `English: …` teszt elbukik a látható horvát szövegen).

- [ ] **Step 4: Zöldre hozd** — `node --no-warnings tests/unit.js && node tests/e2e.js` (300 mp-es limit). Ekkor a magyar bemondás **még angolul szól** (a szövegek a következő taskban jönnek), és a `voice: Hungarian is spoken…` teszt jogosan piros marad.

- [ ] **Step 5: Commit** — `git add index.html tests/e2e.js && git commit -m "Voice: third announcement language plumbing and the Hungarian Settings option"`

---

### Task 1B1: Magyar számok és az edzés-bemondások

**Files:** `index.html` (segédfüggvények ~1491–1511., a `L()` hívások az edzés-intervallumoknál ~1445–1455.), `tests/e2e.js` (a már commitolt piros teszt zöldre hozása)

**Interfaces:**
- Consumes: `L(hr, en, hu)`, `spLang()`, `isHu` az 1A-ból.
- Produces: magyar ágak a `watts`/`sayDur`/`cadSay`/`segSpeech`/`segSpeechPower` függvényekben, `NOTE_HU`, magyar szöveg az edzés közbeni bemondásokon.

- [ ] **Step 1: Futtasd a piros tesztet** — `node tests/e2e.js` (300 mp) → `voice: Hungarian is spoken when picked by hand…` FAIL, mert a hang-teszt mondata angol.
- [ ] **Step 2: Számok** — `watts(n)` → `250 watt`; `sayDur(sec)` → `3 perc 20 másodperc` (csak perc vagy csak másodperc esetén csak azt); `cadSay([lo,hi])` → `kadencia 90 és 100 között` / `kadencia 90 vagy több`; a teljesítmény-mondat `3 perc 250 watton` / `3 perc, 200-tól 250 watton`; szabadon `3 perc szabadon`; pulzuson `3 perc 145-es pulzuson`. A magyar ág **nem** hívja a horvát `plural()`-t.
- [ ] **Step 3: `NOTE_HU`** a hét megjegyzésre, a `NOTE_EN` mintájára, és `segSpeech` válassza a beszélt nyelv szerint.
- [ ] **Step 4: Az edzés-bemondások magyar szöveggel** — `Kreće trening.`, `Za 10 sekundi:`, a hang-teszt minta mondata. A horvát és angol szöveg **betű szerint változatlan**.
- [ ] **Step 5: Zöldre hozd** — `node --no-warnings tests/unit.js && node tests/e2e.js` (300 mp): minden ✓, köztük a magyar bemondás tesztje.
- [ ] **Step 6: Commit** — `git add index.html tests/e2e.js && git commit -m "Hungarian numbers and workout announcements"`

---

### Task 1B2: A maradék magyar szövegek és a README

**Files:** `index.html` (részidő-összegzések ~1455–1475., `finishWorkout` ~1637., erősítés-játék `spoken()` ~2889–2893., EN szótár ha kell), `README.md`

**Interfaces:**
- Consumes: `L(hr, en, hu)`, `NOTE_HU`, a magyar szám-segédek az 1B1-ből.
- Produces: magyar szöveg a maradék bemondásokon; README mondat.

- [ ] **Step 1: Részidő-összegzések** — kadencia-átlag, km-mondat (`12 kilométer`), intervallum-eredmény (`Interval gotov. Prosjek…`), pulzusos intervallum.
- [ ] **Step 2: `finishWorkout`** — `Stigao si na cilj.` / `Trening je gotov. Bravo.` magyar párja.
- [ ] **Step 3: Erősítés-játék** — `spoken()`, `Odmor. Sljedeće: …`, `…, N sekundi.`, a záró mondat.
- [ ] **Step 4: Ellenőrizd, hogy nincs magyar nélküli hívás** — `grep -n "L(\`" index.html` és nézd át, hogy minden bemondás-hívás három argumentumos; a nem beszéd célú `L` változókat (rajzoló függvények `const L = 40`) hagyd békén.
- [ ] **Step 5: README** — a `### Voice` szakasz egy mondattal: magyar bemondásokhoz magyar TTS-hang kell, a nyelvet a *Settings → Announcement language* állítja, és `auto` soha nem választ magyart.
- [ ] **Step 6: Zöldre hozd** — `node --no-warnings tests/unit.js && node tests/e2e.js` (300 mp), minden ✓.
- [ ] **Step 7: Commit** — `git add index.html README.md && git commit -m "Hungarian announcements for lap summaries, the finish and the strength player"`

---

## Kézi ellenőrzés a végén

1. `npm run dev`, *Postavke → Jezik najava → Magyar*, *Glas za najave*-nél egy magyar hang.
2. Intervallumos edzés indítása: az első bemondás magyarul szól, a számok helyes alakban („3 perc 250 watton").
3. `Magyar` beállítás mellett vedd ki a magyar hangot (vagy egy másik gépen): a beállítások figyelmeztetnek, a bemondás angol.
4. Váltsd vissza horvátra/angolra: minden a régiként szól.
