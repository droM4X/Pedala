Hungarian spoken-announcement work removed from the English-only fork; reference for a future voice plugin

## Hungarian cycling-note translations

Source: `index.html:1509–1510`

```js
const NOTE_HU = { "Visoka kadenca, mirno sjedi": "Magas kadencia, maradj ülve", "Visoka kadenca": "Magas kadencia", "Niska kadenca": "Alacsony kadencia",
  "Niska kadenca, teški gaz": "Alacsony kadencia, nehéz fokozat", "Samo lijeva noga": "Csak a bal láb", "Samo desna noga": "Csak a jobb láb", "Obje noge": "Mindkét láb" };
```

## Hungarian suffix harmony

Source: `index.html:1522–1527`

```js
// Hungarian suffix harmony follows the final spoken word of the number.
function huSuffix(n){
  const units = ["as", "es", "es", "as", "es", "ös", "os", "es", "as", "es"];
  const tens = { 1: "es", 2: "as", 3: "as", 4: "es", 5: "es", 6: "as", 7: "es", 8: "as", 9: "es", 10: "as" };
  return n % 10 ? units[n % 10] : tens[n === 100 ? 10 : n % 100 / 10] || "as";
}
```

## Hungarian duration branches

Source: `index.html:1511–1516`

```js
function sayDur(sec){
  sec = Math.round(sec); const m = Math.floor(sec / 60), x = sec % 60, hr = spLang() === "hr", hu = spLang() === "hu";
  const mm = m ? (hr ? `${m} ${plural(m, "minuta", "minute", "minuta")}` : hu ? `${m} perc` : `${m} ${m === 1 ? "minute" : "minutes"}`) : "";
  const ss = x ? (hr ? `${x} ${plural(x, "sekunda", "sekunde", "sekundi")}` : hu ? `${x} másodperc` : `${x} ${x === 1 ? "second" : "seconds"}`) : "";
  return [mm, ss].filter(Boolean).join(hr ? " i " : hu ? " " : " and ");
}
```

## Hungarian voice selection

Source: `index.html:1491–1505`

```js
const isHr = v => /^hr([-_]|$)/i.test(v?.lang || ""), isEn = v => /^en([-_]|$)/i.test(v?.lang || ""), isHu = v => /^hu([-_]|$)/i.test(v?.lang || "");
const voices = () => window.speechSynthesis?.getVoices() || [];
let hrVoice = null;   // the voice in use (name kept from when it could only be Croatian)
/* voice and language: a voice picked by hand wins; otherwise Croatian if asked for (or "auto" with a Croatian interface) and available, else English */
function pickVoice(){
  const vs = voices(), want = settings.voiceLang || "auto", byName = vs.find(v => v.voiceURI === settings.voiceName);
  if(byName && (want !== "hu" || isHu(byName))) return byName;
  if(want === "hu") return vs.find(isHu) || vs.find(isEn) || null;
  if(byName) return byName;
  const hr = vs.find(isHr);
  if((want === "hr" || want === "auto" && UI === "hr") && hr) return hr;
  return vs.find(v => isEn(v) && /GB|US/i.test(v.lang) && v.localService) || vs.find(isEn) || null;
}
const spLang = () => isHu(hrVoice || pickVoice()) ? "hu" : isHr(hrVoice || pickVoice()) ? "hr" : "en";
const L = (hr, en, hu) => spLang() === "hr" ? hr : spLang() === "hu" ? (hu ?? en) : en;
```

## Hungarian settings fallback note

Source: `index.html:1555`

```js
    : !hu.length && settings.voiceLang === "hu" ? ui("Nema mađarskog glasa; najave su na engleskom. Instaliraj: Postavke → Opće upravljanje → Jezik → Pretvaranje teksta u govor → Speech Services by Google → Instaliraj glasovne podatke → Mađarski.", "Hungarian voice missing; announcements fall back to English. Android: Text-to-speech → Speech Services by Google → Install voice data → Hungarian.")
```

