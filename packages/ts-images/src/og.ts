import type { ImageData } from './core/image-data'
import type { Font } from './font'
import type { DropShadowOptions } from './paint'
import type { SurfaceBackground } from './surface'
import type { RGBA } from './text'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resize } from './core'
import { decode, encode } from './codecs'
import { drawImage, dropShadow } from './paint'
import { createSurface } from './surface'
import { drawText, fillRect, fillRoundedRect, fillVerticalScrim, layoutText } from './text'
import { debugLog } from './utils'

/** The networks `generateSocialImages` knows the aspect ratios for. */
export type SocialNetwork = 'og-github' | 'og-facebook' | 'og-twitter' | 'og-linkedin' | 'og-instagram'

export interface SocialImageOptions {
  quality?: number
  /**
   * Container for the generated cards. Defaults to `jpeg`.
   *
   * Social cards are photographs, and PNG is lossless: a 1200x630 card came
   * out at 2 MB or more, times five networks, for images nobody inspects at
   * that fidelity. JPEG at the default quality is a twentieth of the size for
   * no visible difference. Pass `png` when a card is flat colour or carries a
   * transparent region, where PNG genuinely wins.
   */
  format?: 'jpeg' | 'png' | 'webp' | 'avif'
  /**
   * Which cards to build. Defaults to all five. Most sites need one or two,
   * and every extra card is a file to store, ship and keep in step.
   */
  networks?: SocialNetwork[]
}

export async function generateSocialImages(
  input: string,
  outputDir: string,
  options: SocialImageOptions = {},
): Promise<Record<string, string>> {
  debugLog('social', `Generating social media images from ${input}`)

  const allSizes: Record<SocialNetwork, { width: number, height: number }> = {
    'og-github': { width: 1280, height: 640 },
    'og-facebook': { width: 1200, height: 630 },
    'og-twitter': { width: 1200, height: 600 },
    'og-linkedin': { width: 1104, height: 736 },
    'og-instagram': { width: 1080, height: 1080 },
  }

  const requested = options.networks ?? (Object.keys(allSizes) as SocialNetwork[])
  const sizes = Object.fromEntries(requested.map(network => [network, allSizes[network]]))
  const format = options.format ?? 'jpeg'
  const extension = format === 'jpeg' ? 'jpg' : format

  const results: Record<string, string> = {}

  // Read and decode the source image
  const inputBuffer = new Uint8Array(await readFile(input))
  const imageData = await decode(inputBuffer)

  for (const [name, size] of Object.entries(sizes)) {
    const outputPath = join(outputDir, `${name}.${extension}`)

    // Resize with cover fit (crop to fill)
    const resized = resize(imageData, {
      width: size.width,
      height: size.height,
      fit: 'cover',
    })

    const encoded = await encode(resized, format, { quality: options.quality || 80 })
    await writeFile(outputPath, encoded)

    results[name] = outputPath
  }

  return results
}

/**
 * A composed share card: a photograph, a scrim, the brand, and a headline.
 *
 * The alternative to this is a cropped photograph with no words on it, which
 * is what `generateSocialImages` produces. A card that says what the page is
 * survives being reposted, quoted, and shown at thumbnail size in a feed.
 */
/**
 * A product shot placed on the card, opposite the copy.
 *
 * A card that is only words is indistinguishable from every other card that
 * is only words. Showing the thing itself is what makes a link recognisable
 * in a feed at thumbnail size.
 */
export interface SocialCardForeground {
  image: string
  /**
   * Fraction of the card's height the shot occupies. Defaults to 0.78, which
   * leaves it clear of the brand row above and the foot below.
   */
  scale?: number
  /** Corner radius as a fraction of the shot's drawn width. @default 0.045 */
  radius?: number
  /** Hairline around the shot, so a dark screenshot keeps its edge. */
  borderColor?: RGBA
  /** Shadow under the shot. Omit for none. */
  shadow?: Omit<DropShadowOptions, 'blur'> & { blur?: number }
  /**
   * Share of the card's width the copy is guaranteed, as a floor rather than a
   * fixed column: the shot is sized off the height it can use and the copy
   * gets whatever is left, so a tall capture buys the headline a wider measure
   * instead of leaving a band of background beside it. Only a shot wide enough
   * to eat into this is capped.
   *
   * Ask `socialCardMetrics` for the number rather than recomputing it.
   *
   * @default 0.54
   */
  textWidth?: number
}

