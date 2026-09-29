import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImageData } from './core/image-data'
import { decode, encode } from './codecs'
import { createImageData, crop, resize } from './core'
import { parseColor } from './paint'
import { debugLog } from './utils'

/**
 * Default sizes the basic favicon flow generates as PNG.
 *
 * - 16/32/48 are the historical browser tab + ICO components.
 * - 96 is a Windows tile.
 * - 144/192/384/512 are the PWA manifest icons (192 + 512 are the
 *   Web App Manifest "minimum" pair).
 * - 180 is the de-facto apple-touch-icon size; iOS will downscale
 *   automatically for smaller home-screen contexts.
 */
const DEFAULT_PNG_SIZES = [16, 32, 48, 96, 144, 180, 192, 384, 512] as const

/**
 * Sizes packed into the multi-resolution favicon.ico. Browsers pick
 * the closest match by DPR; 16/32/48 covers every desktop case.
 * (Larger sizes inflate the .ico past the historical ~10KB budget
 * and don't render any better than the same-resolution PNG link.)
 */
const ICO_SIZES = [16, 32, 48] as const

export interface FaviconResult {
  size: number
  path: string
  /** Format identifier — 'png', 'ico', or 'manifest'. Lets callers
   * downstream filter by type without re-parsing the path. */
  type: 'png' | 'ico' | 'manifest'
}

export interface FaviconOptions {
  /** Override the PNG size set. Defaults to [`DEFAULT_PNG_SIZES`]. */
  sizes?: number[]
  /**
   * Crop a transparent margin off the source before resizing. Defaults to
   * `true`.
   *
   * An app icon drawn on Apple's grid is a shape inside a transparent margin
   * (a macOS icon's squircle is 824 of its 1024 pixels), which is right in a
   * Dock and wrong in a 16px tab, where the margin takes a fifth of the only
   * pixels there are and the icon reads as a speck. The crop keeps the image
   * square and centred, and leaves a full-bleed source untouched.
   */
  trim?: boolean
  /**
   * Emit a `site.webmanifest` file referencing the 192 + 512 PNGs.
   * Defaults to `true`. Disable if your app already ships a manifest
   * authored by hand.
   */
  manifest?: boolean | {
    name?: string
    shortName?: string
    themeColor?: string
    backgroundColor?: string
    /**
     * Declare the manifest icons maskable as well as `any`. Defaults to
     * `false`: a maskable icon promises its content sits inside the central
     * 80% circle, and Android crops everything outside it, so only a source
     * drawn for that safe zone should say so.
     */
    maskable?: boolean
    /**
     * URL prefix for the icon paths emitted into the manifest. Useful
     * when serving the favicon set from `/static/favicons/` instead of
     * the document root. Trailing slash is added if missing.
     */
    pathPrefix?: string
  }
}

/**
 * Generate a complete favicon set from a single source image.
 *
 * Outputs (under `outputDir`):
 *   - favicon-16x16.png … favicon-512x512.png  (one per size in `sizes`)
 *   - favicon.ico                              (multi-resolution: 16+32+48)
 *   - apple-touch-icon.png                     (alias for favicon-180x180.png)
 *   - site.webmanifest                         (when `manifest !== false`)
 *
 * The .ico is a real multi-resolution container with embedded PNG data
 * (Vista+ format). Old IE versions get a fallback BMP entry as a side
 * effect of using PNG-in-ICO; all modern browsers (>=99% of traffic)
 * read the PNG entries directly.
 *
 * Idempotent: re-running over an existing output dir overwrites in
 * place. Safe to call from a build script.
 */