## Hungarian lap sentence

Source: `index.html:1476–1478`

```js
    say(() => L(`${km} ${plural(km, "kilometar", "kilometra", "kilometara")}. Zadnjih ${LAP_KM} za ${sayDur(lap.dur)}, prosjek ${watts(lap.avgP)}.`,
      `${km} kilometers. Last ${LAP_KM} in ${sayDur(lap.dur)}, average ${watts(lap.avgP)}.`,
      `${km} kilométer. Az utolsó ${LAP_KM} kilométer ${sayDur(lap.dur)} alatt, átlag ${watts(lap.avgP)}.`));
```

## Hungarian arguments at all L() call sites

Sources: `index.html:1449, 1453, 1469, 1476–1478, 1482–1483, 1506, 1517, 1519, 1530–1533, 1658, 1957, 2919, 2926–2927, 2947`

`index.html:1449`

```js
      if(c.i === 0 && S.t <= 1) say(() => `${L("Kreće trening.", "Workout starting.", "Kezdődik az edzés.")} ${segSpeech(c.s)}.`);
```

`index.html:1453`

```js
    if(nx && Math.round(c.left) === 10 && c.s.d >= 20) say(() => `${L("Za 10 sekundi:", "In 10 seconds:", "10 másodperc múlva:")} ${segSpeech(nx)}.`);
```

`index.html:1469`

```js
      say(() => L(`Prosječna kadenca ${lap.avgCad}.`, `Average cadence ${lap.avgCad}.`, `Átlagos kadencia ${lap.avgCad}.`));
```

`index.html:1476–1478`

```js
    say(() => L(`${km} ${plural(km, "kilometar", "kilometra", "kilometara")}. Zadnjih ${LAP_KM} za ${sayDur(lap.dur)}, prosjek ${watts(lap.avgP)}.`,
      `${km} kilometers. Last ${LAP_KM} in ${sayDur(lap.dur)}, average ${watts(lap.avgP)}.`,
      `${km} kilométer. Az utolsó ${LAP_KM} kilométer ${sayDur(lap.dur)} alatt, átlag ${watts(lap.avgP)}.`));
```

`index.html:1482–1483`

```js
    say(() => lap.kind === "hr" ? L(`Interval gotov. Prosječni puls ${lap.avgHr}.`, `Interval done. Average heart rate ${lap.avgHr}.`, `Intervallum kész. Átlagpulzus ${lap.avgHr}.`)
      : L(`Interval gotov. Prosjek ${watts(lap.avgP)}, ${lap.score} posto.`, `Interval done. Average ${watts(lap.avgP)}, ${lap.score} percent.`, `Intervallum kész. Átlag ${watts(lap.avgP)}, ${lap.score} százalék.`));
```

`index.html:1506`

```js
const watts = n => L(`${n} ${plural(n, "vat", "vata", "vata")}`, `${n} ${n === 1 ? "watt" : "watts"}`, `${n} watt`);
```

`index.html:1517`

```js
const cadSay = ([lo, hi]) => hi >= CAD_ANY ? L(`kadenca ${lo} i više`, `cadence ${lo} or more`, `kadencia ${lo} vagy több`) : L(`kadenca ${lo} do ${hi}`, `cadence ${lo} to ${hi}`, `kadencia ${lo} és ${hi} között`);
```

`index.html:1519`

```js
  const note = sg.note ? L(sg.note, NOTE_EN[sg.note] || sg.note, NOTE_HU[sg.note] || sg.note) + ". " : "", cad = sg.cad ? ", " + cadSay(sg.cad) : "";
```

`index.html:1530–1533`

