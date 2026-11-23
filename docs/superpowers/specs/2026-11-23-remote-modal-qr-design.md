# Remote modal QR-kóddal

2026-11-23

## Miért

A `Remote` chipre kattintva ma egy `toast` villan fel a képernyő alján a telefonos címmel, és
eltűnik. Telefonon beírni egy hosszú `http://192.168.x.y:8765/gear.html` címet lassú és hibára
hajlamos, és a toast 2,6 mp-e alatt leolvasni sem lehet.

Helyette középen egy modal: felül a QR-kód (telefonnal beolvasható), alatta a link, jobb felül X.

## Célok

- A `Remote` chipre kattintva modal nyílik (`<dialog>`, a meglévő `dialog` + `::backdrop` stílussal),
  jobb felső sarkában X gombbal, ami zárja.
- A modalban felül a QR-kód (a `gear.html` LAN-címe), alatta a link szövege és egy Copy gomb.
- A QR kép a böngészőben készül, saját kódolóval: nincs hálózat, nincs harmadik fél, offline is megy.
- Ha nincs LAN-cím (a `lanLinks` üres: `localhost`-ról nyitva, vagy Vercel-re telepítve), a modal a
  QR helyett egy magyarázó sort mutat, a link nélkül.
- A chip kattintása továbbra is újraindítja az `EventSource`-ot, ha az halott (a mai viselkedés
  megmarad), és utána nyitja a modalt.

## Nem célok

- Nem lesz QR a telefonos `gear.html`-en (ott nem kell).
- Nem lesz megosztható/linkrövidítő, nem kerül semmi a vágólapra automatikusan (a Copy gomb explicit).
- Nem támogatunk QR verziót 10 felett: a payload (max ~60 karakter, `http://<hoszt>:<port>/gear.html`)
  verzió 3–4 byte módban, a tartalék bőven elég.

## Megkötések

- **Nincs új futtatási dependency.** A kódoló saját, ~250 sor, `qr.js` a repó gyökerében,
  `<script src="/qr.js"></script>` a fő script előtt, `window.QR`-t tesz elérhetővé.
- A teszt-oldali dekóder (`jsqr`) dev-eszköz, `npm i --no-save jsqr`, ugyanúgy, ahogy a Playwright.
- A fájl `module.exports`-ot is ad, hogy node-ból tesztelhető legyen (mint a `lib/*.js`).
- A `gear.html` és a relay érintetlen.

## Megközelítések

- **Külső QR-kép szolgáltatás** (`api.qrserver.com`): egy `<img>`, nulla kód, de internet kell hozzá,
  a helyi hálózat címét kiadja egy harmadik félnek, és offline nem működik. Egy önmagát hosztoló,
  privát appnál rossz csere — elvetve.
- **Saját kódoló (választott):** byte mód, Reed–Solomon ECC, maszkválasztás a szabvány 4
  büntetőfeltétele szerint, format info. ~250 sor, offline, privát. Ára: karbantartandó kód, amit
  round-trip teszttel kell bizonyítani.
- **Csak link, QR nélkül:** a legkevesebb munka, de pont azt a kézi beírást hagyja meg, amit a QR
  kiváltana.

**Saját kódoló nyert**, mert a repó elve a „nincs dependency, minden helyben", és mert a LAN-cím
harmadik félhez küldése nem indokolható egy olyan appban, aminek a fő ígérete a privacy.

## Hogyan épül fel

**`qr.js`** (új, gyökér): `QR.encode(text, { ecc = "M" })` → `{ size, modules: boolean[][] }`,
plusz `QR.svg(matrix, { margin = 4 })` → SVG string (a modalba `<img>`-ként vagy inline SVG-ként).
Verziók 1–10, byte mód (a `gear.html` link ASCII), ECC szint M, automatikus verzióválasztás a
hossz alapján. Kívülről csak ez a két függvény kell.

**`index.html`**:
- Új `<dialog id="dlg-remote">` a többi dialog mellett: X gomb (`✕`, `aria-label`), QR helye
  (`#qr-box`), a link (`#remote-link`), Copy gomb, és egy magyarázó sor arra az esetre, ha nincs cím.
- A `#chip-remote` `onclick`-je a `toast` helyett a modalt nyitja, és csak akkor rajzol QR-t, ha van
  link; a címet a `remote.links[0]` adja (a szerver `hello` eseménye), tehát a modal a chip
  kattintásakor az aktuális címet mutatja.
- Az X és a Copy gomb a meglévő mintát követi (`data-close`, illetve `navigator.clipboard`).

**`tests/unit.js`**: round-trip — `QR.encode("http://192.168.0.20:8765/gear.html")` → a mátrixból
RGBA pixelbuffer (4 modul csendes zónával) → `jsqr` dekóder → a kapott szöveg egyezik. Plusz: méret
a verzióhoz, és hogy a csendes zóna megvan.

**`tests/e2e.js`**: a chipre kattintva megnyílik a `#dlg-remote`, van benne QR (nem üres SVG), a
link szövege a szerver címe + `/gear.html`, az X zárja; `localhost`-ról nyitva (a `lanLinks` üres)
a modal a magyarázó sort mutatja QR nélkül.

## Ami a builderre marad

- A modal pontos elrendezése (a QR mérete, a link tördelése, a Copy gomb helye), a meglévő
  `dialog` stílushoz igazítva.
- Az X gomb pontos stílusa (a repóban még nincs X-minta).
- Hogy a QR inline SVG vagy `<img src="data:image/svg+xml,...">` legyen.
- Az ECC szint (M a javaslat; L kisebb kódot ad, Q nagyobb robusztusságot).
