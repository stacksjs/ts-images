import type { ImageData } from './core/image-data'
import type { Font } from './font'
import type { DropShadowOptions } from './paint'
import type { SurfaceBackground } from './surface'
import type { RGBA } from './text'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decode, encode } from './codecs'
import { drawImage, dropShadow } from './paint'
import { createSurface } from './surface'
import { drawText, fillRoundedRect, layoutText } from './text'
import { debugLog } from './utils'

/**
 * Composed App Store screenshots.
 *
 * A store listing is a slideshow, not a single picture: each slot is one
 * claim about the product, and a listing carrying one screenshot forfeits the
 * other nine. Producing ten of them by hand — per device class, per release,
 * with the copy kept in step — is why listings end up with one.
 *
 * So the input here is a list of slides and a list of device classes, and the
 * output is every combination at Apple's exact pixel dimensions. The raw
 * product capture comes from whatever can drive the app; the framing, the
 * headline, the background, and the resampling to a device's dimensions
 * happen here, which is what makes a new device class a one-line change
 * rather than a new set of captures.
 */

/**
 * The `screenshotDisplayType` values App Store Connect accepts for an app
 * shipping on iPhone, iPad, and Mac.
 *
 * Sizes are the ones Apple documents as the accepted upload dimensions for
 * each class. Apple accepts more than one size for several classes; the
 * larger is used, because a store screenshot is downsampled for display and
 * never upsampled.
 */
export type AppStoreDisplayType =
  | 'APP_IPHONE_67'
  | 'APP_IPHONE_65'
  | 'APP_IPHONE_61'
  | 'APP_IPHONE_58'
  | 'APP_IPHONE_55'
  | 'APP_IPAD_PRO_3GEN_129'
  | 'APP_IPAD_PRO_3GEN_11'
  | 'APP_IPAD_PRO_129'
  | 'APP_IPAD_105'
  | 'APP_IPAD_97'
  | 'APP_DESKTOP'

export interface AppStoreDisplaySize {
  width: number
  height: number
}

export const APP_STORE_DISPLAY_SIZES: Record<AppStoreDisplayType, AppStoreDisplaySize> = {
  APP_IPHONE_67: { width: 1290, height: 2796 },
  APP_IPHONE_65: { width: 1242, height: 2688 },
  APP_IPHONE_61: { width: 1179, height: 2556 },
  APP_IPHONE_58: { width: 1125, height: 2436 },
  APP_IPHONE_55: { width: 1242, height: 2208 },
  APP_IPAD_PRO_3GEN_129: { width: 2048, height: 2732 },
  APP_IPAD_PRO_3GEN_11: { width: 1668, height: 2388 },
  APP_IPAD_PRO_129: { width: 2048, height: 2732 },
  APP_IPAD_105: { width: 1668, height: 2224 },
  APP_IPAD_97: { width: 1536, height: 2048 },
  APP_DESKTOP: { width: 2880, height: 1800 },
}

/** Apple rejects a screenshot set larger than this. */
export const APP_STORE_MAX_SCREENSHOTS = 10

export interface AppStoreSlide {
  /**
   * The product capture this slide is built around: a screenshot of the app
   * itself, at whatever size it was captured. It is resampled to fit.
   */
  capture: string
  /** The claim. Wrapped, and capped at `headlineLines`. */
  headline: string
  /** One supporting line under the headline. */
  subheadline?: string
  /** Overrides the set-wide background for this slide alone. */
  background?: SurfaceBackground
}

export interface AppStoreDeviceOptions {
  /** Corner radius as a fraction of the capture's drawn width. @default 0.045 */
  radius?: number
  /** Hairline drawn around the capture. Omit for none. */
  borderColor?: RGBA
  /** Shadow cast by the capture. Omit for none. */
  shadow?: Omit<DropShadowOptions, 'blur'> & { blur?: number }
  /**
   * Fraction of the canvas the capture is allowed to occupy along its
   * governing axis — width in a stacked layout, height beside the copy.
   */
  scale?: number
}

export type AppStoreLayout = 'auto' | 'stacked' | 'beside'

