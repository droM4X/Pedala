# Pedala

**Indoor cycling in the browser.** Connect your smart trainer, heart rate strap and Zwift Click over Bluetooth, ride ERG workouts, pedal drills or real climbs, and watch YouTube while you ride. No app store, no subscription: one web page you deploy yourself, installable as an app on Android and desktop.

## Features

**Riding**
- **Bluetooth devices:** FTMS smart trainers (e.g. Elite Direto XR-T), heart rate straps and Zwift Click v1/v2. Devices you connected once reconnect by themselves as soon as they are switched on. The strap and the Click are off until you tick *I use a heart rate strap* / *I use a Zwift Click* in Settings, which shows their buttons and lets them connect.
- **ERG workouts:** built-in workouts (endurance, sweet spot, VO2max, threshold, ramp test) and `.zwo` import from Zwift, including cadence targets.
- **Pedal drills** with cadence targets and cues: spin-ups, high/low cadence, low-cadence torque, cadence pyramid, single leg.
- **Heart-rate workouts:** power is steered to keep your heart rate in Zone 2.
- **Free ride and GPX routes** with 24 virtual gears (Zwift ratios); the trainer follows the gradient.
- **Built-in climbs:** Alpe d'Huez, Mont Ventoux, Passo dello Stelvio, and Sljeme, Učka and Biokovo in Croatia (profiles built from published gradients).
- **Soft start:** flat road before the start and while paused, then power or gradient ramps back up, so the trainer never locks you into a heavy gear.

**Screen**
- **YouTube while riding**, full screen with your numbers on top and a Zwift-style workout profile with a heart-rate line behind them.
- **A video feed of your own:** newest videos from favourite channels, your own playlists and a ride theme of the day (YouTube offers apps no personal recommendations).
- **Music from YouTube Music** in a small player with ⏮ ⏯ ⏭, or **no video at all:** a large workout profile instead.
- **Voice announcements** in the selected voice's language ("In 10 seconds: 3 minutes at 265 watts"), English when the device has no voice for the interface language; YouTube is turned down while the voice speaks.
- **Heart-rate zones**, interval scoring and a phone layout that never scrolls while you ride.

**After the ride**
- **Ride report** like Zwift's: power by zone with heart rate, interval scores, power distribution, time in HR zones, power curve against the last 90 days.
- **Progress:** fitness/fatigue/form (CTL/ATL/TSB), weekly volume, best powers, FTP over time.
- **14-week training plan** (short weekday sessions, long Sunday Zone 2 ride; optionally two swims with technique drills, a brick run and an easy Friday run from 1 to 6 km, ticked off from intervals.icu) with progress tracking and a calendar file with reminders.
- **intervals.icu upload** of every ride, `.FIT` export for Strava, GoldenCheetah and others.
- **Virtual coach:** a weekly review every Saturday, or a short comment after every session (in English), on your Pedala rides and on everything else that reaches intervals.icu, such as runs and swims from a watch. You can also ask it questions or for a plan change ("I have a cold, what about this week?"); proposed changes are applied when you confirm them. It runs through OpenRouter and works with any model the key may use; the model is chosen in Settings, where the list shows only what the key's own guardrail allows.
- **Strength at home:** a 12-week bodyweight plan (three circuits a week) with a guided player: countdown, voice cues, next exercise.
- **Profiles:** more people on one deploy, each with their own data.
- **Sync between phone and tablet** through Vercel Blob; backup and restore as a single `.json` file.

## Requirements

Web Bluetooth works in **Chrome or Edge on Android, Windows, macOS, Linux and ChromeOS**, over `https://` or on `localhost`. Safari and iOS do not support it.

## Deploy your own

1. Click **Deploy with Vercel** above. Vercel copies the repository to your GitHub account and asks for `PEDALA_PASSWORD`.
2. Optional, in **Project → Settings → Environment Variables** (then **Redeploy**):

### Environment variables

| Variable | What for |
|---|---|
| `PEDALA_PASSWORD` | Password for the login page (required: without it nobody gets in). Use a long one: the default login name is public. |
| `PEDALA_USER` | Login name (default `admin`) |
| `PEDALA_USER2`, `PEDALA_PASSWORD2` … up to 5 | More people, each with their own rides, plan, coach and sync (optional) |
| `INTERVALS_API_KEY2` … | intervals.icu key of the second person … (optional; they can also enter it in Settings) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key for searching videos, channels and playlists. In Google Cloud set *Application restrictions: None* and *API restrictions: YouTube Data API v3* (the key is used by the server, not the browser). |
| `INTERVALS_API_KEY` | intervals.icu API key (*Settings → Developer Settings* on intervals.icu) |
| `OPENROUTER_API_KEY` | OpenRouter API key for the virtual coach (optional). The key can also be pasted in Settings, where it stays on that device. A small monthly limit on the key is a good idea. |
| `BLOB_READ_WRITE_TOKEN` | Added by Vercel when you create a Blob store: **Storage → Create → Blob**, *Private*, tick *Add a read-write token*. Enables sync between devices. |

