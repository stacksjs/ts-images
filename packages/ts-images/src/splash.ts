import type { SVGRoot } from '@stacksjs/ts-svg'
import type { ImageData } from './core/image-data'
import type { Font } from './font'
import type { RGBA } from './text'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseSVG, rasterize } from '@stacksjs/ts-svg'
import { resize } from './core'
import { createImageData } from './core/image-data'
import { decode, encode } from './codecs'
import { loadFont } from './font'
import { parseColor } from './paint'
import { drawText, layoutText } from './text'

/**
 * Launch screens for iOS and Android, composed from a logo.
 *
 * A launch screen is not a picture of the whole screen. iOS draws the
 * launch image (`UILaunchScreen` → `UIImageName`) centred, at its own size in
 * points, over a background colour, and Android 12 draws the splash icon in a
 * circle over its own colour. A full-screen image is cropped on every device
 * whose shape it was not made for, and blurred on every one whose density it
 * was not made for. So the preset composes the mark (logo, an optional line
 * of text and a soft glow) at its size in points, renders it at each scale
 * the platforms ask for, and leaves the background to the colour the
 * platform paints, which the app's first frame then continues.
 *
 * The glow fades to nothing before the image's edge, so the image lies on its
 * background with no seam at any screen size.
 */

/** A logo: a file path, the file's bytes (SVG, PNG, JPEG, WebP…) or decoded pixels. */
export type SplashSource = string | Uint8Array | ImageData

export type SplashPlatform = 'ios' | 'android'
export type SplashAppearanceName = 'light' | 'dark'

/** How one appearance (light or dark) looks. Every field is optional. */
export interface SplashAppearance {
  /** The colour behind everything, which the platform paints. Default white (light) or black (dark). */
  background?: string
  /** This appearance's own logo, instead of the shared one. */
  logo?: SplashSource
  /**
   * Repaint the logo in one colour, keeping its shape. Unset, a logo that
   * would not read on `background` (contrast under 1.6:1) is repainted in
   * near-black or near-white on its own.
   */
  tint?: string
  /** The glow's colour, or false for none. Default: `accent`, else the logo's own colour. */
  glow?: string | false
  /** The text's colour. Default: the logo's colour, softened toward the background. */
  textColor?: string
}

/** A line of text under the logo: a product name, a tagline. */
export interface SplashText {
  value: string
  /** A TrueType font: loaded, its bytes, or a path to the `.ttf`. */
  font: Font | Uint8Array | string
  /** Font size in points. Default 15% of the logo's optical size, at least 12. */
  size?: number
  /** Space between letters, as a multiple of `size`. Default 0.14 for uppercase, 0.02 otherwise. */
  letterSpacing?: number
  /** Set the text in capitals. Default false. */
  uppercase?: boolean
  /** Space between the logo and the text, in points. Default 45% of the text size, plus 8. */
  gap?: number
}

export interface SplashOptions {
  /** The logo, shared by both appearances unless one gives its own. */
  logo: SplashSource
  light?: SplashAppearance
  /** The Dark Mode look. `false` for an app with one appearance. */
  dark?: SplashAppearance | false
  /** The brand colour, which the glow takes in both appearances unless they say otherwise. */
  accent?: string
  /**
   * The logo's optical size in points: the side of a square of the same
   * area, so a square mark and a wide wordmark look equally heavy. Default
   * 96. `'intrinsic'` draws the logo at the size it states (an SVG's
   * `width` and `height`, or a bitmap's pixels at `sourceScale`), for a
   * hand-made splash that already has the size it should be.
   */
  size?: number | 'intrinsic'
  /** The widest the logo is drawn, in points. Default 240, which keeps clear of the edges of a 320 point screen. */
  maxWidth?: number
  /** The tallest the logo is drawn, in points. Default 128. */
  maxHeight?: number
  /** Pixels per point of a bitmap logo, for `size: 'intrinsic'`. Default 1. */
  sourceScale?: number
  /**
   * Mask the logo: `rounded` (an iOS app icon's corners) or `circle`. For a
   * full-bleed square such as an app icon. Default `none`.
   */
  shape?: 'none' | 'rounded' | 'circle'
  /** Crop the logo's transparent margin before sizing it. Default true, false for `size: 'intrinsic'`. */
  trim?: boolean
  /** A soft radial glow behind the logo. Default true. */
  glow?: boolean
  /** Scales the glow's strength: 0 is none, 1 the default, 2 twice as strong. */
  glowStrength?: number
  text?: SplashText
  /** Which platforms' images. Default both. */
  platforms?: SplashPlatform[]
}

/** One rendered image: where it goes in the platform's project, its size and its PNG bytes. */
export interface RenderedSplash {
  platform: SplashPlatform
  /**
   * The file's path in the platform's own layout:
   * `LaunchLogo.imageset/LaunchLogo@3x.png`,
   * `res/drawable-night-xxhdpi/splash_icon.png`.
   */
  path: string
  appearance: SplashAppearanceName
  /**
   * `logo` is the launch image itself (iOS's launch screen and splash, and
   * Android's window background before Android 12). `icon` is Android 12's
   * splash icon: 288dp square, its content inside the 192dp circle.
   */
  kind: 'logo' | 'icon'
  /** Pixels per point (iOS) or per dp (Android). */
  scale: number
  width: number
  height: number
  bytes: Uint8Array
}

