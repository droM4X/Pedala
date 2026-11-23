# Telefonos fokozat-távirányító

2026-11-23

## Miért

A Zwift Click podok hardveresen megbízhatatlanok: nagyjából egy perc után alvó módba
mennek és utána nem kapcsolódnak vissza. A podok egyetlen feladata a váltás, ezért a
telefon veszi át: a telefonon egy lap két nagy gombbal, ami a futó Pedala-példányhoz
kapcsolódik a helyi hálózaton. A telefon nem párosítódik a trenažerhez (a Bluetooth a
másik gépen van), csak parancsot küld.

## Célok

- `gear.html` a telefonon: + és − gomb, kapcsolatjelző pötty, az aktuális fokozat kirajzolva.
- A gombok pontosan azt teszik, amit a podok ma: `bump(±1)`. Szabad tekercselésen/útvonalon
  fokozat, ERG edzésen intenzitás, pulzusos edzésen HR-eltolás.
- A telefon elaludhat. Felébredéskor magától újracsatlakozik, és a pötty csak akkor zöld,
  ha a kapcsolat tényleg él (szívverés-alapú, nem optimista).
- A fő app fejlécében, a `Click +` / `Click −` mellett ötödik pill (`Remote`), ami zöld, ha
  van csatlakozott telefon; kattintásra megmutatja azt a címet, amit a telefonon be kell írni.
- Ha nincs futó példány: a telefon piros pöttyöt és „No ride running" szöveget mutat,
  a gombok nem aktívak.

## Nem célok

- Nem működik Vercelre telepítve: a szerveroldali állapot megosztott memória, a serverless
  nem tudja. Ott a lap becsületesen azt mondja, hogy nincs kapcsolat. Ez elfogadott, mert a
  használat helye a helyi gép (`run dev`).
- Nincs hitelesítés a távirányítón (a helyi szerveren ma sincs semmi). Nem cél a többszemélyes
  szeparáció, a jelenlét-kezelés és a telefonos start/pauza sem.
- Nincs QR-kód (kézi címbeírás egyszer, utána megjegyzi).

## Megkötések

- Nincs új dependency: a repó szándékosan függőségmentes a futtatáshoz, és a Node-nak nincs
  beépített WebSocket szervere.
- `http://192.168.x.x:8765` nem secure context, tehát wake lock és app-telepítés nincs.
  Nem baj: a telefon elaludhat, a visszacsatlakozás a követelmény.
- A lapot ugyanaz a szerver szolgálja ki, amire kapcsolódik, ezért alapból nincs szükség
  cím megadására (a `location.origin` a cím). A mező csak akkor kell, ha a lapot máshonnan
  nyitják meg (pl. a Vercel-deploy-ról a home szerverre mutatva).

## Megközelítések

- **A) WebSocket** (`/ws`, mindkét oldal csatlakozik, a szerver továbbít). Szabványos és
  kétirányú, de a Node-hoz `ws` dependency vagy ~80–120 sor kézzel írt handshake + frame
  parszer kell. A nyereség a helyi hálózaton mérhetetlen.
- **B) SSE lefelé + POST felfelé** (választott). A telefon `POST /__remote/shift`-tel küld,
  mindkét oldal egy `EventSource`-on kap állapotot és szívverést. Nulla dependency, ~40 sor,
  az `EventSource` magától újracsatlakozik, a pötty őszinte, mert a csatorna valódi kapcsolat.
  Ára: két mechanizmus egy helyett.
- **C) Rövid pollozás** (300 ms). A legbutább, Vercelen is elindulna, de késik, állandó
  forgalom, és a pötty csak tipp.

**B nyert**, mert a WebSocket itt nem ad semmit, a kockázata viszont valódi, a pollozás pedig
rosszabb élmény ugyanazért a nulláról induló munkáért.

## Hogyan épül fel

**`lib/remote.js`** — új, önálló modul, mint a `lib/session.js`. `createRemote()` ad vissza egy
`route(req, res)`-t, amit a `tests/support/server.js` a statikus kiszolgálás elé köt be. A
modul a mély rész: minden állapot és protokoll itt van, a szerver csak beköt.