```js
function segSpeechPower(sg){
  const w = S.workout, d = sayDur(sg.d);
  if(sg.free) return L(`${d} slobodno`, `${d} free riding`, `${d} szabadon`);
  if(sg.hr) return L(`${d} na pulsu ${hrTarget(sg)}`, `${d} at heart rate ${hrTarget(sg)}`, `${d} ${hrTarget(sg)}-${huSuffix(hrTarget(sg))} pulzuson`);
  const a = Math.round(toWatts(w, sg.lo) * S.bias), b = Math.round(toWatts(w, sg.hi) * S.bias);
  return Math.abs(a - b) < 5 ? L(`${d} na ${watts(a)}`, `${d} at ${watts(a)}`, `${d} ${watts(a)}on`) : L(`${d}, od ${a} do ${watts(b)}`, `${d}, from ${a} to ${watts(b)}`, `${d}, ${a}-tól ${watts(b)}on`);
}
```

`index.html:1658`

```js
function finishWorkout(){ S.running = false; S.soft = null; applyControl(); if(settings.beep) beep(660, .4); say(() => S.route ? L("Stigao si na cilj.", "You made it to the finish.", "Célba értél.") : L("Trening je gotov. Bravo.", "Workout complete. Well done.", "Vége az edzésnek. Szép munka.")); openSummary(); }
```

`index.html:1957`

```js
$("#btn-voice-test").onclick = () => { hrVoice = null; fillVoices(); say(() => L("Za 10 sekundi: 3 minute na 265 vata, kadenca 90 do 100.", "In 10 seconds: 3 minutes at 265 watts, cadence 90 to 100.", "10 másodperc múlva: 3 perc 265 watton, kadencia 90 és 100 között"), true); };
```

`index.html:2919`

```js
  const name = x => x.n ? ui(...x.n) : "", spoken = x => x.n ? L(...x.n) : "";
```

`index.html:2926–2927`

```js
  if(st.kind === "rest") say(() => L(`Odmor. Sljedeće: ${spoken(nx)}.`, `Rest. Next: ${spoken(nx)}.`, `Pihenő. Következik: ${spoken(nx)}.`));
  else say(() => st.kind === "work" ? L(`${spoken(st)}, ${st.s} sekundi.`, `${spoken(st)}, ${st.s} seconds.`, `${spoken(st)}, ${st.s} másodperc.`) : spoken(st));
```

`index.html:2947`

```js
    if(complete) say(() => L("Trening je gotov. Bravo.", "Workout complete. Well done.", "Vége az edzésnek. Szép munka."));
```

## Hungarian voice e2e behavior documentation

Sources: `tests/e2e.js:90–126, 127–143`

`tests/e2e.js:90–126`

