/**
 * The PWA images drawn by generate-images.ts, shared with vite.config.ts so
 * the launch screen <link> tags always match the files on disk.
 */

/** App background and logo green, as in the manifest and favicon.svg */
export const BACKGROUND = '#0b0f14'
export const LOGO = '#22c55e'

/** The favicon's chart line in its 64-unit viewBox: points, stroke width and end dot */
export const LOGO_LINE: [number, number][] = [
  [12, 44],
  [24, 32],
  [34, 38],
  [52, 18],
]
export const LOGO_STROKE = 6
export const LOGO_DOT = { x: 52, y: 18, r: 4 }

export const MASKABLE_ICON = 'icons/maskable-512.png'

type Screen = {
  /** Portrait size in CSS pixels */
  width: number
  height: number
  pixelRatio: number
  devices: string
}

/**
 * iOS ignores the manifest's background_color and shows a white screen while
 * a home screen app starts, unless a startup image matches the exact screen.
 * The home screen doesn't rotate on iPhone, so portrait is enough.
 */
export const SPLASH_SCREENS: Screen[] = [
  { width: 440, height: 956, pixelRatio: 3, devices: 'iPhone 16 Pro Max, 17 Pro Max' },
  { width: 420, height: 912, pixelRatio: 3, devices: 'iPhone Air' },
  { width: 402, height: 874, pixelRatio: 3, devices: 'iPhone 16 Pro, 17, 17 Pro' },
  {
    width: 430,
    height: 932,
    pixelRatio: 3,
    devices: 'iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus',
  },
  { width: 393, height: 852, pixelRatio: 3, devices: 'iPhone 14 Pro, 15, 15 Pro, 16' },
  { width: 428, height: 926, pixelRatio: 3, devices: 'iPhone 12 Pro Max, 13 Pro Max, 14 Plus' },
  { width: 390, height: 844, pixelRatio: 3, devices: 'iPhone 12, 12 Pro, 13, 13 Pro, 14, 16e' },
  { width: 414, height: 896, pixelRatio: 3, devices: 'iPhone XS Max, 11 Pro Max' },
  { width: 375, height: 812, pixelRatio: 3, devices: 'iPhone X, XS, 11 Pro, 12 mini, 13 mini' },
  { width: 414, height: 896, pixelRatio: 2, devices: 'iPhone XR, 11' },
  { width: 414, height: 736, pixelRatio: 3, devices: 'iPhone 8 Plus' },
  { width: 375, height: 667, pixelRatio: 2, devices: 'iPhone 8, SE (2nd and 3rd generation)' },
]

/** Where a screen's image lives, relative to the public folder. */
export function splashPath(s: Screen): string {
  return `splash/splash-${s.width * s.pixelRatio}x${s.height * s.pixelRatio}.png`
}

export function splashMedia(s: Screen): string {
  return (
    `(device-width: ${s.width}px) and (device-height: ${s.height}px) and ` +
    `(-webkit-device-pixel-ratio: ${s.pixelRatio}) and (orientation: portrait)`
  )
}