Állapot a memóriában: `{ gear, mode, bias, hrOff, rideClients, phoneClients }`.

- `GET /__remote/events?role=ride|phone` — SSE csatorna. `role=ride` kapja a `shift`
  eseményeket (`{d:±1}`) és a telefonok számát; `role=phone` kapja a fokozatot, a módot és
  azt, hogy van-e futó edzés. Szívverés 10 másodpercenként (`: ping`).
- `POST /__remote/shift` `{d:1|-1}` — telefontól. Nem alkalmaz semmit, csak továbbítja a
  ride oldalnak; a fokozatot a ride oldal fogja alkalmazni, és visszaküldi.
- `POST /__remote/state` `{gear,mode,bias,hrOff}` — a ride oldaltól, minden `bump()` után és
  2 másodpercenként. Ez a telefon kijelzőjének egyetlen igazságforrása.
- CORS `*` a `/__remote/*`-ra, hogy a lap máshonnan megnyitva is elérje a szervert.

**`index.html`**

- Initkor, feltétel nélkül megnyit egy `EventSource`-t `role=ride`-dal: a „futó példány"
  jelentése „az app nyitva van", nem „edzés van folyamatban". `shift` eseményre `bump(d)`.
- A `render()`-be bekerül a `POST /__remote/state`, és a válasz `phones` száma alapján a
  `#chip-remote` pöttye zöld/piros.
- A chip kattintásra `toast`-ban kiírja a `http://<LAN-IP>:<port>/gear.html` címet. A LAN-IP-t
  a szerver adja (a `state` eseményben, `os.networkInterfaces()`-ből), mert a böngésző nem
  tudja megbízhatóan a gép saját hálózati címét, ha `localhost`-ról nyitották meg.
- A chip felirata `Remote`, a pötty ugyanaz a mechanizmus, mint a többi chipnél (`setChip`).

**`gear.html`** — önálló, saját CSS, angol felirattal (a fő app nyelvváltóját nem követi, és
nem is függ tőle; horvát nem kell bele). Nagy + / − gomb, közte a fokozat; a gombok alatt
semmi, hogy hüvelykujjal elérhető legyen. Kapcsolat nélkül címmező (`localStorage`-ból
előtöltve, alapból `location.origin`) és „Connect" gomb.

Állapotgépe: `nincs cím` → `connecting` → `live` (zöld) / `no ride running` (piros, gombok
tiltva). A pötty akkor zöld, ha az SSE nyitva van és az utolsó szívverés 25 másodpercnél
fiatalabb; különben piros és újrapróbál (EventSource automatikus, plusz 3 másodperces
watchdog a félig nyitott kapcsolatokra).

A gombok `POST /__remote/shift`-et küldenek; nem várnak visszaigazolásra, a fokozat a
következő `state` eseményben jön vissza (pár ms).

## Tesztek

- `tests/unit.js`: a `createRemote()`-ot egy csupasz szerverre kötve — SSE nyitás, `POST shift`
  → a ride csatornán megjön a `shift`; `POST state` → a phone csatornán megjön a fokozat;
  szívverés megérkezik; CORS fejléc; a telefonok száma megjelenik a ride oldalon; bontás után
  a szám nullázódik.
- `tests/e2e.js`: az edzés-oldal mellett egy második kontextusban megnyitott `gear.html`; a +
  gombra `__pedala.S.gear` eggyel nő, a `#chip-remote` zöld; a telefon kontextusának bezárása
  után a chip pirosra vált.

## Ami a builderre marad

- A CSS, a gombméretek, a pötty színei (a meglévő `.chip .dot` stílus újrahasználva vagy
  saját, a lap független).
- Hogy a `state` POST-ot a `render()` hívja-e vagy külön időzítő — bármelyik, amíg minden
  `bump()` után elmegy egy.
- A watchdog pontos küszöbei.