export interface SplashScreenResult {
  /** Every file written, `path` now absolute. */
  files: Array<Omit<RenderedSplash, 'bytes'>>
  /** The paths to hand an iOS build: the light and dark launch images (their `@2x`/`@3x` beside them). */
  ios?: { image: string, imageDark?: string, imageset: string }
  /** The Android `res` directory holding each density's `splash_logo.png` and `splash_icon.png`. */
  android?: { resources: string }
  /** The background colour of each appearance, as `#rrggbb`. */
  backgrounds: { light: string, dark?: string }
}

/** The scales of an iOS launch image. */
export const IOS_SPLASH_SCALES = [1, 2, 3] as const

/** Android's density buckets, as pixels per dp. */
export const ANDROID_SPLASH_DENSITIES = [
  { density: 'mdpi', scale: 1 },
  { density: 'hdpi', scale: 1.5 },
  { density: 'xhdpi', scale: 2 },
  { density: 'xxhdpi', scale: 3 },
  { density: 'xxxhdpi', scale: 4 },
] as const

/** Android 12's splash icon canvas, in dp, for an icon without its own background. */
export const ANDROID_SPLASH_ICON_DP = 288
/** The circle, in dp, an Android 12 splash icon's content has to fit inside. */
export const ANDROID_SPLASH_SAFE_DP = 192

/** The default optical size of the logo, in points. */
export const SPLASH_LOGO_SIZE = 96

/** The file name of the iOS launch image, which Craft's launch screen and splash both draw. */
export const IOS_SPLASH_IMAGE = 'LaunchLogo'

/** Devices to preview a launch screen on: screen pixels and pixels per point. */
export const SPLASH_PREVIEW_DEVICES = {
  'iphone-se': { width: 750, height: 1334, scale: 2 },
  'iphone-16-pro': { width: 1206, height: 2622, scale: 3 },
  'iphone-16-pro-max': { width: 1320, height: 2868, scale: 3 },
  'ipad-pro-13': { width: 2064, height: 2752, scale: 2 },
  'pixel-8': { width: 1080, height: 2400, scale: 2.625 },
} as const

export type SplashPreviewDevice = keyof typeof SPLASH_PREVIEW_DEVICES

// --------------------------------------------------------------------------
// Pixels with straight alpha
//
// `paint.ts` blends toward a colour from whatever the canvas holds, which is
// right on an opaque card and wrong on a transparent one: the colour of a
// transparent pixel is black, so every soft edge came out darkened. A launch
// image is transparent around its mark, so it composites with straight alpha
// throughout and premultiplies only to resample.
// --------------------------------------------------------------------------

function rgba(color: string): Required<RGBA> {
  const { r, g, b, a } = parseColor(color)
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a: a ?? 1 }
}

function hex(color: RGBA): string {
  return `#${[color.r, color.g, color.b].map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`
}

function luminance(color: RGBA): number {
  const [r, g, b] = [color.r, color.g, color.b].map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** WCAG contrast ratio between two colours. */
function contrast(a: RGBA, b: RGBA): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high! + 0.05) / (low! + 0.05)
}

/** 0 for a grey, toward 1 for a saturated colour. */
function saturation(color: RGBA): number {
  const max = Math.max(color.r, color.g, color.b)
  const min = Math.min(color.r, color.g, color.b)
  return max === 0 ? 0 : (max - min) / max
}

function mix(a: RGBA, b: RGBA, amount: number): RGBA {
  return { r: a.r + (b.r - a.r) * amount, g: a.g + (b.g - a.g) * amount, b: a.b + (b.b - a.b) * amount, a: 1 }
}

function blank(width: number, height: number): ImageData {
  return createImageData(Math.max(1, width), Math.max(1, height))
}

/** Source over destination, straight alpha, `source` placed at (x, y). */
function over(target: ImageData, source: ImageData, x: number, y: number): void {
  const left = Math.max(0, x)
  const top = Math.max(0, y)
  const right = Math.min(target.width, x + source.width)
  const bottom = Math.min(target.height, y + source.height)
  const t = target.data
  const s = source.data
  for (let row = top; row < bottom; row++) {
    for (let column = left; column < right; column++) {
      const si = ((row - y) * source.width + (column - x)) * 4
      const sa = s[si + 3]! / 255
      if (sa <= 0)
        continue
      const ti = (row * target.width + column) * 4
      const da = t[ti + 3]! / 255
      const outA = sa + da * (1 - sa)
      const sw = sa / outA
      const dw = (da * (1 - sa)) / outA
      t[ti] = Math.round(s[si]! * sw + t[ti]! * dw)
      t[ti + 1] = Math.round(s[si + 1]! * sw + t[ti + 1]! * dw)
      t[ti + 2] = Math.round(s[si + 2]! * sw + t[ti + 2]! * dw)
      t[ti + 3] = Math.round(outA * 255)
    }
  }
}