export interface AppStoreScreenshotOptions {
  slides: AppStoreSlide[]
  /** Device classes to render. Every slide is rendered for every class. */
  displayTypes: AppStoreDisplayType[]
  outputDir: string
  /** Bold face, used for the wordmark and headlines. */
  titleFont: Font
  /** Face for subheadlines. Falls back to `titleFont`. */
  bodyFont?: Font
  /** Wordmark drawn under the copy block. */
  brand?: string
  /**
   * Paint the logo mark above the headline. As on a social card, the library
   * supplies the position and the plate and hands back the box, because it
   * cannot know what a mark looks like.
   */
  drawMark?: (canvas: ImageData, box: { x: number, y: number, size: number }) => void
  /** Plate painted behind the mark. Omit to draw the mark onto the background. */
  markPlate?: RGBA
  background?: SurfaceBackground
  /** Headline and wordmark colour. */
  color?: RGBA
  /** Subheadline colour. Defaults to a dimmed `color`. */
  mutedColor?: RGBA
  device?: AppStoreDeviceOptions
  /**
   * `auto` puts the copy beside the capture on a landscape canvas and above
   * it on a portrait one, which is the only arrangement that reads at both
   * 2880x1800 and 1290x2796.
   */
  layout?: AppStoreLayout
  headlineLines?: number
  format?: 'png' | 'jpeg'
  quality?: number
  /**
   * Names the file for a slide. Defaults to `<display-type>-01.png`, lower
   * cased with underscores turned into hyphens.
   */
  fileName?: (displayType: AppStoreDisplayType, index: number, slide: AppStoreSlide) => string
}

/**
 * Render every slide for every display type.
 *
 * Returns the written paths keyed by display type, in slide order — the shape
 * App Store Connect's screenshot sets are declared in, so the result can be
 * handed to an upload step without rearranging.
 */
export async function generateAppStoreScreenshots(
  options: AppStoreScreenshotOptions,
): Promise<Record<string, string[]>> {
  if (!options.slides.length)
    throw new TypeError('At least one slide is required')
  if (options.slides.length > APP_STORE_MAX_SCREENSHOTS)
    throw new TypeError(`App Store screenshot sets accept at most ${APP_STORE_MAX_SCREENSHOTS} images`)
  if (!options.displayTypes.length)
    throw new TypeError('At least one display type is required')

  await mkdir(options.outputDir, { recursive: true })

  const format = options.format ?? 'png'
  const extension = format === 'jpeg' ? 'jpg' : format
  const name = options.fileName ?? ((displayType: AppStoreDisplayType, index: number): string =>
    `${displayType.toLowerCase().replace(/_/g, '-')}-${String(index + 1).padStart(2, '0')}.${extension}`)

  // Captures are decoded once and reused across every device class: the same
  // popup PNG is the source for the iPhone, iPad and Mac renders, and
  // decoding it per device is the bulk of the work otherwise.
  const captures = new Map<string, ImageData>()
  for (const slide of options.slides) {
    if (!captures.has(slide.capture))
      captures.set(slide.capture, await decode(new Uint8Array(await readFile(slide.capture))))
  }

  const results: Record<string, string[]> = {}

  for (const displayType of options.displayTypes) {
    const size = APP_STORE_DISPLAY_SIZES[displayType]
    if (!size)
      throw new TypeError(`Unknown App Store display type: ${displayType}`)

    results[displayType] = []

    for (const [index, slide] of options.slides.entries()) {
      const canvas = await composeSlide(slide, captures.get(slide.capture)!, size, options)
      const path = join(options.outputDir, name(displayType, index, slide))
      await writeFile(path, await encode(canvas, format, { quality: options.quality ?? 92 }))
      results[displayType].push(path)
      debugLog('app-store', `Wrote ${path} (${size.width}x${size.height})`)
    }
  }

  return results
}

/**
 * Render one slide at one size.
 *
 * Exposed separately because a listing sometimes needs a single odd frame —
 * a localized variant, a promotional image at a size Apple does not list —
 * and the whole composition is worth reaching for without the fan-out.
 */
export async function generateAppStoreScreenshot(
  outputPath: string,
  size: { width: number, height: number },
  slide: AppStoreSlide,
  options: Omit<AppStoreScreenshotOptions, 'slides' | 'displayTypes' | 'outputDir' | 'fileName'>,
): Promise<string> {
  const capture = await decode(new Uint8Array(await readFile(slide.capture)))
  const canvas = await composeSlide(slide, capture, size, options)
  const format = options.format ?? 'png'
  await writeFile(outputPath, await encode(canvas, format, { quality: options.quality ?? 92 }))
  return outputPath
}