export interface SocialCardOptions {
  /** Background photograph. Cover-cropped to the card. */
  background?: string
  /** Flat background when there is no photograph. Defaults to near-black. */
  backgroundColor?: RGBA
  /**
   * Full background declaration — colour, gradient, glows, photograph — in
   * the same shape a store screenshot takes. Supersedes `background` and
   * `backgroundColor` when given.
   */
  surface?: SurfaceBackground
  /** A shot of the product, placed opposite the copy. */
  foreground?: SocialCardForeground
  /** The headline. Wrapped, and capped at `titleLines`. */
  title: string
  /** Small line above the title. The section, usually. */
  eyebrow?: string
  /** Small line below the title. */
  subtitle?: string
  /** Wordmark, drawn top-left. */
  brand?: string
  /** Bold face, used for the brand and the title. Required. */
  titleFont: Font
  /** Face for the eyebrow and subtitle. Falls back to `titleFont`. */
  bodyFont?: Font
  width?: number
  height?: number
  /** Headline and brand colour. */
  color?: RGBA
  /** Eyebrow and rule colour. */
  accent?: RGBA
  /**
   * Plate painted behind the mark before `drawMark` runs. Defaults to white,
   * so a mark drawn in its own colours reads over any photograph. `null`
   * draws no plate, which is what a mark already in the card's own palette
   * wants: a white plate behind a white wordmark hides it.
   */
  markPlate?: RGBA | null
  /**
   * Paint the logo mark, left of the wordmark.
   *
   * A library cannot know what a brand's mark looks like, so it supplies the
   * plate and the position and hands the box back: `box` is in card pixels,
   * and the primitives in `./shapes` draw into `card` directly. Without this
   * the brand row is the wordmark alone.
   *
   * `box.width` is the space reserved horizontally, which is `box.size` for a
   * square mark and wider for a wordmark (see `markAspect`). `box.size` stays
   * the height, so a painter written against the old square-only box keeps
   * working.
   */
  drawMark?: (card: ImageData, box: { x: number, y: number, size: number, width: number }) => void
  /**
   * The mark's width divided by its height. Defaults to 1, a square.
   *
   * A logo is often a wordmark rather than an icon, and reserving a square for
   * one either shrinks it to half the row's height or runs it over the text
   * beside it. Declaring the shape lets the row reserve the right width and
   * put the wordmark after it.
   */
  markAspect?: number
  /** Subtitle colour. Defaults to a dimmed `color`. */
  mutedColor?: RGBA
  /**
   * Headline size in pixels. @default 6.2% of the width
   *
   * The three sizes are set against the full-size card, but a card is mostly
   * seen far smaller: around 500px wide in a timeline and 300px or less in a
   * chat thread, where the defaults put the subtitle near 7px and the eyebrow
   * near 6px. A card that must read at thumbnail size wants all three larger,
   * and fewer words.
   */
  titleSize?: number
  /** Eyebrow size in pixels. @default 1.9% of the width */
  eyebrowSize?: number
  /** Subtitle size in pixels. @default 2.45% of the width */
  subtitleSize?: number
  titleLines?: number
  /**
   * Lines the subtitle may wrap to. @default 2
   *
   * The supporting line is where a card carries the specifics — a price, a
   * date, what the thing actually is — and one line of it at this size is
   * around sixty characters. Capping at one silently cut the rest off
   * mid-word, which reads as a broken card rather than a terse one. Set 1 to
   * keep the old behaviour.
   */
  subtitleLines?: number
  quality?: number
  format?: 'jpeg' | 'png' | 'webp' | 'avif'
}

/**
 * Compose a card and hand back the encoded bytes.
 *
 * The same drawing `generateSocialCard` does, stopping short of the disk. A
 * card is not always a build artefact: a forge, a shop, a docs site with a
 * page per entity cannot enumerate its pages ahead of time, so the card for
 * `/owner/repository` has to be drawn when somebody asks for it and returned
 * on the response. Routing that through a file meant inventing a writable
 * directory inside a request handler and reading back what had just been
 * written, which is two syscalls and a cleanup problem in exchange for
 * nothing.
 */