/** The bounding box of every pixel with any opacity, or null for an empty image. */
function opaqueBounds(image: ImageData, threshold = 8): { x: number, y: number, width: number, height: number } | null {
  let left = image.width
  let top = image.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3]! < threshold)
        continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

function crop(image: ImageData, x: number, y: number, width: number, height: number): ImageData {
  const out = blank(width, height)
  for (let row = 0; row < height; row++) {
    const sourceRow = y + row
    if (sourceRow < 0 || sourceRow >= image.height)
      continue
    for (let column = 0; column < width; column++) {
      const sourceColumn = x + column
      if (sourceColumn < 0 || sourceColumn >= image.width)
        continue
      const si = (sourceRow * image.width + sourceColumn) * 4
      const oi = (row * width + column) * 4
      out.data[oi] = image.data[si]!
      out.data[oi + 1] = image.data[si + 1]!
      out.data[oi + 2] = image.data[si + 2]!
      out.data[oi + 3] = image.data[si + 3]!
    }
  }
  return out
}

/**
 * Resample to exactly `width` x `height`, averaging every source pixel a
 * target pixel covers, on premultiplied colour. Averaging is the right filter
 * for shrinking a supersampled render: no ringing at a hard edge, and no dark
 * fringe from the black of transparent pixels.
 */
function areaResample(source: ImageData, width: number, height: number): ImageData {
  if (width >= source.width && height >= source.height && (width > source.width || height > source.height))
    return upscale(source, width, height)

  const premultiplied = new Float32Array(source.width * source.height * 4)
  for (let i = 0; i < source.width * source.height; i++) {
    const a = source.data[i * 4 + 3]! / 255
    premultiplied[i * 4] = source.data[i * 4]! * a
    premultiplied[i * 4 + 1] = source.data[i * 4 + 1]! * a
    premultiplied[i * 4 + 2] = source.data[i * 4 + 2]! * a
    premultiplied[i * 4 + 3] = a
  }

  const pass = (input: Float32Array, inWidth: number, inHeight: number, outWidth: number, outHeight: number, horizontal: boolean): Float32Array => {
    const output = new Float32Array(outWidth * outHeight * 4)
    const inLength = horizontal ? inWidth : inHeight
    const outLength = horizontal ? outWidth : outHeight
    const ratio = inLength / outLength
    const lines = horizontal ? inHeight : inWidth
    for (let o = 0; o < outLength; o++) {
      const start = o * ratio
      const end = start + ratio
      const first = Math.floor(start)
      const last = Math.min(inLength - 1, Math.ceil(end) - 1)
      for (let line = 0; line < lines; line++) {
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        for (let i = first; i <= last; i++) {
          const weight = Math.min(end, i + 1) - Math.max(start, i)
          if (weight <= 0)
            continue
          const index = (horizontal ? line * inWidth + i : i * inWidth + line) * 4
          r += input[index]! * weight
          g += input[index + 1]! * weight
          b += input[index + 2]! * weight
          a += input[index + 3]! * weight
        }
        const target = (horizontal ? line * outWidth + o : o * outWidth + line) * 4
        output[target] = r / ratio
        output[target + 1] = g / ratio
        output[target + 2] = b / ratio
        output[target + 3] = a / ratio
      }
    }
    return output
  }

  const across = pass(premultiplied, source.width, source.height, width, source.height, true)
  const down = pass(across, width, source.height, width, height, false)
  const out = blank(width, height)
  for (let i = 0; i < width * height; i++) {
    const a = down[i * 4 + 3]!
    if (a <= 0)
      continue
    out.data[i * 4] = Math.min(255, Math.round(down[i * 4]! / a))
    out.data[i * 4 + 1] = Math.min(255, Math.round(down[i * 4 + 1]! / a))
    out.data[i * 4 + 2] = Math.min(255, Math.round(down[i * 4 + 2]! / a))
    out.data[i * 4 + 3] = Math.min(255, Math.round(a * 255))
  }
  return out
}

/** Enlarge a bitmap logo smaller than its target, premultiplied so its edges stay clean. */
function upscale(source: ImageData, width: number, height: number): ImageData {
  const premultiplied = blank(source.width, source.height)
  for (let i = 0; i < source.data.length; i += 4) {
    const a = source.data[i + 3]! / 255
    premultiplied.data[i] = Math.round(source.data[i]! * a)
    premultiplied.data[i + 1] = Math.round(source.data[i + 1]! * a)
    premultiplied.data[i + 2] = Math.round(source.data[i + 2]! * a)
    premultiplied.data[i + 3] = source.data[i + 3]!
  }
  const scaled = resize(premultiplied, { width, height, fit: 'fill' })
  for (let i = 0; i < scaled.data.length; i += 4) {
    const a = scaled.data[i + 3]!
    if (a === 0)
      continue
    scaled.data[i] = Math.min(255, Math.round((scaled.data[i]! * 255) / a))
    scaled.data[i + 1] = Math.min(255, Math.round((scaled.data[i + 1]! * 255) / a))
    scaled.data[i + 2] = Math.min(255, Math.round((scaled.data[i + 2]! * 255) / a))
  }
  return scaled
}