```js
  await test("voice: Hungarian is spoken when picked by hand, and falls back with a notice without a Hungarian voice", async () => {
    const hu = await open({ voices: [["Google magyar", "hu-HU"], ["Samsung English", "en-US"]], settings: { voice: true, voiceLang: "hu", uiLang: "en" } });
    await hu.click('[data-view="settings"]'); await hu.click("#btn-voice-test"); await hu.waitForTimeout(300);
    const sentence = (await hu.evaluate(() => __spoken))[0];
    assert.match(sentence, /10 másodperc/, sentence);
    assert.match(sentence, /perc/, sentence);
    assert.doesNotMatch(sentence, /sekundi|vata|kadenca|vat\\b/, "no Croatian words in a Hungarian sentence: " + sentence);
    await hu.click('[data-view="ride"]');
    await hu.evaluate(() => { S.workout = { ftp: 230 }; say(() => segSpeech({ d: 200, lo: 1, hi: 1, cad: [90, 100] }), true); }); await hu.waitForTimeout(300);
    const workoutSentence = (await hu.evaluate(() => __spoken))[1];
    assert.match(workoutSentence, /3 perc 20 másodperc/, workoutSentence);
    assert.match(workoutSentence, /watton/, workoutSentence);
    assert.match(workoutSentence, /kadencia 90 és 100 között/, workoutSentence);
    assert.doesNotMatch(workoutSentence, /vat\\b|sekundi|kadenca/, workoutSentence);
    await hu.evaluate(() => say(() => segSpeech({ d: 200, free: true, note: "Visoka kadenca, mirno sjedi", cad: [90, CAD_ANY] }), true)); await hu.waitForTimeout(300);
    const cueSentence = (await hu.evaluate(() => __spoken)).at(-1);
    assert.match(cueSentence, /Magas kadencia, maradj ülve/, cueSentence);
    assert.match(cueSentence, /kadencia 90 vagy több/, cueSentence);
    assert.doesNotMatch(cueSentence, /Visoka|kadenca|sekundi/, cueSentence);
    await hu.evaluate(() => { hrVoice = pickVoice(); S.workout = { ftp: 200 }; S.hrOff = 0; say(() => segSpeechPower({ d: 180, hr: 145 / settings.maxHr }), true); });
    await hu.waitForTimeout(300);
    const hrSentence = (await hu.evaluate(() => __spoken)).at(-1);
    assert.match(hrSentence, /145-ös pulzuson/, hrSentence);
    await hu.evaluate(() => say(() => segSpeechPower({ d: 180, hr: 150 / settings.maxHr }), true)); await hu.waitForTimeout(300);
    assert.match((await hu.evaluate(() => __spoken)).at(-1), /150-es pulzuson/);
    await hu.evaluate(() => { S.workout = null; S.dist = 12000; lapResult({ kind: "dist", dur: 200, avgP: 250 }); }); await hu.waitForTimeout(300);
    const lapSentence = (await hu.evaluate(() => __spoken)).at(-1);
    assert.match(lapSentence, /12 kilométer/, lapSentence);

    await hu.context().close();
    const none = await open({ voices: [["Samsung English", "en-US"]], settings: { voice: true, voiceLang: "hu", uiLang: "en" } });
    await none.click('[data-view="settings"]'); await none.waitForTimeout(200);
    assert.match(await none.textContent("#voice-note"), /Hungarian/);
    await none.click("#btn-voice-test"); await none.waitForTimeout(300);
    assert.match((await none.evaluate(() => __spoken))[0], /^In 10 seconds/);
    await none.context().close();
  });
```

`tests/e2e.js:127–143`

```js
  await test("voice: the Settings offer Hungarian, name it, and notice when the device has no Hungarian voice", async () => {
    const ok = await open({ voices: [["Google magyar", "hu-HU"], ["Samsung English", "en-US"]], settings: { voice: true, voiceLang: "hu", uiLang: "en" } });
    await ok.click('[data-view="settings"]'); await ok.waitForTimeout(200);
    assert.equal(await ok.evaluate(() => __pedala.S && document.querySelector('[name="voiceLang"] option[value="hu"]')?.textContent.trim()), "Magyar");
    assert.match(await ok.textContent("#voice-note"), /Announcements are in Hungarian/, "the note says announcements are in Hungarian");
    await ok.context().close();

    const none = await open({ voices: [["Samsung English", "en-US"]], settings: { voice: true, voiceLang: "hu", uiLang: "en" } });
    await none.click('[data-view="settings"]'); await none.waitForTimeout(200);
    assert.match(await none.textContent("#voice-note"), /Hungarian voice missing; announcements fall back to English/, "the note names Hungarian as missing and English as the fallback");
    await none.context().close();

    const croatian = await open({ voices: [["Google hrvatski", "hr-HR"], ["Samsung English", "en-US"]], settings: { voice: true, voiceLang: "hu", voiceName: "Google hrvatski", uiLang: "en" } });
    await croatian.click('[data-view="settings"]'); await croatian.click("#btn-voice-test"); await croatian.waitForTimeout(300);
    assert.match((await croatian.evaluate(() => __spoken))[0], /^In 10 seconds/, "a saved Croatian voice cannot override Hungarian mode's English fallback");
    await croatian.context().close();
  });
```