async function composeSlide(
  slide: AppStoreSlide,
  capture: ImageData,
  size: { width: number, height: number },
  options: Omit<AppStoreScreenshotOptions, 'slides' | 'displayTypes' | 'outputDir' | 'fileName'>,
): Promise<ImageData> {
  const { width, height } = size
  const color = options.color ?? { r: 251, g: 243, b: 243 }
  const muted = options.mutedColor ?? { r: color.r, g: color.g, b: color.b, a: 0.72 }
  const bodyFont = options.bodyFont ?? options.titleFont
  const background = slide.background ?? options.background ?? {}

  const canvas = await createSurface(width, height, { color: { r: 18, g: 11, b: 12 }, ...background })

  // A landscape canvas has room for a column of copy next to the capture; a
  // portrait one does not, and forcing the split there leaves the headline in
  // a 400px-wide gutter set over twenty lines.
  const beside = options.layout === 'beside'
    || (options.layout !== 'stacked' && width / height >= 1.2)

  const context: ComposeContext = { ...options, color, muted, bodyFont }

  const composed = beside
    ? await composeBeside(canvas, capture, slide, context)
    : await composeStacked(canvas, capture, slide, context)
  // App Store Connect rejects the channel itself, even if all alpha is 255.
  // Refuse a transparent composition rather than silently choosing a matte.
  for (let index = 3; index < composed.data.length; index += 4) {
    if (composed.data[index] !== 255)
      throw new TypeError('App Store screenshots need an opaque background')
  }
  composed.hasAlpha = false
  return composed
}

interface ComposeContext {
  color: RGBA
  muted: RGBA
  bodyFont: Font
  titleFont: Font
  brand?: string
  drawMark?: AppStoreScreenshotOptions['drawMark']
  markPlate?: RGBA
  device?: AppStoreDeviceOptions
  headlineLines?: number
}

/**
 * Draw the capture as a physical object: a hairline plate, the pixels masked
 * to rounded corners, and a shadow underneath.
 *
 * The hairline is a second rounded fill a pixel larger, painted first and
 * then covered — an outline stroke would have to match the mask's coverage
 * exactly along every corner to avoid a seam, and this does not.
 */
function placeCapture(
  canvas: ImageData,
  capture: ImageData,
  box: { x: number, y: number, width: number, height: number },
  device: AppStoreDeviceOptions | undefined,
  defaultBlur: number,
): void {
  const radius = (device?.radius ?? 0.045) * box.width
  const shadow = device?.shadow

  if (shadow !== undefined) {
    dropShadow(canvas, { ...box, radius }, {
      blur: shadow.blur ?? defaultBlur,
      offsetY: shadow.offsetY ?? box.width * 0.06,
      offsetX: shadow.offsetX,
      spread: shadow.spread,
      color: shadow.color ?? { r: 0, g: 0, b: 0, a: 0.5 },
    })
  }

  if (device?.borderColor) {
    const thickness = Math.max(1, Math.round(box.width * 0.0025))
    fillRoundedRect(canvas, {
      x: box.x - thickness,
      y: box.y - thickness,
      width: box.width + thickness * 2,
      height: box.height + thickness * 2,
      radius: radius + thickness,
    }, device.borderColor)
  }

  drawImage(canvas, capture, { ...box, fit: 'cover', position: 'top', radius })
}

/**
 * Copy on the left, capture on the right.
 *
 * The proportions come from the hand-written 1280x800 frame this replaces,
 * re-expressed as fractions of the canvas so a 2880x1800 Mac screenshot is
 * the same layout rather than the same layout at a third the size.
 */
function composeBeside(
  canvas: ImageData,
  capture: ImageData,
  slide: AppStoreSlide,
  context: ComposeContext,
): ImageData {
  const { width, height } = canvas
  const columnWidth = width * 0.46
  const padding = width * 0.069
  const measure = columnWidth - padding * 0.4

  // The copy is sized against the column it lives in, not the canvas: on a
  // landscape frame the canvas is twice as wide as the text is allowed to be,
  // and sizing against it puts three words on a line.
  const block = copyBlock(canvas, slide, context, columnWidth * 1.42, measure)
  block.draw(padding, Math.max(height * 0.06, (height - block.height) / 2))

  // The capture takes as much of its column as it can, held back only by a
  // margin and by a share of the canvas height. Sizing it off the column's
  // width alone shrinks a landscape capture — a dashboard is wide, and 70% of
  // a 46% column is a postage stamp on a 2880px frame.
  const stageLeft = columnWidth
  const stageWidth = width - stageLeft
  const margin = width * 0.05
  const aspect = capture.width / capture.height

  let captureWidth = stageWidth - margin * 2
  let captureHeight = captureWidth / aspect
  const heightBudget = height * (context.device?.scale ?? 0.8)
  if (captureHeight > heightBudget) {
    captureHeight = heightBudget
    captureWidth = captureHeight * aspect
  }

  const box = {
    x: Math.round(stageLeft + (stageWidth - captureWidth) / 2),
    y: Math.round((height - captureHeight) / 2),
    width: Math.round(captureWidth),
    height: Math.round(captureHeight),
  }

  placeCapture(canvas, capture, box, context.device, box.width * 0.22)

  return canvas
}

/**
 * A measured copy block: mark, headline, subheadline, wordmark.
 *
 * Measuring and drawing are separate because the stacked layout needs the
 * block's height to know where the capture starts, and the side-by-side one
 * needs it to centre the column — both before a pixel is drawn.
 */
