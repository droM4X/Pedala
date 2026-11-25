# Ovl-adatok, remote-vezérlés és engedélyező kapcsolók

2026-11-25

## Miért

- **Teljes képernyőn, videós edzés közben** a legalsó adatsáv (`ovl`) utolsó doboza kettős szerepű:
  útvonalas fuvarnál távolságot mutat, egyébként sebességet — így útvonalnál a pillanatnyi sebesség
  egyáltalán nem látszik, csak a kis dashboard-statisztikában, ami ilyenkor nincs a képernyőn.
- **A telefonos remote** (`gear.html`) ma csak fokozatot vált. Start/pauza/finish a tableten kell
  hogy menjen, pedálozás közben nem kell a képernyőhöz nyúlni.
- **A Click és a pulsmeter nem mindenkinek van.** A felső chipsorban mégis ott a két `Click +/−`
  és a `Puls` gomb, a beállításokban pedig hosszú, csak ezen eszközöket érintő szöveg — akinek
  nincs ilyen eszköze, az számára csak zaj.

## Célok

### 1. Ovl: külön távolság- és sebességdoboz

Új sorrend a teljes képernyős sávban:

```
Teljesítmény · Intervallum · Távolság · Kadencia · Pulzus · Áttétel · Idő · Sebesség
```

- A **Távolság külön doboz**, a kadencia elé kerül; **csak útvonalas fuvarnál** látszik.
- A **Sebesség külön doboz a sor végén, mindig látszik** (`km/h`), útvonaltól függetlenül.
- A mai kettős célú utolsó doboz (`#o-x`) megszűnik; helyette a két új doboz.

### 2. Remote: Start/Befejezés

A `gear.html` pados alá egy új, kisebb gombsor:

```
[  +  ]  [  −  ]        ← fokozat (a mai)
[ Start ] [ Befejezés ]  ← új sor, kisebb gombok
```

- **Start**: pontosan a főoldali `#btn-start` viselkedése — indulítja az edzést, futó edzésnél
  pauzál, automatikus pauzából folytat. Futó edzésnél a felirata **Pauza**.
- **Befejezés**: a telefonon modális megerősítés ("Biztosan lezárod az edzést?" + Igen/Mégse);
  Igen esetén a főoldal ugyanúgy fejezi be, mint a saját finish-gombja (összesítő modal nyílik).
- A telefon az edzés állapotát a `state` esemény kibővítéséből tudja: **`started`** és **`running`**.
  A főoldal `remoteState()`-je ezeket is küldi, és `remoteSend()` hívás indul start/pauza/
  folytatás/befejezés alkalmából is.
- Ha nincs futó ride-oldal (`ride === false`): mindkét gomb letiltva, mint ma a +/−.

### 3. Zwift Click: engedélyező kapcsoló

- A beállítások Zwift Click szekciója kap egy **pipálós Engedélyezés mezőt, alapból nincs bepipálva**
  (`settings.clickOn`, default `false`).
- Nincs engedélyezve → a felső **`Click +` és `Click −` chip gombok nem látszanak**, és az
  **automatikus újracsatlakozás kihagyja a Click-eszközöket**.
- A szekció többi része (hosszú csatlakoztatási súgó, `Odredi + i − dio` gombok, csomagnapló)
  **csak engedélyezve** látszik.

### 4. Heart Rate: engedélyező kapcsoló

- Új **Puls szekció a beállításokban**, két mondatnyi leírással (mi a pulsmeter, hogyan csatlakozik,
  mire jó: pulzusra vezérelt edzések és pulcuszónák) + **pipálós Engedélyezés, alapból ki**
  (`settings.hrOn`, default `false`).
- Nincs engedélyezve → nem látszik:
  - a felső **`Puls` chip gomb**,
  - a dashboard **HR-statisztika doboza**,
  - az ovl **pulzus-dobozza**,
  - a workout-választó **„Po pulsu" (pulzus-alapú) kategóriája**.

### 5. Beállítások sorrendje

A **Puls** és a **Zwift Click** szekció az **intervals.icu szekció elé** kerül:

```
[ űrlap: nyelv, FTP, súly, lánckorong, Cog, max puls, YouTube kulcs, jelzés, hang … ]
Puls · Zwift Click · intervals.icu · Virtuális edző · Szinkron · Prijava · Brzine ·
Automatsko spajanje · Tipkovnica
```

(A `Brzine` és `Automatsko spajanje` szekciókban ma a Click/Cog és a pulsmeter említése marad
ahol van — a chip-ek rejtése a lényeg, nem a szövegek átírása.)

## Nem célok

- **Nem bántjuk a remote HR-offset módját** — pulzus-alapú edzésnél marad, ahogy van.
- **Nem rejtjük el** a `max pulsus` mezőt, a zónák magyarázatát és az összesítő pulcuszóna-időit:
  számítások és előzmények, nem élő kijelzés.