export async function renderSocialCard(options: SocialCardOptions): Promise<Uint8Array> {
  const width = options.width ?? 1200
  const height = options.height ?? 630
  const color = options.color ?? { r: 255, g: 255, b: 255 }
  const accent = options.accent ?? { r: 226, g: 87, b: 30 }
  const muted = options.mutedColor ?? { r: color.r, g: color.g, b: color.b, a: 0.72 }
  const bodyFont = options.bodyFont ?? options.titleFont
  const padding = Math.round(width * 0.065)

  // `surface` supersedes `background`/`backgroundColor`: it can express both
  // (a flat colour, a photograph) plus the gradients and glows a brand field
  // usually needs, and it is the same declaration a store screenshot takes,
  // so a card and a listing can share one definition.
  const surface: SurfaceBackground = options.surface
    ?? { color: options.backgroundColor, image: options.background }
  const photographic = Boolean(surface.image)
  const card = await createSurface(width, height, surface)

  // A photograph is never uniformly dark enough to read white text against.
  // Two passes: a flat wash so the brand row at the top has contrast wherever
  // the image happens to be bright, and an eased scrim over the lower half
  // where the headline sits. A stubble field is nearly white, so the scrim has
  // to reach almost opaque at the foot or the eyebrow disappears into it.
  if (photographic) {
    fillRect(card, { x: 0, y: 0, width, height }, { r: 8, g: 11, b: 7, a: 0.22 })
    fillVerticalScrim(card, { x: 0, y: height * 0.26, width, height: height * 0.74 }, { r: 8, g: 11, b: 7 }, 0, 0.94)
  }

  // Brand row, top left.
  //
  // The mark sits on its own solid plate rather than being drawn straight
  // onto the photograph: over a field, an outlined mark let the texture
  // through and the accent dots inside it disappeared into whatever happened
  // to be behind them.
  // The row renders for a mark on its own as well as for a wordmark. A brand
  // whose logo already carries its name has nothing to add in type beside it,
  // and gating the row on `brand` meant supplying only a mark drew nothing.
  const hasMark = Boolean(options.drawMark)

  if (options.brand || hasMark) {
    // A mark standing alone IS the brand on the card, so it takes the room the
    // wordmark beside it would otherwise have used. Next to text it stays the
    // size it always was, so an icon-plus-wordmark row is unchanged.
    const markSize = Math.round(width * (options.brand ? 0.033 : 0.05))
    // A wordmark is wider than it is tall. Reserving a square for one either
    // shrinks it to half the row height or runs it over the text beside it.
    const markAspect = Number.isFinite(options.markAspect) && (options.markAspect ?? 0) > 0
      ? options.markAspect!
      : 1
    const markWidth = Math.round(markSize * markAspect)
    let rowWidth = 0

    if (hasMark) {
      // The plate is larger than the mark so the mark has margin inside it,
      // the way a logo has clear space around it in any brand sheet. It
      // follows the mark's shape rather than always being square.
      const inset = Math.round(markSize * 0.14)
      const plateWidth = markWidth + inset * 2
      const plateHeight = markSize + inset * 2

      if (options.markPlate !== null) {
        fillRoundedRect(
          card,
          { x: padding, y: padding, width: plateWidth, height: plateHeight, radius: plateHeight * 0.24 },
          options.markPlate ?? { r: 255, g: 255, b: 255 },
        )
      }

      options.drawMark!(card, {
        x: padding + inset,
        y: padding + inset,
        size: markSize,
        width: markWidth,
      })

      rowWidth = plateWidth
    }

    if (options.brand) {
      drawText(card, {
        text: options.brand,
        font: options.titleFont,
        // Measured off the mark actually drawn, not off a square that may not
        // be the shape of the mark.
        x: hasMark ? padding + rowWidth + Math.round(markSize * 0.44) : padding,
        y: padding + markSize * 0.86,
        size: Math.round(width * 0.024),
        color,
        letterSpacing: -0.01,
      })
    }
  }

  // The text block is laid out from the bottom up, so a two-line title and a
  // three-line title both sit on the same baseline near the foot of the card.
  const titleSize = options.titleSize ?? Math.round(width * 0.062)
  // A shot beside the copy takes the right of the card, so the copy has to be
  // told about it — otherwise the headline wraps under the shot and the two
  // overlap. Stacked, the copy keeps the full measure.
  //
  // Decoded before the text is laid out because the measure depends on how
  // wide the shot ends up: a tall capture needs less width than the column it
  // was once given, and the copy should have the difference.
  const shot = options.foreground
    ? await decode(new Uint8Array(await readFile(options.foreground.image)))
    : undefined

  const metrics = socialCardMetrics({
    width,
    height,
    foreground: shot && options.foreground
      ? { aspect: shot.width / shot.height, scale: options.foreground.scale, textWidth: options.foreground.textWidth }
      : undefined,
  })
  const maxTextWidth = metrics.textWidth
  const titleMetrics = layoutText({
    text: options.title,
    font: options.titleFont,
    size: titleSize,
    maxWidth: maxTextWidth,
    lineHeight: 1.14,
    letterSpacing: -0.018,
    maxLines: options.titleLines ?? 3,
    // A card's headline comes from a page, not from this layout, so it can
    // always be longer than three lines. Cut without a mark it reads as a
    // different, shorter headline rather than a truncated one.
    ellipsis: true,
  })

  const subtitleSize = options.subtitleSize ?? Math.round(width * 0.0245)
  const eyebrowSize = options.eyebrowSize ?? Math.round(width * 0.019)
  // Measured, not assumed: the block the subtitle needs sets where the title
  // above it has to stop, so a subtitle that wraps pushes the headline up
  // instead of being trimmed to fit a gap that was reserved before anyone
  // knew how long it was.
  const subtitleMetrics = options.subtitle
    ? layoutText({
        text: options.subtitle,
        font: bodyFont,
        size: subtitleSize,
        maxWidth: maxTextWidth,
        lineHeight: 1.35,
        maxLines: options.subtitleLines ?? 2,
        ellipsis: true,
      })
    : undefined
  const subtitleBlock = subtitleMetrics
    ? subtitleSize * 1.35 + (subtitleMetrics.lines.length - 1) * subtitleMetrics.lineHeight + padding * 0.32
    : 0

  const titleBottom = height - padding - subtitleBlock
  const firstBaseline = titleBottom - titleMetrics.height + titleMetrics.lineHeight * 0.78

  // The shot is drawn before the text so the copy sits over it if they ever
  // touch. Placing it needs the text block's extent, which is why it happens
  // here rather than with the rest of the background.
  if (options.foreground && shot) {
    const eyebrowTop = firstBaseline - titleMetrics.lineHeight * (options.eyebrow ? 1.6 : 0.9)
    const stackedTop = padding * 2.2 + width * 0.033

    // Beside, the box is already known — it is what set the copy's measure.
    // Stacked, it depends on where the copy ended up, which is only settled
    // now that the title has been laid out.
    const box = metrics.foreground ?? socialCardMetrics({
      width,
      height,
      foreground: { aspect: shot.width / shot.height, scale: options.foreground.scale, textWidth: options.foreground.textWidth },
      stackedStage: { y: stackedTop, height: eyebrowTop - stackedTop - padding * 0.6 },
    }).foreground

    if (box)
      placeForeground(card, shot, options.foreground, box)
  }

  if (options.eyebrow) {
    const eyebrowBaseline = firstBaseline - titleMetrics.lineHeight * 0.72 - padding * 0.18
    drawText(card, {
      text: options.eyebrow.toUpperCase(),
      font: bodyFont,
      size: eyebrowSize,
      x: padding,
      y: eyebrowBaseline,
      color: accent,
      letterSpacing: 0.1,
    })
  }

  drawText(card, {
    text: options.title,
    font: options.titleFont,
    size: titleSize,
    x: padding,
    y: firstBaseline,
    color,
    maxWidth: maxTextWidth,
    lineHeight: 1.14,
    letterSpacing: -0.018,
    maxLines: options.titleLines ?? 3,
    // A card's headline comes from a page, not from this layout, so it can
    // always be longer than three lines. Cut without a mark it reads as a
    // different, shorter headline rather than a truncated one.
    ellipsis: true,
  })

  if (options.subtitle && subtitleMetrics) {
    const lastBaseline = height - padding - subtitleSize * 0.15
    drawText(card, {
      text: options.subtitle,
      font: bodyFont,
      size: subtitleSize,
      x: padding,
      // The last line keeps the baseline a single line always had, so the
      // foot of the card does not move when a subtitle wraps.
      y: lastBaseline - (subtitleMetrics.lines.length - 1) * subtitleMetrics.lineHeight,
      color: muted,
      maxWidth: maxTextWidth,
      lineHeight: 1.35,
      maxLines: options.subtitleLines ?? 2,
      ellipsis: true,
    })
  }

  const format = options.format ?? 'jpeg'

  return encode(card, format, { quality: options.quality ?? 82 })
}

