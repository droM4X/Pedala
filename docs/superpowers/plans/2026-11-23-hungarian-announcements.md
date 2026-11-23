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

### Task 1: A beszédnyelv harmadik értéke és a magyar szövegek

**Files:**
- Modify: `index.html` (voice szakasz: ~1478–1535.; a bemondás-hívások ~1445–1475. és ~2888–2889.; a beállítások markupja ~589.)
- Test: `tests/e2e.js`

**Interfaces:**
- Consumes: a meglévő `voices()`, `plural()`, `CAD_ANY`, `hrTarget()`, `toWatts()`.
- Produces: `isHu(v)`, `spLang() → "hr"|"en"|"hu"`, `L(hr, en, hu)`, `settings.voiceLang === "hu"`, `pickVoice()` magyar ága, `fillVoices()` magyar csoportja.

- [ ] **Step 1: Írd meg a bukó e2e teszteket**

A `tests/e2e.js`-ben a meglévő `voice: everything English…` teszt **után**:

```js
  await test("voice: Hungarian is spoken when picked by hand, and falls back with a notice without a Hungarian voice", async () => {
    const hu = await open({ voices: [["Google magyar", "hu-HU"], ["Samsung English", "en-US"]], settings: { voice: true, voiceLang: "hu", uiLang: "en" } });
    await hu.click('[data-view="settings"]'); await hu.click("#btn-voice-test"); await hu.waitForTimeout(300);
    const sentence = (await hu.evaluate(() => __spoken))[0];
    assert.match(sentence, /10 másodperc/, sentence);
    assert.match(sentence, /perc/, sentence);
    assert.doesNotMatch(sentence, /sekundi|vata|kadenca|vat\b/, "no Croatian words in a Hungarian sentence: " + sentence);
    await hu.context().close();

    const none = await open({ voices: [["Samsung English", "en-US"]], settings: { voice: true, voiceLang: "hu", uiLang: "en" } });
    await none.click('[data-view="settings"]'); await none.waitForTimeout(200);
    assert.match(await none.textContent("#voice-note"), /Hungarian/, "the settings say a Hungarian voice is missing");
    await none.click("#btn-voice-test"); await none.waitForTimeout(300);
    assert.match((await none.evaluate(() => __spoken))[0], /^In 10 seconds/, "without a Hungarian voice it speaks English rather than nothing");
    await none.context().close();
  });
  await test("voice: auto never picks Hungarian, even in a Hungarian browser", async () => {
    const p = await open({ locale: "hu-HU", voices: [["Google magyar", "hu-HU"], ["Samsung English", "en-US"]], settings: { voice: true, voiceLang: "auto" } });
    await p.click('[data-view="settings"]'); await p.click("#btn-voice-test"); await p.waitForTimeout(300);
    assert.match((await p.evaluate(() => __spoken))[0], /^In 10 seconds/, "auto stays English/Hungarian-free");
    await p.context().close();
  });
```

- [ ] **Step 2: Futtasd, hogy bukjon**

Run: `node tests/e2e.js`
Expected: FAIL — a magyar beállítás nem létezik, a bemondás horvát/angol, a `#voice-note` nem említ magyart.

- [ ] **Step 3: Nyelvfelismerés, `spLang`, `L`**

- `isHu` az `isHr`/`isEn` mellé (`index.html:1478`):
  `const isHu = v => /^hu([-_]|$)/i.test(v?.lang || "");`
- `spLang()` (`index.html:1489`) háromágúvá: horvát → `"hr"`, magyar → `"hu"`, egyébként `"en"`.
- `L` (`index.html:1490`): `const L = (hr, en, hu) => spLang() === "hr" ? hr : spLang() === "hu" ? (hu ?? en) : en;`

- [ ] **Step 4: `pickVoice` és a beállítások**