export async function generateFavicons(
  input: string,
  outputDir: string,
  options: FaviconOptions = {},
): Promise<FaviconResult[]> {
  debugLog('favicon', `Generating favicons from ${input} → ${outputDir}`)

  await mkdir(outputDir, { recursive: true })

  const sizes = (options.sizes && options.sizes.length > 0)
    ? Array.from(new Set([...options.sizes, ...ICO_SIZES])).sort((a, b) => a - b)
    : Array.from(new Set([...DEFAULT_PNG_SIZES, ...ICO_SIZES])).sort((a, b) => a - b)

  const inputBuffer = new Uint8Array(await readFile(input))
  const decoded = await decode(inputBuffer)
  const imageData = options.trim === false ? decoded : trimTransparentMargin(decoded)
  const manifestOptions = typeof options.manifest === 'object' ? options.manifest : {}

  const results: FaviconResult[] = []
  // Cache the PNG bytes per size so the .ico packing step doesn't
  // re-encode the same PNG twice.
  const pngBySize = new Map<number, Uint8Array>()

  for (const size of sizes) {
    const resized = resize(imageData, { width: size, height: size })
    const pngBuffer = await encode(resized, 'png')
    pngBySize.set(size, pngBuffer)

    const outputPath = join(outputDir, `favicon-${size}x${size}.png`)
    await writeFile(outputPath, pngBuffer)
    results.push({ size, path: outputPath, type: 'png' })
  }

  // Apple touch icon: convention is `apple-touch-icon.png` at the
  // document root, 180×180. Write a copy with the conventional name
  // so the layout's `<link rel="apple-touch-icon">` doesn't have to
  // remember the size suffix.
  //
  // iOS draws no transparency on a home screen: it fills it with black and
  // rounds the corners itself. So a source whose own corners are transparent
  // gets black corners, which only looks intended on a black icon. When the
  // manifest names a background, the touch icon is flattened onto it.
  const appleSrc = pngBySize.get(180)
  if (appleSrc) {
    const applePath = join(outputDir, 'apple-touch-icon.png')
    const appleBytes = manifestOptions.backgroundColor
      ? await encode(flatten(resize(imageData, { width: 180, height: 180 }), manifestOptions.backgroundColor), 'png')
      : appleSrc
    await writeFile(applePath, appleBytes)
    results.push({ size: 180, path: applePath, type: 'png' })
  }

  // Multi-resolution favicon.ico (real ICO container — not a renamed
  // PNG, which the previous version did and which fails strict parsers
  // and Windows context menus).
  const icoBuffer = encodeIco(
    ICO_SIZES.map(size => ({ size, png: pngBySize.get(size)! })),
  )
  const icoPath = join(outputDir, 'favicon.ico')
  await writeFile(icoPath, icoBuffer)
  results.push({ size: 32, path: icoPath, type: 'ico' })

  if (options.manifest !== false) {
    const cfg = manifestOptions
    const prefix = (cfg.pathPrefix || '/').replace(/\/?$/, '/')
    const manifestJson = {
      name: cfg.name || 'App',
      short_name: cfg.shortName || cfg.name || 'App',
      icons: [192, 512]
        .filter(s => sizes.includes(s))
        .map(s => ({
          src: `${prefix}favicon-${s}x${s}.png`,
          sizes: `${s}x${s}`,
          type: 'image/png',
          purpose: cfg.maskable ? 'any maskable' : 'any',
        })),
      theme_color: cfg.themeColor || '#1c1917',
      background_color: cfg.backgroundColor || '#ffffff',
      display: 'standalone',
      start_url: '/',
    }
    const manifestPath = join(outputDir, 'site.webmanifest')
    await writeFile(manifestPath, JSON.stringify(manifestJson, null, 2))
    results.push({ size: 0, path: manifestPath, type: 'manifest' })
  }

  return results
}

/**
 * Crop away a transparent margin, keeping the result square and centred.
 *
 * The bounds are found on alpha alone: a transparent pixel's colour channels
 * are whatever the encoder left there, so comparing them (as `trim` does)
 * finds a margin that is not there. A faint shadow under the alpha threshold
 * is treated as margin. An opaque or fully transparent image comes back as is.
 */
