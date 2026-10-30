# TradeLog

A personal trading journal and price tracker that installs on an iPhone from
Safari as a Progressive Web App. It costs nothing to run, works offline, and
keeps your data on your device.

- **Journal:** log a trade in seconds, edit it, close all or part of it at the
  current price, and filter by symbol, strategy or tag.
- **Stats:** your account value at current prices, then total P&L, win rate,
  average win and loss, profit factor, max drawdown, streaks, holding time,
  equity curve, and P&L by month, strategy, symbol, tag, side and weekday, for
  any period.
- **Watchlist:** prices and daily change from Finnhub's free plan, open trades
  grouped into positions with their unrealized P&L, upcoming earnings dates,
  and optional pre-market and after-hours prices through the
  [price relay](relay/README.md).
- **Hide amounts:** the eye button masks money and share counts on every
  screen, for using the app around other people.
- **Backup:** JSON export and restore, a CSV of your trades, and a reminder
  when your last backup is over a week old.

TradeLog never places trades and gives no investment advice.

## Install on iPhone

1. Open `https://<your-username>.github.io/tradelog/` in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. Always open TradeLog from its home screen icon. A Safari tab keeps a
   separate copy of your data, and Safari can erase it after 7 days without a
   visit.
4. In **Settings**, paste a free [Finnhub API key](https://finnhub.io/register)
   for prices and symbol checks. Pick your main currency, then either a
   starting balance or the cash you hold today (in any currencies). Trades are
   always in US dollars; Stats can switch between dollars and your currency at
   today's exchange rate.

Your journal lives only on the phone. Deleting the home screen icon, or
clearing Safari's website data, deletes it too, so export a backup to Files or
iCloud Drive regularly. The app reminds you after 7 days.

## Updates

Every push to `main` runs the tests, builds the app and deploys it to GitHub
Pages (`.github/workflows/deploy.yml`). The app checks for a new version when
it opens and when you come back to it, downloads it in the background, and
switches over as soon as you're not in the middle of editing something.
**Settings → About** shows the version and build you're running and has a
**Check for updates** button.

## Develop

Needs Node.js 22.18 or later.

```bash
npm install
```

```bash
npm run dev
```

To try it on your phone, run `npm run dev -- --host` and open the network
address it prints in Safari on the same Wi-Fi.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload (no service worker, so no offline mode) |
| `npm test` | Vitest in watch mode; `npm test -- --run` runs once |
| `npm run lint` | Oxlint |
| `npm run build` | Type-check and build to `dist/`, including the service worker |
| `npm run preview` | Serve the production build, to test offline use and updates |
| `npm run images` | Redraw the maskable icon and iOS launch screens |
| `npm run relay:dev` / `relay:deploy` | Run or deploy the price relay |

The P&L math, backup parsing and price handling are pure functions in
`src/lib/` with tests beside them. Screens are in `src/screens/`, the Dexie
(IndexedDB) database in `src/db/`.

### Icons and launch screens

`npm run images` draws `public/icons/maskable-512.png` and the launch screens
in `public/splash/` from the logo in `scripts/pwa-images.ts`. iOS shows a
launch screen only when one matches the phone's exact screen size, so when a
new iPhone size comes out, add it to `SPLASH_SCREENS` there and run the
command again; the build adds the matching `<link>` tags to the page.

## Release checklist

Before tagging a release, run through these on the iPhone:

- Installs from Safari and opens full screen with the right icon and a dark
  launch screen
- Content clears the notch and home indicator, upright and turned sideways
- Dragging past the end of a list, or on the tab bar, leaves the page in place
- Add, edit, close and delete a trade
- Close part of a trade: the rest stays open, and Stats count the closed part
- Hide amounts: no money or share counts show anywhere, and it stays on after
  a restart
- Number keypad on price fields, and no zoom when a field is focused
- Airplane mode: the app opens, the journal works, prices show "Stale"
- Force-quit and reopen: data is still there
- Export JSON to Files, delete a trade, import it back
- Push an update, then reopen the app: Settings → About shows the new build
