# Magyar beszéd a bemondásokhoz

2026-11-23

## Miért

A hangos bemondások („Za 10 sekundi: 3 minute na 265 vata…") ma horvátul vagy angolul
szólnak. A tulajdonos magyar, magyar hang van az eszközén, de a felület nyelve maradjon
HR/EN — csak a **bemondások** kapjanak magyar változatot.

## Célok

- A *Beállítások → Jezik najava* legördülő kap egy **Magyar** opciót. Csak kézzel
  választható (az `auto` továbbra is csak horvát/angol között dönt).
- Magyar beállításnál **minden** kimondott mondat magyarul szól: edzés közbeni
  intervallum-bemondások, szünet, edzés vége, részidő-összegzés, kadencia-átlag, erősítés
  játék, és a *Hang kipróbálása* gomb.
- Magyar számnevek helyesen: a szám után nincs többes jel („3 perc", „250 watt",
  „12 kilométer"), a horvát `plural()` szabályai nem érvényesek rá.
- Ha az eszközön nincs magyar hang, a beállítás oldalán megjelenik egy útmutató (mint a
  horvátnál), és a beszéd angolra esik vissza — nem hallgat el csendben.
- A felület nyelve, a képernyős értesítések (`notify`) és a fordítási rendszer (`tr`, `ui`,
  `EN` szótár) **változatlan**.

## Nem célok

- Magyar felület. A UI marad horvát forrás + EN szótár.
- `auto` alapján magyar nyelv kiválasztása (a döntés: csak kézzel).
- A képernyős szövegek magyarítása.
- Magyar többes szám kezelése (nem kell: a szám után nincs többes jel).

## Megkötések

- Nincs új dependency, nincs build lépés; minden `index.html`-ben.
- A beszédnyelv továbbra is **egy** nyelv egy mondaton belül: nincs kevert horvát–magyar.
- A bemondás-szövegek forrása ma három helyen él, és mindhármat bővíteni kell:
  1. a `L(horvát, angol)` párok a bemondásokban (19 hely),
  2. a számláló segédfüggvények (`watts`, `sayDur`, `cadSay`, `segSpeechPower`),
  3. a megjegyzés-térkép (`NOTE_EN`) és az erősítés-játék `spoken()` függvénye.
- A beállítás (`settings.voiceLang`) már szinkronizálódik eszközök között; a `hu` érték ezt
  nem törheti.

## Megközelítések

- **A) Harmadik argumentum a `L()`-ben (választott).** `L(horvát, angol, magyar)`; a
  `spLang()` három értéket ad (`hr`/`en`/`hu`), a segédfüggvények `if`-fel ágaznak a magyar
  szórend kedvéért. Illeszkedik a meglévő stílushoz, minden érintett hely amúgy is kézben
  van. Ára: a `L()` hívások három argumentumúvá válnak.
- **B) Külön bemondás-szótár** `{ hr: {...}, en: {...}, hu: {...} }` kulcsokkal. Szebben
  elkülöníti a szöveget a logikától, de új mechanizmus, és a dinamikus mondatokban
  (számok, szórend) így is kód kell — ugyanannyi helyet érint, több új fogalmat hoz.
- **C) A meglévő UI-szótárra bízni** (horvát forrás + magyar térkép). Nem működik: a
  bemondások számokat fűznek mondatba, és a magyar szórend más („3 perc alatt 250
  watton"), amit kulcs–érték pár nem tud összerakni.

**A nyert**, mert a legkisebb új fogalom, és a beszéd szórendje kódban is jól olvasható.

## Hogyan épül fel

### Nyelvfelismerés és szövegválasztás (`index.html`, a voice szakasz)
- `isHu(v)` a `isHr`/`isEn` mintájára; `spLang()` → `"hr" | "en" | "hu"`.
- `L(hr, en, hu)` → a beszélt nyelv szerint; ha a magyar hiányzik, angolra esik vissza
  (védőháló, a cél a teljes fordítás).

### Számok

Ugyanazok a függvények, magyar ággal:
- `watts(n)`: `250 watt`
- `sayDur(sec)`: `3 perc 20 másodperc`
- `cadSay([lo, hi])`: `kadencia 90 és 100 között`, illetve `kadencia 90 vagy több`
- a részidős km-mondat: `12 kilométer`

### Bemondások

Mind a 19 `L()` hely és a `spoken()`/`NOTE_EN` megjegyzések harmadik
argumentumot kapnak.

### Hang kiválasztása
- `pickVoice()`: `voiceLang === "hu"` esetén az első `isHu` hang; ha nincs, a mai
  viselkedés szerinti visszaesés.
- `fillVoices()`: a hanglistában külön csoport a magyar; a *Jezik najava* legördülőben
  `hu` → „Magyar"; a meglévő figyelmeztető sor megmondja, melyik nyelven szólnak a
  bemondások, és ha magyar hang nincs, a magyar hang telepítésének útját (Android:
  *Text-to-speech → Speech Services by Google → Install voice data → Hungarian*).
- `say()` figyelmeztetése (`say.warned`) magyar esetre is kiterjed.

### Dokumentáció

A `README.md` *Voice* szakasza egy mondattal: magyar bemondásokhoz
magyar TTS-hang kell, a nyelvet a *Settings → Announcement language* állítja.

## Tesztek

- e2e: magyar hang (`hu-HU`) + `voiceLang: "hu"` → a *Hang kipróbálása* gomb magyar
  mondatot mond (a teszt harness már injektál hangokat és rögzíti a kimondott szöveget);
  edzés indítása után az első bemondás magyar.
- e2e: magyar beállítás, de csak angol hang az eszközön → a figyelmeztető sor megjelenik,
  és a beszéd angol (nem néma).
- e2e: horvát és angol beállítás mellett a bemondások változatlanok (regresszió).

## Ami a builderre marad

- A magyar megfogalmazások pontos szövege (a fenti példák irányadók, nem kötelezőek).
- Hogy a `fillVoices` hogyan csoportosítja a nem hr/en/hu hangokat.
- A figyelmeztető szöveg pontos megfogalmazása (horvát forrás + EN szótár, mert a UI
  nyelve az).