export function trimTransparentMargin(image: ImageData, alphaThreshold = 8): ImageData {
  let left = image.width
  let top = image.height
  let right = -1
  let bottom = -1

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3]! > alphaThreshold) {
        if (x < left)
          left = x
        if (x > right)
          right = x
        if (y < top)
          top = y
        if (y > bottom)
          bottom = y
      }
    }
  }

  if (right < 0)
    return image

  const width = right - left + 1
  const height = bottom - top + 1
  if (width === image.width && height === image.height)
    return image

  const content = crop(image, { left, top, width, height })
  if (width === height)
    return content

  // Pad the short side back out with transparency, so a wide or tall mark is
  // centred in the square rather than stretched to fill it.
  const side = Math.max(width, height)
  const square = createImageData(side, side, { hasAlpha: true, fill: { r: 0, g: 0, b: 0, a: 0 } })
  const offsetX = Math.floor((side - width) / 2)
  const offsetY = Math.floor((side - height) / 2)
  for (let y = 0; y < height; y++) {
    const from = y * width * 4
    square.data.set(content.data.subarray(from, from + width * 4), ((y + offsetY) * side + offsetX) * 4)
  }
  return square
}

/** Composite an image over a solid colour, so nothing in it is transparent. */
function flatten(image: ImageData, background: string): ImageData {
  const { r, g, b } = parseColor(background)
  const out = createImageData(image.width, image.height, { hasAlpha: true })
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3]! / 255
    out.data[i] = Math.round(image.data[i]! * alpha + r * (1 - alpha))
    out.data[i + 1] = Math.round(image.data[i + 1]! * alpha + g * (1 - alpha))
    out.data[i + 2] = Math.round(image.data[i + 2]! * alpha + b * (1 - alpha))
    out.data[i + 3] = 255
  }
  return out
}

/**
 * Pack an array of {size, png} entries into a single multi-resolution
 * ICO file. Each PNG is embedded as-is (PNG-in-ICO is supported by
 * Vista+ and every browser since IE11).
 *
 * Layout:
 *   ICONDIR     6 bytes
 *   ICONDIRENTRY[count]   16 bytes each
 *   image data            concatenated, in same order
 */
function encodeIco(entries: { size: number, png: Uint8Array }[]): Uint8Array {
  // ICONDIR (6) + ICONDIRENTRY * count (16) + sum of image bytes.
  const headerSize = 6 + entries.length * 16
  const totalSize = headerSize + entries.reduce((sum, e) => sum + e.png.byteLength, 0)
  const out = new Uint8Array(totalSize)
  const view = new DataView(out.buffer)

  // ICONDIR: reserved=0, type=1 (icon), count.
  view.setUint16(0, 0, true)
  view.setUint16(2, 1, true)
  view.setUint16(4, entries.length, true)

  let imageOffset = headerSize
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const dirOffset = 6 + i * 16
    // ICO uses a single byte each for width and height. Values 1-255
    // are taken as-is; 0 means "256" (an exception for the largest
    // legal icon dimension). 16/32/48 fit fine in the byte field.
    view.setUint8(dirOffset + 0, entry.size === 256 ? 0 : entry.size)
    view.setUint8(dirOffset + 1, entry.size === 256 ? 0 : entry.size)
    view.setUint8(dirOffset + 2, 0) // ColorCount = 0 (true color / >256)
    view.setUint8(dirOffset + 3, 0) // Reserved
    view.setUint16(dirOffset + 4, 1, true)  // Planes
    view.setUint16(dirOffset + 6, 32, true) // BitCount (RGBA)
    view.setUint32(dirOffset + 8, entry.png.byteLength, true) // BytesInRes
    view.setUint32(dirOffset + 12, imageOffset, true) // ImageOffset

    out.set(entry.png, imageOffset)
    imageOffset += entry.png.byteLength
  }

  return out
}

// Re-export for tests / power users who want to pack a custom set of
// sizes (e.g. include 64 for a Discord favicon, exclude 16 for retina-only).
export const _internals: { encodeIco: typeof encodeIco } = { encodeIco }