- `pickVoice()` (`index.html:1482`): `voiceLang === "hu"` esetén az első `isHu` hang; ha nincs ilyen, a mai visszaesés (angol), hogy ne legyen csend.
- Markup (`index.html:589`): `<option value="hu">Magyar</option>` az `en` után.
- `fillVoices()` (`index.html:1522`): a hanglista csoportosítása `hr`, `en`, `hu`, majd a többi; a `#voice-note` szövege magyar esetben is nevezze meg a nyelvet (a UI nyelve horvát/angol, tehát a meglévő `ui(hr, en)` úton), és ha magyar hang nincs, a magyar hang telepítésének útját írja (Android: *Text-to-speech → Speech Services by Google → Install voice data → Hungarian*).
- `say()` figyelmeztetése (`index.html:1512`): a horvát mellett a magyar hiányára is figyelmeztessen egyszer (`say.warned`).

- [ ] **Step 5: Magyar ágak a szám-segédekben**

Ugyanazok a függvények, magyar ággal — a horvát és angol ág **változatlan**:
- `watts(n)`: `250 watt` (szám után nincs többes jel).
- `sayDur(sec)`: `3 perc 20 másodperc`; ha csak perc vagy csak másodperc van, csak azt mondja.
- `cadSay([lo, hi])`: `kadencia 90 és 100 között`, illetve `kadencia 90 vagy több`.
- `segSpeechPower(sg)`: szabadon `3 perc szabadon`, pulzusoson `3 perc 145-es pulzuson`, teljesítményen `3 perc 250 watton` / `3 perc, 200-tól 250 watton`.
- `segSpeech(sg)`: a megjegyzés (`sg.note`) magyar változata, utána a teljesítmény és a kadencia, ugyanabban a mondatban.
- A megjegyzés-térkép: a `NOTE_EN` mintájára egy `NOTE_HU` a hét meglévő megjegyzésre („Visoka kadenca, mirno sjedi" → „Magas kadencia, maradj ülve", stb.).

- [ ] **Step 6: Magyar szöveg mind a 19 `L()` helyen és az erősítés-játékban**

Minden bemondás kap harmadik argumentumot, a horvát és angol szöveg **betű szerinti** megőrzésével:
- edzés kezdete (`Kreće trening.` → `Kezdődik az edzés.`), 10 másodperces előrejelzés (`Za 10 sekundi:` → `10 másodperc múlva:`),
- részidő-összegzések (kadencia-átlag, km, intervallum-eredmény, pulzusos intervallum),
- edzés vége / célba érés (`Stigao si na cilj.` / `Trening je gotov. Bravo.`),
- a hang-teszt minta mondata,
- az erősítés-játék (`spoken()`, `Odmor. Sljedeće: …`, `…, N sekundi.`, `Trening je gotov. Bravo.`).

- [ ] **Step 7: Futtasd a teszteket**

Run: `node --no-warnings tests/unit.js && node tests/e2e.js`
Expected: PASS — a két új e2e ✓, a meglévő `voice: everything English…` és a horvát erősítés-teszt változatlanul ✓, `0 failed`.

- [ ] **Step 8: README**

A *Voice* szakasz (`README.md`) kap egy mondatot: magyar bemondásokhoz magyar TTS-hang kell; a nyelvet a *Settings → Announcement language* állítja; `auto` soha nem választ magyart.

- [ ] **Step 9: Commit**

```bash
git add index.html tests/e2e.js README.md
git commit -m "Hungarian spoken announcements, chosen in Settings"
```

---

## Kézi ellenőrzés a végén

1. `npm run dev`, *Postavke → Jezik najava → Magyar*, *Glas za najave*-nél egy magyar hang.
2. Intervallumos edzés indítása: az első bemondás magyarul szól, a számok helyes alakban („3 perc 250 watton").
3. `Magyar` beállítás mellett vedd ki a magyar hangot (vagy egy másik gépen): a beállítások figyelmeztetnek, a bemondás angol.
4. Váltsd vissza horvátra/angolra: minden a régiként szól.