/** Coverage of a pixel by a shape mask, anti-aliased over one pixel. */
function maskShape(image: ImageData, shape: 'rounded' | 'circle'): void {
  const { width, height } = image
  const radius = shape === 'circle' ? Math.min(width, height) / 2 : Math.min(width, height) * 0.2237
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = Math.abs(x + 0.5 - width / 2) - (width / 2 - radius)
      const dy = Math.abs(y + 0.5 - height / 2) - (height / 2 - radius)
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius
      const coverage = Math.max(0, Math.min(1, 0.5 - outside))
      if (coverage >= 1)
        continue
      const index = (y * width + x) * 4 + 3
      image.data[index] = Math.round(image.data[index]! * coverage)
    }
  }
}

function repaint(image: ImageData, color: RGBA): void {
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = color.r
    image.data[i + 1] = color.g
    image.data[i + 2] = color.b
  }
}

/** The alpha-weighted mean colour of an image. */
function meanColor(image: ImageData): RGBA | null {
  let r = 0
  let g = 0
  let b = 0
  let weight = 0
  for (let i = 0; i < image.data.length; i += 4) {
    const a = image.data[i + 3]! / 255
    r += image.data[i]! * a
    g += image.data[i + 1]! * a
    b += image.data[i + 2]! * a
    weight += a
  }
  return weight > 0 ? { r: r / weight, g: g / weight, b: b / weight, a: 1 } : null
}

/** A deterministic 0-1 value per pixel, so dithering is the same on every run. */
function noise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * A soft elliptical glow, `color` at `peak` opacity in the middle, fading to
 * fully transparent at the radius with no edge. Dithered, because a faint
 * gradient over a few hundred pixels otherwise shows its 8-bit steps.
 */
function paintGlow(target: ImageData, cx: number, cy: number, radiusX: number, radiusY: number, color: RGBA, peak: number): void {
  const glow = blank(target.width, target.height)
  const left = Math.max(0, Math.floor(cx - radiusX))
  const right = Math.min(target.width, Math.ceil(cx + radiusX))
  const top = Math.max(0, Math.floor(cy - radiusY))
  const bottom = Math.min(target.height, Math.ceil(cy + radiusY))
  for (let y = top; y < bottom; y++) {
    const dy = (y + 0.5 - cy) / radiusY
    for (let x = left; x < right; x++) {
      const dx = (x + 0.5 - cx) / radiusX
      const d2 = dx * dx + dy * dy
      if (d2 >= 1)
        continue
      // (1 - d²)³ eases out of the middle and into the edge, with no slope
      // left at the radius for a seam to show.
      const falloff = (1 - d2) ** 3
      const alpha = Math.min(255, Math.floor(peak * falloff * 255 + noise(x, y)))
      if (alpha <= 0)
        continue
      const index = (y * glow.width + x) * 4
      glow.data[index] = color.r
      glow.data[index + 1] = color.g
      glow.data[index + 2] = color.b
      glow.data[index + 3] = alpha
    }
  }
  over(target, glow, 0, 0)
}

// --------------------------------------------------------------------------
// The logo
// --------------------------------------------------------------------------

interface LogoRenderer {
  /** Width over height, of the trimmed logo. */
  aspect: number
  /** The size the logo states, in points, for `size: 'intrinsic'`. */
  intrinsic: { width: number, height: number }
  render: (width: number, height: number) => ImageData
}

function isSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 1024))).trimStart().toLowerCase()
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')) || (head.startsWith('<!--') && head.includes('<svg'))
}

async function readSource(source: SplashSource): Promise<Uint8Array | ImageData> {
  if (typeof source === 'string')
    return new Uint8Array(await readFile(source))
  return source
}

/** The largest side a logo is rasterised at before it is averaged down. */
const MAX_RENDER = 6144

