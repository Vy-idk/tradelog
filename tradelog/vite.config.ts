import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import {
  BACKGROUND,
  MASKABLE_ICON,
  SPLASH_SCREENS,
  splashMedia,
  splashPath,
} from './scripts/pwa-images.ts'

const BASE = '/tradelog/' // must match the GitHub repo name

const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as {
  version: string
}

/** The commit being built, shown in Settings so you can tell which version is running. */
function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

/** Links each iPhone screen size to its launch image (see scripts/pwa-images.ts). */
function launchScreens(): Plugin {
  return {
    name: 'tradelog-launch-screens',
    transformIndexHtml: () =>
      SPLASH_SCREENS.map((s) => ({
        tag: 'link',
        attrs: {
          rel: 'apple-touch-startup-image',
          media: splashMedia(s),
          href: BASE + splashPath(s),
        },
        injectTo: 'head',
      })),
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: BASE,
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit()),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  // The price relay is a separate Cloudflare Worker; its local dev state
  // would otherwise reload the app on every request it serves
  server: { watch: { ignored: ['**/relay/**'] } },
  plugins: [
    react(),
    tailwindcss(),
    launchScreens(),
    VitePWA({
      // The app decides when to switch to a new version (src/lib/pwa.ts), so
      // an update never reloads the page in the middle of logging a trade
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: BASE,
        name: 'TradeLog',
        short_name: 'TradeLog',
        description: 'Personal trading journal and price tracker',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: BACKGROUND,
        theme_color: BACKGROUND,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: MASKABLE_ICON, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { navigateFallback: `${BASE}index.html` },
    }),
  ],
})