/**
 * Draw a card and write it, answering the path it was written to.
 *
 * The build-time half of the pair: what `generateSocialCards` and the CLI
 * call. The composition itself lives in `renderSocialCard`.
 */
export async function generateSocialCard(
  outputPath: string,
  options: SocialCardOptions,
): Promise<string> {
  await writeFile(outputPath, await renderSocialCard(options))

  return outputPath
}

export interface SocialCardRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface SocialCardMetrics {
  /** Margin the layout is built on. */
  padding: number
  /** Whether the shot sits beside the copy rather than above it. */
  beside: boolean
  /** The width the headline and subtitle wrap within. */
  textWidth: number
  /** Where the product shot lands, if there is one. */
  foreground?: SocialCardRegion
}

export interface SocialCardMetricsOptions {
  width?: number
  height?: number
  /**
   * The shot's proportions and placement rules. `aspect` is width ÷ height of
   * the capture; everything else mirrors `SocialCardForeground`.
   */
  foreground?: { aspect: number, scale?: number, textWidth?: number }
  /** Vertical band the shot may use when it sits above the copy. */
  stackedStage?: { y: number, height: number }
}

/**
 * Where everything goes on a card.
 *
 * Split out and exported because the copy has to be written to fit a measure
 * that only this file knows. Re-deriving it downstream — a validator that
 * hard-codes `width * 0.54 - padding * 2` — is right until the layout moves,
 * and then it is confidently wrong in whichever direction hurts: passing copy
 * that will be truncated, or rejecting copy that would have fit.
 */