async function logoRenderer(source: SplashSource, colorScheme: SplashAppearanceName, trim: boolean, sourceScale: number): Promise<LogoRenderer> {
  const input = await readSource(source)

  if (input instanceof Uint8Array && isSvg(input)) {
    const root = parseSVG(new TextDecoder().decode(input), { colorScheme }) as SVGRoot
    const intrinsicWidth = root.width || root.viewBox?.width || 0
    const intrinsicHeight = root.height || root.viewBox?.height || 0
    if (!(intrinsicWidth > 0 && intrinsicHeight > 0))
      throw new Error('ts-images: the splash logo SVG has no width, height or viewBox to size it by')
    const aspectFull = intrinsicWidth / intrinsicHeight

    // Where the drawing sits inside its canvas, as fractions, found once on a
    // reference render, so every scale crops the same margin.
    let box = { x: 0, y: 0, width: 1, height: 1 }
    if (trim) {
      const referenceWidth = aspectFull >= 1 ? 1024 : Math.round(1024 * aspectFull)
      const referenceHeight = aspectFull >= 1 ? Math.round(1024 / aspectFull) : 1024
      const reference = rasterize(root, { width: referenceWidth, height: referenceHeight })
      const bounds = opaqueBounds({ ...reference, colorSpace: 'srgb', hasAlpha: true, bitDepth: 8 } as ImageData, 1)
      if (!bounds)
        throw new Error('ts-images: the splash logo SVG draws nothing')
      box = { x: bounds.x / referenceWidth, y: bounds.y / referenceHeight, width: bounds.width / referenceWidth, height: bounds.height / referenceHeight }
    }

    return {
      aspect: (aspectFull * box.width) / box.height,
      intrinsic: { width: intrinsicWidth * box.width, height: intrinsicHeight * box.height },
      render(width, height) {
        // Three times the target, averaged down: smoother edges than the
        // rasteriser's own anti-aliasing, and never more than MAX_RENDER.
        const supersample = Math.max(1, Math.min(3, MAX_RENDER / (Math.max(width / box.width, height / box.height))))
        const fullWidth = Math.max(1, Math.round((width / box.width) * supersample))
        const fullHeight = Math.max(1, Math.round((height / box.height) * supersample))
        const frame = rasterize(root, { width: fullWidth, height: fullHeight })
        const full = { ...frame, colorSpace: 'srgb', hasAlpha: true, bitDepth: 8 } as ImageData
        const cropped = crop(full, Math.floor(box.x * fullWidth), Math.floor(box.y * fullHeight), Math.max(1, Math.round(box.width * fullWidth)), Math.max(1, Math.round(box.height * fullHeight)))
        return areaResample(cropped, width, height)
      },
    }
  }

  const decoded = input instanceof Uint8Array ? await decode(input) : input
  const bounds = trim ? opaqueBounds(decoded) : { x: 0, y: 0, width: decoded.width, height: decoded.height }
  if (!bounds)
    throw new Error('ts-images: the splash logo is fully transparent')
  const trimmed = trim ? crop(decoded, bounds.x, bounds.y, bounds.width, bounds.height) : decoded
  return {
    aspect: trimmed.width / trimmed.height,
    intrinsic: { width: trimmed.width / sourceScale, height: trimmed.height / sourceScale },
    render: (width, height) => areaResample(trimmed, width, height),
  }
}

// --------------------------------------------------------------------------
// Layout
// --------------------------------------------------------------------------

interface ResolvedAppearance {
  name: SplashAppearanceName
  background: Required<RGBA>
  logo: LogoRenderer
  /** The colour the logo is repainted in, if any. */
  tint?: RGBA
  glow?: { color: RGBA, peak: number }
  textColor: RGBA
}

interface ResolvedText {
  value: string
  font: Font
  size: number
  letterSpacing: number
  gap: number
  /** The text's ink box at 1 point per pixel, measured from a 4x render. */
  width: number
  height: number
}

interface Layout {
  /** The logo's drawn size, in points. */
  logoWidth: number
  logoHeight: number
  /** Everything drawn (logo, gap, text), in points. */
  contentWidth: number
  contentHeight: number
  /** The launch image, in points: the content and room for the glow, centred. */
  imageWidth: number
  imageHeight: number
  glowRadiusX: number
  glowRadiusY: number
  text?: ResolvedText
}

async function resolveFont(font: SplashText['font']): Promise<Font> {
  if (typeof font === 'string')
    return loadFont(new Uint8Array(await readFile(font)), { warnOnVariable: false })
  if (font instanceof Uint8Array)
    return loadFont(font, { warnOnVariable: false })
  return font
}

/** The text drawn in `color` at `scale`, cropped to its ink. */
function renderText(text: Omit<ResolvedText, 'width' | 'height'>, scale: number, color: RGBA): ImageData {
  const size = text.size * scale
  const metrics = layoutText({ text: text.value, font: text.font, size, letterSpacing: text.letterSpacing })
  const pad = Math.ceil(size)
  // Filled with the text's own colour at zero opacity, so the anti-aliased
  // edge keeps the colour instead of fading through black.
  const canvas = createImageData(Math.ceil(metrics.width) + pad * 2, Math.ceil(size * 2) + pad * 2, { fill: { r: color.r, g: color.g, b: color.b, a: 0 } })
  drawText(canvas, { text: text.value, font: text.font, size, x: pad, y: pad + size * 1.2, color: { r: color.r, g: color.g, b: color.b }, letterSpacing: text.letterSpacing })
  const bounds = opaqueBounds(canvas, 1)
  return bounds ? crop(canvas, bounds.x, bounds.y, bounds.width, bounds.height) : blank(1, 1)
}