- **Nincs új hangbejelentés**, a magyar (HU) hang-felület nem változik.
- **A relay buta marad**: nem tud semmit az edzés logikájáról, csak továbbít (`control` esemény);
  a döntés (mit jelent a start/pauza/finish) a ride-oldalon marad.
- **Nem tervezünk redesignot** a `gear.html`-en — csak az új gombsor és a megerősítő modal.

## Megkötések

- **Nincs új futtatási dependency.** Minden a meglévő mintákkal: settings-checkboxok a
  `settings-form`-ban (`label.full.check`), a `settings` objektum a `store`-on keresztül,
  feliratok a `ui(hr, en)` / `tr()` fordítási úton (horvát alap + angol).
- **A relay protokoll bővítése** (`lib/remote.js`):
  - `POST /__remote/control` `{ a: "start" | "pause" | "finish" }` → `control` esemény a ride-oldalnak
    (ellenőrzött action-értékekkel, mint a `shift`-nél),
  - a `state` esemény payloadja + a `/__remote/state` POST bővül: `started`, `running`,
  - a meglévő `shift` / `state` / `hello` szerződés változatlan marad (a régi `gear.html` is menne).
- A megerősítő modal a `gear.html`-en natív `<dialog>` elem, a lap saját stílusával.
- **Tesztek a meglévő minta szerint**: `tests/unit.js` (relay: `control`-továbbítás és érvényesítés,
  state-bővítés), `tests/e2e.js` (remote Start/Pauza/Befejezés + megerősítő modal; Click/HR chip-ek
  és a „Po pulsu" kategória rejtése/észlelése a kapcsoló szerint).
- Érintett fájlok: `index.html`, `gear.html`, `lib/remote.js`, `tests/unit.js`, `tests/e2e.js`,
  `README.md`. Az `api/*`, `middleware.js`, `lib/session.js` érintetlen.

## Megközelítések

- **Ovl dobozok**: (A) egy kettős célú doboz áthelyezése — elvetve, mert egyszerre mindkét adat
  nem fér bele és útvonalnál a sebesség így is hiányozna; (B) **két külön doboz** — ez megy.
- **Remote vezérlés**: (A) a ride-logika a relay-ba másolása — elvetve, a relay szerverless és
  állapotmentes kell hogy maradjon; (B) **buta `control` esemény + a ride-oldal meglévő
  `start`/`pause`/`resume`/`finishWorkout` hívásai** — ez megy.
- **Kapcsolók**: a settings-form meglévő checkbox-mintáját követjük; a chip/box/kategória
  rejtés egy-egy `render`-beli feltétel (`settings.clickOn` / `settings.hrOn`), nem külön nézet.

## Eldöntött részletek

- Alapértelmezések: **`clickOn: false`, `hrOn: false`** — a frissítés után a már Clicket/
  pulsmetert használóknak egyszer be kell pipálniuk. (Elfogadott következmény.)
- A `b-hr60` / `b-hr90` edzések adata nem változik, csak a választóban való láthatóságuk
  függ a kapcsolótól; importált, pulzus-célú workoutnál a ride-oldal viselkedése változatlan.
- A remote `Start` gomb pontosan a `#btn-start` logikáját hívja meg közvetetten a `control`
  esemény handleréből (start → pauza → folytatás), így az oldal- és telefon-irányítás nem
  tud szétcsúszni.
- A remote **Befejezés pontosan a `#btn-end` útja**: `pause(false)` + `openSummary()` — nem a
  `finishWorkout()` (az az edzés/útvonal természetes vége, hanggal és jelzéssel).
- **Nyitott összesítő modal alatt** a telefon `Start`ja az összesítő `Nastavi voziti`
  gombjával egyezik: bezárja a modalt és folytatja az edzést; `Befejezés` ilyenkor nem
  csinál semmit (az edzés már le van zárva).
- **`clickOn` / `hrOn` nem szinkronizál** az eszközök között (a `clickMap` mintájára kizárjuk
  a szinkronból): az eszköz-hozzáférés (Click, pulsmeter párosítás) eleve eszközönkénti.

## A builderre hagyva

- Az új gombsor és a megerősítő modal pontos CSS-e a `gear.html`-ben.
- A Puls-szekció két mondatának pontos szövege (hr + en), és a Zwift Click engedélyező soré.
- A `state`-bővítés pontos wiringje (`remoteState()`, `remoteSend()` hívási pontok start/pauza/
  finish alkalmából) és az ovl-újrarendezés HTML/CSS-részletei (szűk képernyős `.ovl` szabályok,
  ahol ma a `#o-iv-next` és a `#o-gear-box small` rejtése van).
- A tesztek pontos esetei a fent megfogalmazottakon belül.