export function socialCardMetrics(options: SocialCardMetricsOptions = {}): SocialCardMetrics {
  const width = options.width ?? 1200
  const height = options.height ?? 630
  const padding = Math.round(width * 0.065)
  const beside = width / height >= 1.2
  const full = width - padding * 2

  if (!options.foreground || !beside)
    return { padding, beside, textWidth: full, foreground: besideless(options, padding, width, height, beside) }

  const { aspect } = options.foreground
  const scale = options.foreground.scale ?? 0.92

  // Size the shot off the height it can actually use, not off a column width
  // guessed in advance. A tall capture in a fixed 46% column is limited by the
  // card's height long before it runs out of width, so it came out narrow and
  // was then centred in the leftover — parked in the middle of the right-hand
  // side with a band of empty background either side of it, the widest of them
  // against the card's own edge.
  let shotHeight = height * scale
  let shotWidth = shotHeight * aspect

  // The copy keeps its share no matter how wide the shot wants to be.
  const gutter = padding * 0.9
  const reserved = width * (options.foreground.textWidth ?? 0.54)
  const room = width - reserved - padding - gutter
  if (shotWidth > room) {
    shotWidth = room
    shotHeight = shotWidth / aspect
  }

  // Right-aligned against the margin, so the only gap is the gutter the copy
  // needs — and the copy gets everything to its left.
  const x = width - padding - shotWidth

  return {
    padding,
    beside,
    textWidth: Math.max(0, Math.round(x - gutter - padding)),
    foreground: {
      x: Math.round(x),
      y: Math.round((height - shotHeight) / 2),
      width: Math.round(shotWidth),
      height: Math.round(shotHeight),
    },
  }
}

/** Stacked placement: centred in the band between the brand row and the copy. */
function besideless(
  options: SocialCardMetricsOptions,
  padding: number,
  width: number,
  height: number,
  beside: boolean,
): SocialCardRegion | undefined {
  if (!options.foreground || beside || !options.stackedStage)
    return undefined

  const { aspect } = options.foreground
  const scale = options.foreground.scale ?? 0.92
  const stage = { x: padding, width: width - padding * 2, ...options.stackedStage }
  if (stage.width <= 0 || stage.height <= 0)
    return undefined

  let shotWidth = stage.width * scale
  let shotHeight = shotWidth / aspect
  if (shotHeight > stage.height * scale) {
    shotHeight = stage.height * scale
    shotWidth = shotHeight * aspect
  }

  return {
    x: Math.round(stage.x + (stage.width - shotWidth) / 2),
    y: Math.round(stage.y + (stage.height - shotHeight) / 2),
    width: Math.round(shotWidth),
    height: Math.round(shotHeight),
  }
}

