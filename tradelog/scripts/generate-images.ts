/**
 * Draws the maskable app icon and the iOS launch screens from the favicon's
 * logo, with no image libraries: the logo is a few round-capped strokes, so
 * each pixel's coverage comes straight from its distance to them.
 *
 *   npm run images
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import {
  BACKGROUND,
  LOGO,
  LOGO_DOT,
  LOGO_LINE,
  LOGO_STROKE,
  MASKABLE_ICON,
  SPLASH_SCREENS,
  splashPath,
} from './pwa-images.ts'

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Distance from (px, py) to the segment a–b. */
function segmentDistance(px: number, py: number, a: [number, number], b: [number, number]) {
  const [ax, ay] = a
  const dx = b[0] - ax
  const dy = b[1] - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

/** Signed distance, in logo units, from a point to the logo's edge (negative inside). */
function logoDistance(x: number, y: number): number {
  let d = Math.hypot(x - LOGO_DOT.x, y - LOGO_DOT.y) - LOGO_DOT.r
  for (let i = 1; i < LOGO_LINE.length; i++) {
    d = Math.min(d, segmentDistance(x, y, LOGO_LINE[i - 1], LOGO_LINE[i]) - LOGO_STROKE / 2)
  }
  return d
}

/** The logo's bounding box in its 64-unit viewBox. */
const bounds = (() => {
  const xs = [...LOGO_LINE.map((p) => p[0]), LOGO_DOT.x]
  const ys = [...LOGO_LINE.map((p) => p[1]), LOGO_DOT.y]
  const pad = Math.max(LOGO_STROKE / 2, LOGO_DOT.r)
  return {
    minX: Math.min(...xs) - pad,
    maxX: Math.max(...xs) + pad,
    minY: Math.min(...ys) - pad,
    maxY: Math.max(...ys) + pad,
  }
})()

/**
 * An RGB image of the background with the logo centred on it, `scale`
 * pixels per logo unit. Rows are PNG scanlines, each led by its filter byte.
 */
function render(width: number, height: number, scale: number): Buffer {
  const bg = hexToRgb(BACKGROUND)
  const fg = hexToRgb(LOGO)
  const stride = width * 3 + 1
  const out = Buffer.alloc(stride * height)
  // Pixel (0, 0) in logo units, so the logo's box is centred
  const originX = (bounds.minX + bounds.maxX) / 2 - width / 2 / scale
  const originY = (bounds.minY + bounds.maxY) / 2 - height / 2 / scale
  const top = Math.floor((bounds.minY - originY) * scale) - 2
  const bottom = Math.ceil((bounds.maxY - originY) * scale) + 2
  const left = Math.max(0, Math.floor((bounds.minX - originX) * scale) - 2)
  const right = Math.min(width, Math.ceil((bounds.maxX - originX) * scale) + 2)

  for (let y = 0; y < height; y++) {
    const row = y * stride
    for (let x = 0; x < width; x++) {
      let coverage = 0
      if (y >= top && y <= bottom && x >= left && x < right) {
        // Sample the pixel centre; half a pixel either side of the edge blends
        const d = logoDistance(originX + (x + 0.5) / scale, originY + (y + 0.5) / scale)
        coverage = Math.max(0, Math.min(1, 0.5 - d * scale))
      }
      const i = row + 1 + x * 3
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(bg[c] + (fg[c] - bg[c]) * coverage)
    }
  }
  return out
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

function png(width: number, height: number, scanlines: Buffer): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bits per channel
  header[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function write(path: string, width: number, height: number, scale: number) {
  const file = join(publicDir, path)
  mkdirSync(dirname(file), { recursive: true })
  const data = png(width, height, render(width, height, scale))
  writeFileSync(file, data)
  console.log(`${path}  ${width}×${height}  ${(data.length / 1024).toFixed(1)} KB`)
}

// Maskable: Android crops icons to shapes as small as a circle 80% wide, so
// the logo's box (diagonal ≈ 57 units) has to fit well inside that circle
write(MASKABLE_ICON, 512, 512, 6.25)

// Launch screens: the logo about 105 points wide, like a native launch screen
for (const s of SPLASH_SCREENS) {
  write(splashPath(s), s.width * s.pixelRatio, s.height * s.pixelRatio, 2.25 * s.pixelRatio)
}