async function resolveText(text: SplashText | undefined, opticalSize: number): Promise<ResolvedText | undefined> {
  if (!text?.value?.trim())
    return undefined
  const uppercase = text.uppercase ?? false
  const size = text.size ?? Math.max(12, Math.round(opticalSize * 0.15))
  const resolved = {
    value: uppercase ? text.value.toUpperCase() : text.value,
    font: await resolveFont(text.font),
    size,
    letterSpacing: text.letterSpacing ?? (uppercase ? 0.14 : 0.02),
    gap: text.gap ?? Math.round(size * 0.45 + 8),
  }
  const probe = renderText(resolved, 4, { r: 0, g: 0, b: 0 })
  return { ...resolved, width: probe.width / 4, height: probe.height / 4 }
}

function layout(options: SplashOptions, logo: LogoRenderer, text: ResolvedText | undefined, glow: boolean): Layout {
  const maxWidth = options.maxWidth ?? 240
  const maxHeight = options.maxHeight ?? 128
  let logoWidth: number
  let logoHeight: number
  if (options.size === 'intrinsic') {
    logoWidth = logo.intrinsic.width
    logoHeight = logo.intrinsic.height
  }
  else {
    const optical = options.size ?? SPLASH_LOGO_SIZE
    logoWidth = optical * Math.sqrt(logo.aspect)
    logoHeight = optical / Math.sqrt(logo.aspect)
    const fit = Math.min(1, maxWidth / logoWidth, maxHeight / logoHeight)
    logoWidth *= fit
    logoHeight *= fit
  }

  const contentWidth = Math.max(logoWidth, text?.width ?? 0)
  const contentHeight = logoHeight + (text ? text.gap + text.height : 0)
  const reach = Math.max(contentWidth, contentHeight)
  const glowRadiusX = glow ? Math.min(180, reach * 0.55 + 44) : 0
  const glowRadiusY = glow ? Math.max(glowRadiusX * 0.8, contentHeight / 2 + 24) : 0
  return {
    logoWidth,
    logoHeight,
    contentWidth,
    contentHeight,
    imageWidth: Math.ceil(Math.max(contentWidth, glowRadiusX * 2)),
    imageHeight: Math.ceil(Math.max(contentHeight, glowRadiusY * 2)),
    glowRadiusX,
    glowRadiusY,
    text,
  }
}

/** A whole number of pixels with the same parity as `room`, so the part centres on a whole pixel. */
function centredPixels(size: number, room: number): number {
  let pixels = Math.max(1, Math.round(size))
  if ((room - pixels) % 2 !== 0)
    pixels += pixels + 1 <= room ? 1 : -1
  return Math.max(1, pixels)
}

/**
 * Draw the mark (glow, logo, text) centred on (cx, cy) of `canvas`, at
 * `scale` pixels per point, its content shrunk by `fit`.
 */
function paintMark(canvas: ImageData, cx: number, cy: number, scale: number, fit: number, geometry: Layout, appearance: ResolvedAppearance, shape: SplashOptions['shape'], glow: { radiusX: number, radiusY: number } | null): void {
  if (glow && appearance.glow)
    paintGlow(canvas, cx, cy, glow.radiusX * scale, glow.radiusY * scale, appearance.glow.color, appearance.glow.peak)

  const contentHeight = geometry.contentHeight * fit * scale
  const top = cy - contentHeight / 2

  const logoWidth = centredPixels(geometry.logoWidth * fit * scale, canvas.width)
  const logoHeight = Math.max(1, Math.round(geometry.logoHeight * fit * scale))
  const logo = appearance.logo.render(logoWidth, logoHeight)
  if (shape === 'rounded' || shape === 'circle')
    maskShape(logo, shape)
  if (appearance.tint)
    repaint(logo, appearance.tint)
  over(canvas, logo, Math.round(cx - logoWidth / 2), Math.round(top))

  if (geometry.text) {
    const text = renderText(geometry.text, scale * fit, appearance.textColor)
    const y = top + (geometry.logoHeight + geometry.text.gap) * fit * scale
    over(canvas, text, Math.round(cx - text.width / 2), Math.round(y))
  }
}