interface CopyBlock {
  height: number
  draw: (x: number, top: number) => void
}

function copyBlock(
  canvas: ImageData,
  slide: AppStoreSlide,
  context: ComposeContext,
  scale: number,
  maxWidth: number,
): CopyBlock {
  const markSize = context.drawMark ? scale * 0.087 : 0
  const headlineSize = scale * 0.092
  const subheadlineSize = scale * 0.036
  const wordmarkSize = scale * 0.021
  const markGap = markSize ? scale * 0.05 : 0
  const subheadlineGap = slide.subheadline ? scale * 0.037 : 0
  const wordmarkGap = context.brand ? scale * 0.053 : 0

  const headline = layoutText({
    text: slide.headline,
    font: context.titleFont,
    size: headlineSize,
    maxWidth,
    lineHeight: 1.04,
    letterSpacing: -0.022,
    maxLines: context.headlineLines ?? 3,
  })

  const subheadline = slide.subheadline
    ? layoutText({
        text: slide.subheadline,
        font: context.bodyFont,
        size: subheadlineSize,
        maxWidth: maxWidth * 0.94,
        lineHeight: 1.42,
        maxLines: 3,
      })
    : undefined

  const height = markSize + markGap
    + headline.height
    + subheadlineGap + (subheadline?.height ?? 0)
    + wordmarkGap + (context.brand ? wordmarkSize : 0)

  const draw = (x: number, top: number): void => {
    let cursor = top

    if (context.drawMark && markSize) {
      if (context.markPlate) {
        const plate = markSize * 1.28
        const inset = (plate - markSize) / 2
        fillRoundedRect(canvas, { x, y: cursor, width: plate, height: plate, radius: plate * 0.24 }, context.markPlate)
        context.drawMark(canvas, { x: x + inset, y: cursor + inset, size: markSize })
      }
      else {
        context.drawMark(canvas, { x, y: cursor, size: markSize })
      }
      cursor += markSize + markGap
    }

    // `drawText` takes the baseline of the first line, not its top; the
    // ascender sits roughly 0.8 of the line box above it.
    drawText(canvas, {
      text: slide.headline,
      font: context.titleFont,
      size: headlineSize,
      x,
      y: cursor + headline.lineHeight * 0.78,
      color: context.color,
      maxWidth,
      lineHeight: 1.04,
      letterSpacing: -0.022,
      maxLines: context.headlineLines ?? 3,
    })
    cursor += headline.height

    if (subheadline && slide.subheadline) {
      cursor += subheadlineGap
      drawText(canvas, {
        text: slide.subheadline,
        font: context.bodyFont,
        size: subheadlineSize,
        x,
        y: cursor + subheadline.lineHeight * 0.74,
        color: context.muted,
        maxWidth: maxWidth * 0.94,
        lineHeight: 1.42,
        maxLines: 3,
      })
      cursor += subheadline.height
    }

    if (context.brand) {
      cursor += wordmarkGap
      drawText(canvas, {
        text: context.brand.toUpperCase(),
        font: context.titleFont,
        size: wordmarkSize,
        x,
        y: cursor + wordmarkSize,
        color: { ...context.color, a: 0.5 },
        letterSpacing: 0.16,
      })
    }
  }

  return { height, draw }
}

/** Copy above, capture below. The arrangement every portrait device gets. */
function composeStacked(
  canvas: ImageData,
  capture: ImageData,
  slide: AppStoreSlide,
  context: ComposeContext,
): ImageData {
  const { width, height } = canvas
  const padding = width * 0.105
  const block = copyBlock(canvas, slide, context, width, width - padding * 2)

  const top = height * 0.072
  block.draw(padding, top)

  // Everything left under the copy is the capture's, minus a foot margin so
  // the device does not run into the bottom edge of the frame.
  const stageTop = top + block.height + width * 0.075
  const stageHeight = height - stageTop - height * 0.05
  const aspect = capture.width / capture.height

  let captureWidth = width * (context.device?.scale ?? 0.78)
  let captureHeight = captureWidth / aspect
  if (captureHeight > stageHeight) {
    captureHeight = stageHeight
    captureWidth = captureHeight * aspect
  }

  const box = {
    x: Math.round((width - captureWidth) / 2),
    // Centred in what is left rather than pinned to the top of it: a capture
    // whose aspect ratio does not use the whole stage otherwise leaves all of
    // the slack in one block at the foot of the frame.
    y: Math.round(stageTop + (stageHeight - captureHeight) / 2),
    width: Math.round(captureWidth),
    height: Math.round(captureHeight),
  }

  placeCapture(canvas, capture, box, context.device, box.width * 0.14)

  return canvas
}
