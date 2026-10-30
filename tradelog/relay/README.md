# TradeLog price relay

A tiny Cloudflare Worker that fetches pre-market and after-hours prices from
Yahoo Finance for TradeLog. Yahoo doesn't send CORS headers, so a web app
can't call it directly; the relay fetches the chart and passes it on to your
app only.

- Free: Cloudflare's free plan allows 100,000 requests a day. TradeLog makes
  one request a minute while the Watchlist is open outside regular hours.
- No keys or secrets: Yahoo needs none, so there's nothing to leak.
- Locked to your app: only the origins in `ALLOWED_ORIGINS` (in
  `wrangler.toml`) can read its answers.
- Yahoo's chart endpoint is unofficial. If Yahoo changes it, extended-hours
  prices stop and TradeLog falls back to showing closing prices.

## Deploy (once, about 5 minutes)

From the `tradelog` folder:

```bash
npx wrangler login
```

```bash
npm run relay:deploy
```

The first time, Cloudflare may ask you to pick a `workers.dev` subdomain. When
it finishes, it prints the relay's address, like
`https://tradelog-prices.your-name.workers.dev`.

On your iPhone, open TradeLog, go to **Settings → Pre-market and after hours**,
paste that address and tap **Save and test**. You should see
"Relay works: AAPL after hours …" (or "no pre-market or after-hours trade yet"
early in the morning).

## Change who can use it

Edit `ALLOWED_ORIGINS` in `wrangler.toml` (comma-separated, no paths), then run
`npm run relay:deploy` again. To test on the phone from the dev server, add its
LAN address, e.g. `http://192.168.1.20:5173`.

## Run it locally

```bash
npm run relay:dev
```

This serves the relay at `http://127.0.0.1:8787`; put that address in Settings
while running the app with `npm run dev`. Try it directly:
`http://127.0.0.1:8787/quotes?symbols=AAPL,NVDA`.