async function resolveAppearances(options: SplashOptions): Promise<ResolvedAppearance[]> {
  const intrinsic = options.size === 'intrinsic'
  const trim = options.trim ?? !intrinsic
  const sourceScale = options.sourceScale ?? 1
  const strength = Math.max(0, options.glowStrength ?? 1)
  const wanted: Array<[SplashAppearanceName, SplashAppearance]> = [['light', options.light ?? {}]]
  if (options.dark !== false)
    wanted.push(['dark', options.dark ?? {}])

  const shared = new Map<SplashSource, Promise<LogoRenderer>>()
  const out: ResolvedAppearance[] = []
  for (const [name, look] of wanted) {
    const background = rgba(look.background ?? (name === 'dark' ? '#000000' : '#ffffff'))
    const source = look.logo ?? options.logo
    // The shared logo renders once per colour scheme, since an SVG may answer
    // `prefers-color-scheme` itself.
    const key = look.logo ? source : `${name}` as unknown as SplashSource
    if (!shared.has(key))
      shared.set(key, logoRenderer(source, name, trim, sourceScale))
    const logo = await shared.get(key)!

    // The logo's own colour, from a small render, decides whether it reads on
    // the background and what the glow and the text are tinted.
    const sample = logo.render(Math.max(8, Math.round(64 * Math.sqrt(logo.aspect))), Math.max(8, Math.round(64 / Math.sqrt(logo.aspect))))
    const own = meanColor(sample) ?? { r: 128, g: 128, b: 128, a: 1 }
    let tint = look.tint ? rgba(look.tint) : undefined
    if (!tint && options.shape !== 'rounded' && options.shape !== 'circle' && contrast(own, background) < 1.6)
      tint = luminance(background) > 0.4 ? { r: 15, g: 23, b: 42, a: 1 } : { r: 248, g: 250, b: 252, a: 1 }
    const ink = tint ?? own

    let glow: ResolvedAppearance['glow']
    if (options.glow !== false && look.glow !== false && strength > 0) {
      const color = look.glow ? rgba(look.glow) : options.accent ? rgba(options.accent) : ink
      const dark = luminance(background) < 0.4
      // A saturated colour carries further than a grey before it looks like
      // haze, and a glow on white has to be fainter than one on black to look
      // as soft.
      const base = dark ? 0.1 + 0.22 * saturation(color) : 0.06 + 0.08 * saturation(color)
      glow = { color, peak: Math.min(0.9, base * strength) }
    }

    const textColor = look.textColor ? rgba(look.textColor) : mix(ink, background, 0.28)
    out.push({ name, background, logo, tint, glow, textColor })
  }
  return out
}

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------

/** The image set's `Contents.json` for the launch images `renderSplashScreens` makes. */
export function splashImageSetContents(appearances: SplashAppearanceName[] = ['light', 'dark']): string {
  const images = appearances.flatMap(appearance => IOS_SPLASH_SCALES.map(scale => ({
    ...(appearance === 'dark' ? { appearances: [{ appearance: 'luminosity', value: 'dark' }] } : {}),
    filename: `${IOS_SPLASH_IMAGE}${appearance === 'dark' ? '-dark' : ''}${scale === 1 ? '' : `@${scale}x`}.png`,
    idiom: 'universal',
    scale: `${scale}x`,
  })))
  return `${JSON.stringify({ images, info: { author: 'ts-images', version: 1 } }, null, 2)}\n`
}


interface PreparedAppearance {
  appearance: ResolvedAppearance
  geometry: Layout
  glow: { radiusX: number, radiusY: number } | null
}

/** Every appearance resolved and laid out, once, for the images and the preview alike. */
async function prepare(options: SplashOptions): Promise<PreparedAppearance[]> {
  const appearances = await resolveAppearances(options)
  const glow = options.glow !== false && appearances.some(appearance => appearance.glow)
  const first = appearances[0]!.logo.intrinsic
  const opticalSize = options.size === 'intrinsic' ? Math.sqrt(first.width * first.height) : options.size ?? SPLASH_LOGO_SIZE
  const text = await resolveText(options.text, opticalSize)
  return appearances.map((appearance) => {
    const geometry = layout(options, appearance.logo, text, glow)
    return { appearance, geometry, glow: glow ? { radiusX: geometry.glowRadiusX, radiusY: geometry.glowRadiusY } : null }
  })
}

/** The launch image at `scale` pixels per point: the mark centred, transparent around it. */
function renderMark({ appearance, geometry, glow }: PreparedAppearance, scale: number, shape: SplashOptions['shape']): ImageData {
  const width = Math.round(geometry.imageWidth * scale)
  const height = Math.round(geometry.imageHeight * scale)
  const canvas = blank(width, height)
  paintMark(canvas, width / 2, height / 2, scale, 1, geometry, appearance, shape, glow)
  return canvas
}

/**
 * Every launch image a platform needs, in memory: nothing is written, so a
 * build can put them wherever its project keeps them.
 *
 * iOS gets `LaunchLogo.imageset/LaunchLogo.png`, `@2x` and `@3x` (and the
 * `-dark` set): the mark at its size in points, which the launch screen and
 * the splash draw centred on the background colour. Android gets
 * `res/drawable-<density>/splash_logo.png`, the same mark per density for the
 * window background before Android 12, and `splash_icon.png`, Android 12's
 * 288dp splash icon with the mark inside its 192dp circle; dark ones go in
 * `drawable-night-<density>`.
 *
 * @example
 * ```ts
 * const images = await renderSplashScreens({
 *   logo: 'public/logo.svg',
 *   accent: '#dd0f15',
 *   light: { background: '#ffffff' },
 *   dark: { background: '#000000' },
 * })
 * for (const image of images) await Bun.write(`out/${image.platform}/${image.path}`, image.bytes)
 * ```
 */