/**
 * Draw the product shot into a box the layout already decided on.
 *
 * Cropped from the top rather than the middle: a screenshot's identity is in
 * its first few hundred pixels — the header, the headline number — and a
 * centre crop throws exactly that away.
 */
function placeForeground(
  card: ImageData,
  shot: ImageData,
  foreground: SocialCardForeground,
  box: SocialCardRegion,
): void {
  if (box.width <= 0 || box.height <= 0)
    return

  const radius = (foreground.radius ?? 0.045) * box.width

  if (foreground.shadow !== undefined) {
    dropShadow(card, { ...box, radius }, {
      blur: foreground.shadow.blur ?? box.width * 0.2,
      offsetY: foreground.shadow.offsetY ?? box.width * 0.07,
      offsetX: foreground.shadow.offsetX,
      spread: foreground.shadow.spread,
      color: foreground.shadow.color ?? { r: 0, g: 0, b: 0, a: 0.5 },
    })
  }

  if (foreground.borderColor) {
    const thickness = Math.max(1, Math.round(box.width * 0.003))
    fillRoundedRect(card, {
      x: box.x - thickness,
      y: box.y - thickness,
      width: box.width + thickness * 2,
      height: box.height + thickness * 2,
      radius: radius + thickness,
    }, foreground.borderColor)
  }

  drawImage(card, shot, { ...box, fit: 'cover', position: 'top', radius })
}

/**
 * The card sizes worth generating, and what each is for.
 *
 * The default `og` size is the one every scraper understands. The others
 * exist because some consumers reserve a taller slot than 1.91:1 and letterbox
 * a wide card into it — Apple's link previews in Messages most visibly — and a
 * page that declares only a wide card gets dead space on either side of it.
 * Declaring the wide card first and offering the others as alternates lets a
 * consumer that prefers a taller crop pick one.
 */
export type SocialCardPreset = 'og' | 'twitter' | 'square' | 'portrait'

export interface SocialCardSize {
  width: number
  height: number
}

export const SOCIAL_CARD_PRESETS: Record<SocialCardPreset, SocialCardSize> = {
  /** 1.91:1. The universal default: Open Graph, Slack, Discord, LinkedIn. */
  og: { width: 1200, height: 630 },
  /** 2:1. What X renders for `summary_large_image`. */
  twitter: { width: 1200, height: 600 },
  /** 1:1. Fills a square slot without a crop; safe everywhere. */
  square: { width: 1200, height: 1200 },
  /** 4:5. The tall slot Messages and Pinterest reserve. */
  portrait: { width: 1200, height: 1500 },
}

export interface SocialCardSetOptions extends Omit<SocialCardOptions, 'width' | 'height'> {
  /** Which sizes to build. Defaults to `og`, `square` and `portrait`. */
  presets?: SocialCardPreset[]
  /** Base file name, without an extension. @default 'og' */
  name?: string
}

/**
 * Build one card definition at several sizes.
 *
 * The default file for the `og` preset is `<name>.<ext>` and the rest are
 * `<name>-<preset>.<ext>`, so the primary card keeps a stable URL when the
 * set it belongs to grows.
 */
export async function generateSocialCards(
  outputDir: string,
  options: SocialCardSetOptions,
): Promise<Record<string, string>> {
  const presets = options.presets ?? ['og', 'square', 'portrait']
  const name = options.name ?? 'og'
  const format = options.format ?? 'jpeg'
  const extension = format === 'jpeg' ? 'jpg' : format

  await mkdir(outputDir, { recursive: true })

  const results: Record<string, string> = {}
  for (const preset of presets) {
    const size = SOCIAL_CARD_PRESETS[preset]
    if (!size)
      throw new TypeError(`Unknown social card preset: ${preset}`)

    const file = join(outputDir, `${name}${preset === 'og' ? '' : `-${preset}`}.${extension}`)
    results[preset] = await generateSocialCard(file, { ...options, ...size })
  }

  return results
}