Every deploy is private to its owner: rides, plans and keys stay in your browser and your Vercel project.

3. Open your site in Chrome, log in, then **⋮ → Add to Home screen → Install** to use it as an app.

### Automatic reconnection

Chrome only remembers Bluetooth devices with `chrome://flags/#enable-web-bluetooth-new-permissions-backend` set to **Enabled**. Restart Chrome, connect the devices once by hand, and from then on they connect by themselves. *Settings → Automatic connection* shows what is going on.

### Zwift Click v2

The two pods are two separate devices. Connect the harder-gear pod with **Click +** and the easier-gear pod with **Click −** (wake only that pod before connecting). Every button on the + pod shifts up, every button on the − pod shifts down. If they end up swapped, use *Settings → Zwift Click → Set the + and − pod*. The left Click v2 pod often sends no presses unless it was recently unlocked in Zwift; then put both directions on the right pod: in *Set the + and − pod* press a button for +, then another button on the same pod for −.

Use the phone remote when the Zwift Click pods go to sleep during a ride. Open `http://<the computer's LAN address>:8765/gear.html` on your phone; the Remote chip in Pedala's header shows the address; click it to display a QR code your phone can scan to open `gear.html`. The + and − buttons do the same as the Click. The green dot means the phone is connected to an active ride. The Start and Finish buttons start, pause and end the ride; Finish asks for a confirmation first. The phone remote does not work when Pedala is deployed to Vercel.

### Voice

Announcements use the selected voice's language, not the interface language. *Settings → Announcement voice* lists the device's voices for the interface language; if there are none, it lists English voices and says that announcements are in English. Android: install the language's voice data under *Text-to-speech → Speech Services by Google → Install voice data*.

## Languages

The interface is in English by default. *Settings → Language* can follow the browser or switch to another language, and the choice is saved on that device. Hungarian translates the whole interface text. A language is one file in `lang/`: copy `lang/_template.js` to `lang/<code>.js`, set its code, name and locale, fill in the strings, then run `npm run langs` to add it to `lang/index.json`. English text is the key, so missing strings fall back to English. The login page, the phone remote (`gear.html`), the virtual coach's comments and FIT/ICS metadata stay English.

## Development

The app is a single `index.html` with no build step. The server side is five small files: `middleware.js` (login), `api/sync.js` (Vercel Blob), `api/intervals.js`, `api/youtube.js` and `api/coach.js` (proxies that keep keys on the server).

```bash
npm install
npm run dev            # local server on http://localhost:8765 with fake intervals.icu, YouTube and Blob
```

Without a trainer use **Connect trainer → Simulator**; `?simspeed=20` runs the simulator 20× faster.

Tests (Node 20+):

```bash
npm i --no-save jsqr playwright && npx playwright install chromium  # jsqr decodes what qr.js encodes; Playwright runs end-to-end tests
npm test               # unit tests (login, sync) and end-to-end tests in Chromium
```

| Part | What it does |
|---|---|
| `BleTrainer`, `SimTrainer`, `BleHR`, `ZwiftClick`, `autoConnect` | Bluetooth devices, simulator, automatic reconnection |
| `BUILTIN`, `parseZwo`, `PLAN`, `PLAN_WO` | Workouts, drills, training plan |
| `parseGpx`, `CLIMBS`, `trainerGrade` | Routes, built-in climbs, virtual gears |
| `tick`, `applyControl`, `softStep`, `steerHr` | Ride loop, soft start, heart-rate control |
| `metrics`, `renderReport`, `drawProgress` | Metrics, ride report, progress |
| `encodeFit` | FIT export |
| `say`, `duckStart` | Voice announcements, turning YouTube down |
| `syncNow`, `syncIcu` | Sync between devices, intervals.icu upload |

Ride samples are `[t, power W, cadence, heart rate, speed cm/s, distance m]`, plus `lat, lon, elevation` on routes.

Issues and pull requests are welcome.

## Credits and trademarks

- Zwift Click protocol notes from [qdomyos-zwift](https://github.com/cagnulein/qdomyos-zwift) (QZ) and Torqa, used as documentation; no code was copied.
- Pedal drills are inspired by Zwift's *Pedalling drills* and GC Coaching cadence sessions.
- Zwift, Zwift Click, Elite Direto, Strava, intervals.icu, YouTube and YouTube Music are trademarks of their owners. Pedala is an independent project and is not affiliated with or endorsed by any of them.

## License

[MIT](LICENSE)