export async function renderSplashScreens(options: SplashOptions): Promise<RenderedSplash[]> {
  const platforms = options.platforms ?? ['ios', 'android']
  const out: RenderedSplash[] = []

  for (const prepared of await prepare(options)) {
    const { appearance, geometry } = prepared
    const suffix = appearance.name === 'dark' ? '-dark' : ''
    const push = async (platform: SplashPlatform, path: string, kind: RenderedSplash['kind'], scale: number, image: ImageData) => {
      out.push({ platform, path, appearance: appearance.name, kind, scale, width: image.width, height: image.height, bytes: await encode(image, 'png') })
    }

    if (platforms.includes('ios')) {
      for (const scale of IOS_SPLASH_SCALES)
        await push('ios', `${IOS_SPLASH_IMAGE}.imageset/${IOS_SPLASH_IMAGE}${suffix}${scale === 1 ? '' : `@${scale}x`}.png`, 'logo', scale, renderMark(prepared, scale, options.shape))
    }

    if (platforms.includes('android')) {
      const folder = (density: string) => `res/drawable${appearance.name === 'dark' ? '-night' : ''}-${density}`
      // Android 12 masks its splash icon to a circle: the content is shrunk
      // to sit inside it with a margin, and the glow ends inside it too.
      const safe = (ANDROID_SPLASH_SAFE_DP / 2) * 0.92
      const fit = Math.min(1, safe / Math.hypot(geometry.contentWidth / 2, geometry.contentHeight / 2))
      const radius = (ANDROID_SPLASH_SAFE_DP / 2) * 0.96
      for (const { density, scale } of ANDROID_SPLASH_DENSITIES) {
        await push('android', `${folder(density)}/splash_logo.png`, 'logo', scale, renderMark(prepared, scale, options.shape))
        const edge = Math.round(ANDROID_SPLASH_ICON_DP * scale)
        const icon = blank(edge, edge)
        paintMark(icon, edge / 2, edge / 2, scale, fit, geometry, appearance, options.shape, prepared.glow ? { radiusX: radius, radiusY: radius } : null)
        await push('android', `${folder(density)}/splash_icon.png`, 'icon', scale, icon)
      }
    }
  }
  return out
}

/**
 * Write the launch images under `outputDir`: `ios/LaunchLogo.imageset/` with
 * its `Contents.json`, and `android/res/drawable-*`.
 *
 * The answer names what a build hands on: `ios.image` and `ios.imageDark`
 * (the `@1x` files, with `@2x` and `@3x` beside them, as Craft's
 * `splashImagePath` takes them), `android.resources` (Craft's
 * `splashResources`) and the background colours the images were made for.
 */
export async function generateSplashScreens(options: SplashOptions, outputDir: string): Promise<SplashScreenResult> {
  const root = resolve(outputDir)
  const platforms = options.platforms ?? ['ios', 'android']
  const files: SplashScreenResult['files'] = []
  for (const { bytes, ...image } of await renderSplashScreens(options)) {
    const path = join(root, image.platform, image.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
    files.push({ ...image, path })
  }

  const dark = options.dark !== false
  const result: SplashScreenResult = {
    files,
    backgrounds: {
      light: hex(rgba(options.light?.background ?? '#ffffff')),
      ...(dark ? { dark: hex(rgba((options.dark || {}).background ?? '#000000')) } : {}),
    },
  }
  if (platforms.includes('ios')) {
    const imageset = join(root, 'ios', `${IOS_SPLASH_IMAGE}.imageset`)
    await writeFile(join(imageset, 'Contents.json'), splashImageSetContents(dark ? ['light', 'dark'] : ['light']))
    result.ios = {
      imageset,
      image: join(imageset, `${IOS_SPLASH_IMAGE}.png`),
      ...(dark ? { imageDark: join(imageset, `${IOS_SPLASH_IMAGE}-dark.png`) } : {}),
    }
  }
  if (platforms.includes('android'))
    result.android = { resources: join(root, 'android', 'res') }
  return result
}

export interface SplashPreviewOptions {
  /** A device from `SPLASH_PREVIEW_DEVICES`, or its screen in pixels and pixels per point. Default `iphone-16-pro`. */
  device?: SplashPreviewDevice | { width: number, height: number, scale: number }
  appearance?: SplashAppearanceName
}

/**
 * The launch screen as a device shows it, as one PNG: the background colour,
 * and the launch image centred at the device's scale. For reviewing a splash
 * before it is built into an app, and for checking that nothing is cut off.
 */
export async function renderSplashPreview(options: SplashOptions, preview: SplashPreviewOptions = {}): Promise<Uint8Array> {
  const device = typeof preview.device === 'object' ? preview.device : SPLASH_PREVIEW_DEVICES[preview.device ?? 'iphone-16-pro']
  const all = await prepare(options)
  const prepared = all.find(item => item.appearance.name === (preview.appearance ?? 'light')) ?? all[0]!
  const { r, g, b } = prepared.appearance.background
  const screen = createImageData(device.width, device.height, { fill: { r, g, b, a: 255 } })
  // The launch image is a whole number of pixels drawn at the screen's
  // centre, as UIKit places it.
  const image = renderMark(prepared, device.scale, options.shape)
  over(screen, image, Math.round((device.width - image.width) / 2), Math.round((device.height - image.height) / 2))
  return encode(screen, 'png')
}
