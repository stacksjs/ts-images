import type { ImageData } from './core/image-data'
import type { AppIconResult, AppIconSize } from './types'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { config } from './config'
import { resize } from './core'
import { createImageData } from './core/image-data'
import { decode, encode } from './codecs'
import { drawImage, parseColor } from './paint'
import { debugLog } from './utils'

// macOS App Icon sizes based on Apple's requirements
const macOSSizes: AppIconSize[] = [
  { size: 16, scale: 1, idiom: 'mac', filename: 'AppIcon-16.png' },
  { size: 16, scale: 2, idiom: 'mac', filename: 'AppIcon-16@2x.png' },
  { size: 32, scale: 1, idiom: 'mac', filename: 'AppIcon-32.png' },
  { size: 32, scale: 2, idiom: 'mac', filename: 'AppIcon-32@2x.png' },
  { size: 128, scale: 1, idiom: 'mac', filename: 'AppIcon-128.png' },
  { size: 128, scale: 2, idiom: 'mac', filename: 'AppIcon-128@2x.png' },
  { size: 256, scale: 1, idiom: 'mac', filename: 'AppIcon-256.png' },
  { size: 256, scale: 2, idiom: 'mac', filename: 'AppIcon-256@2x.png' },
  { size: 512, scale: 1, idiom: 'mac', filename: 'AppIcon-512.png' },
  { size: 512, scale: 2, idiom: 'mac', filename: 'AppIcon-512@2x.png' },
]

// iOS App Icon sizes
const iOSSizes: AppIconSize[] = [
  { size: 20, scale: 1, idiom: 'iphone', filename: 'AppIcon-20.png' },
  { size: 20, scale: 2, idiom: 'iphone', filename: 'AppIcon-20@2x.png' },
  { size: 20, scale: 3, idiom: 'iphone', filename: 'AppIcon-20@3x.png' },
  { size: 29, scale: 1, idiom: 'iphone', filename: 'AppIcon-29.png' },
  { size: 29, scale: 2, idiom: 'iphone', filename: 'AppIcon-29@2x.png' },
  { size: 29, scale: 3, idiom: 'iphone', filename: 'AppIcon-29@3x.png' },
  { size: 40, scale: 2, idiom: 'iphone', filename: 'AppIcon-40@2x.png' },
  { size: 40, scale: 3, idiom: 'iphone', filename: 'AppIcon-40@3x.png' },
  { size: 60, scale: 2, idiom: 'iphone', filename: 'AppIcon-60@2x.png' },
  { size: 60, scale: 3, idiom: 'iphone', filename: 'AppIcon-60@3x.png' },
  { size: 20, scale: 1, idiom: 'ipad', filename: 'AppIcon-20-ipad.png' },
  { size: 20, scale: 2, idiom: 'ipad', filename: 'AppIcon-20@2x-ipad.png' },
  { size: 29, scale: 1, idiom: 'ipad', filename: 'AppIcon-29-ipad.png' },
  { size: 29, scale: 2, idiom: 'ipad', filename: 'AppIcon-29@2x-ipad.png' },
  { size: 40, scale: 1, idiom: 'ipad', filename: 'AppIcon-40.png' },
  { size: 40, scale: 2, idiom: 'ipad', filename: 'AppIcon-40@2x-ipad.png' },
  { size: 76, scale: 1, idiom: 'ipad', filename: 'AppIcon-76.png' },
  { size: 76, scale: 2, idiom: 'ipad', filename: 'AppIcon-76@2x.png' },
  { size: 83.5, scale: 2, idiom: 'ipad', filename: 'AppIcon-83.5@2x.png' },
  { size: 1024, scale: 1, idiom: 'ios-marketing', filename: 'AppIcon-1024.png' },
] as AppIconSize[]

/**
 * Android's launcher icons: the square (`ic_launcher`) and round
 * (`ic_launcher_round`) legacy icons in every density bucket, 48dp each, and
 * the 512px icon Google Play's listing asks for.
 */
export const androidIconDensities = [
  { density: 'mdpi', size: 48 },
  { density: 'hdpi', size: 72 },
  { density: 'xhdpi', size: 96 },
  { density: 'xxhdpi', size: 144 },
  { density: 'xxxhdpi', size: 192 },
] as const

/** The size Google Play's store listing takes its app icon at. */
export const PLAY_STORE_ICON_SIZE = 512

export type AppIconPlatform = 'ios' | 'macos' | 'android'

export interface AppIconOptions {
  /**
   * The colour drawn under any transparency, which makes every icon opaque.
   * App Store Connect refuses an iOS marketing icon with an alpha channel,
   * so `renderAppIcons` fills iOS icons white unless this says otherwise.
   * Any CSS colour `parseColor` reads (`#0a84ff`, `rgb(…)`).
   */
  background?: string
}

/** One icon, rendered in memory: where it goes in the platform's project, its edge and its PNG bytes. */
export interface RenderedAppIcon {
  platform: AppIconPlatform
  /**
   * The file's path in the platform's own layout:
   * `AppIcon.appiconset/AppIcon-60@3x.png`, `mipmap-xxhdpi/ic_launcher.png`,
   * `playstore-icon.png`.
   */
  path: string
  /** Edge in pixels (icons are square). */
  size: number
  /** `round` for Android's circular launcher icon. */
  shape: 'square' | 'round'
  bytes: Uint8Array
}

export interface RenderAppIconsOptions extends AppIconOptions {
  /** Which platforms' icons. Defaults to iOS and Android. */
  platforms?: AppIconPlatform[]
}

/**
 * The source drawn into a square of `edge` pixels: contained (never cropped,
 * a non-square source is centred), on `background` when one is given, and
 * masked to a circle for `round`.
 */
function iconAt(source: ImageData, edge: number, background?: string, shape: 'square' | 'round' = 'square'): ImageData {
  const fill = background ? opaque(background) : undefined
  if (!fill && shape === 'square' && source.width === source.height)
    return resize(source, { width: edge, height: edge })
  const canvas = createImageData(edge, edge, fill ? { fill } : {})
  const scale = edge / Math.max(source.width, source.height)
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  drawImage(canvas, source, { x: (edge - width) / 2, y: (edge - height) / 2, width, height, fit: 'fill' })
  if (shape === 'round') maskCircle(canvas)
  return canvas
}

function opaque(color: string): { r: number, g: number, b: number, a: number } {
  const { r, g, b } = parseColor(color)
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a: 255 }
}

/** Clears everything outside the inscribed circle, anti-aliased over one pixel. */
function maskCircle(image: ImageData): void {
  const radius = image.width / 2
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const distance = Math.hypot(x + 0.5 - radius, y + 0.5 - radius)
      const coverage = Math.max(0, Math.min(1, radius - distance + 0.5))
      if (coverage >= 1) continue
      const index = (y * image.width + x) * 4 + 3
      image.data[index] = Math.round(image.data[index]! * coverage)
    }
  }
}

/**
 * Every icon a platform needs, from one square source, in memory: nothing is
 * written, so a server can check and keep them wherever it keeps files.
 *
 * iOS gets each `AppIcon.appiconset` size (opaque: white under transparency
 * unless `background` says otherwise), Android its square and round launcher
 * icons per density and the 512px Play Store icon (transparency kept unless
 * `background` is given), macOS its `.appiconset` sizes.
 *
 * @example
 * ```ts
 * const icons = await renderAppIcons(await Bun.file('icon.png').bytes(), { background: '#0a84ff' })
 * for (const icon of icons) await Bun.write(`out/${icon.platform}/${icon.path}`, icon.bytes)
 * ```
 */
export async function renderAppIcons(input: Uint8Array | ImageData, options: RenderAppIconsOptions = {}): Promise<RenderedAppIcon[]> {
  const source = input instanceof Uint8Array ? await decode(input) : input
  const platforms = options.platforms ?? ['ios', 'android']
  const icons: RenderedAppIcon[] = []
  const render = async (platform: AppIconPlatform, path: string, size: number, background?: string, shape: 'square' | 'round' = 'square') => {
    icons.push({ platform, path, size, shape, bytes: await encode(iconAt(source, size, background, shape), 'png') })
  }

  if (platforms.includes('ios')) {
    const background = options.background ?? '#ffffff'
    for (const { size, scale, filename } of iOSSizes)
      await render('ios', `AppIcon.appiconset/${filename}`, Math.round(size * scale), background)
  }
  if (platforms.includes('android')) {
    for (const { density, size } of androidIconDensities) {
      await render('android', `mipmap-${density}/ic_launcher.png`, size, options.background)
      await render('android', `mipmap-${density}/ic_launcher_round.png`, size, options.background, 'round')
    }
    await render('android', 'playstore-icon.png', PLAY_STORE_ICON_SIZE, options.background)
  }
  if (platforms.includes('macos')) {
    for (const { size, scale, filename } of macOSSizes)
      await render('macos', `AppIcon.appiconset/${filename}`, size * scale, options.background)
  }
  return icons
}

/**
 * Android launcher icons from a source image: `res/mipmap-<density>/ic_launcher.png`
 * and `ic_launcher_round.png` for each density, and `playstore-icon.png`
 * (512px) for the Play Store listing, under `outputDir/android`.
 */
export async function generateAndroidAppIcons(
  input: string,
  outputDir: string = config.appIcon?.outputDir || 'assets/app-icons',
  options: AppIconOptions = {},
): Promise<AppIconResult> {
  const root = resolve(outputDir, 'android')
  debugLog('app-icon', `Generating Android app icons from ${input} to ${root}`)
  const icons = await renderAppIcons(new Uint8Array(await readFile(input)), { ...options, platforms: ['android'] })
  const results = []
  for (const icon of icons) {
    const path = icon.path === 'playstore-icon.png' ? join(root, icon.path) : join(root, 'res', icon.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, icon.bytes)
    results.push({ size: icon.size, path, filename: icon.path })
  }
  return { platform: 'android', sizes: results }
}

// Ensure the output directory exists
async function ensureOutputDir(outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true })

  // For macOS, create the AppIcon.appiconset directory
  await mkdir(join(outputDir, 'AppIcon.appiconset'), { recursive: true })
}

/**
 * Generate macOS app icons from a source image
 *
 * @param input Source image path
 * @param outputDir Output directory for generated icons
 * @returns Information about the generated icons
 */
export async function generateMacOSAppIcons(
  input: string,
  outputDir: string = config.appIcon?.outputDir || 'assets/app-icons',
  options: AppIconOptions = {},
): Promise<AppIconResult> {
  const fullOutputDir = resolve(outputDir, 'AppIcon.appiconset')
  await ensureOutputDir(outputDir)

  debugLog('app-icon', `Generating macOS app icons from ${input} to ${fullOutputDir}`)

  const results = []

  // Read and decode the source image
  const inputBuffer = new Uint8Array(await readFile(input))
  const imageData = await decode(inputBuffer)

  // Generate all icon sizes
  for (const { size, scale, filename } of macOSSizes) {
    const pixelSize = size * scale
    const outputPath = join(fullOutputDir, filename)

    // Resize and encode as PNG
    const resized = iconAt(imageData, pixelSize, options.background)
    const pngBuffer = await encode(resized, 'png')
    await writeFile(outputPath, pngBuffer)

    results.push({
      size: pixelSize,
      path: outputPath,
      filename,
    })
  }

  // Generate Contents.json
  const contentsJson = generateContentsJson('macos', macOSSizes)
  const contentsPath = join(fullOutputDir, 'Contents.json')
  await writeFile(contentsPath, contentsJson)

  // Generate README with instructions
  await generateReadme(outputDir, 'macos')

  return {
    platform: 'macos',
    sizes: results,
    contentsJson,
  }
}

/**
 * Generate iOS app icons from a source image
 *
 * @param input Source image path
 * @param outputDir Output directory for generated icons
 * @returns Information about the generated icons
 */
export async function generateIOSAppIcons(
  input: string,
  outputDir: string = config.appIcon?.outputDir || 'assets/app-icons',
  options: AppIconOptions = {},
): Promise<AppIconResult> {
  const fullOutputDir = resolve(outputDir, 'AppIcon.appiconset')
  await ensureOutputDir(outputDir)

  debugLog('app-icon', `Generating iOS app icons from ${input} to ${fullOutputDir}`)

  const results = []

  // Read and decode the source image
  const inputBuffer = new Uint8Array(await readFile(input))
  const imageData = await decode(inputBuffer)

  // Generate all icon sizes
  for (const { size, scale, filename } of iOSSizes) {
    const pixelSize = Math.round(size * scale)
    const outputPath = join(fullOutputDir, filename)

    // Resize and encode as PNG
    const resized = iconAt(imageData, pixelSize, options.background)
    const pngBuffer = await encode(resized, 'png')
    await writeFile(outputPath, pngBuffer)

    results.push({
      size: pixelSize,
      path: outputPath,
      filename,
    })
  }

  // Generate Contents.json
  const contentsJson = generateContentsJson('ios', iOSSizes)
  const contentsPath = join(fullOutputDir, 'Contents.json')
  await writeFile(contentsPath, contentsJson)

  // Generate README with instructions
  await generateReadme(outputDir, 'ios')

  return {
    platform: 'ios',
    sizes: results,
    contentsJson,
  }
}

/**
 * Generate app icons for all supported platforms
 *
 * @param input Source image path
 * @param options Configuration options
 * @param options.outputDir Directory where app icons will be saved
 * @param options.platform Target platform: 'macos', 'ios', or 'all'
 * @returns Information about the generated icons
 */
export async function generateAppIcons(
  input: string,
  options: {
    outputDir?: string
    /** `all` is macOS and iOS, as it always was; ask for `android` by name. */
    platform?: 'macos' | 'ios' | 'android' | 'all'
    /** The colour under any transparency (see `AppIconOptions`). */
    background?: string
  } = {},
): Promise<AppIconResult[]> {
  const platform = options.platform || config.appIcon?.platform || 'all'
  const outputDir = options.outputDir || config.appIcon?.outputDir || 'assets/app-icons'
  const iconOptions: AppIconOptions = { background: options.background }

  const results: AppIconResult[] = []

  if (platform === 'macos' || platform === 'all') {
    results.push(await generateMacOSAppIcons(input, outputDir, iconOptions))
  }

  if (platform === 'ios' || platform === 'all') {
    results.push(await generateIOSAppIcons(input, outputDir, iconOptions))
  }

  if (platform === 'android') {
    results.push(await generateAndroidAppIcons(input, outputDir, iconOptions))
  }

  return results
}

/**
 * Generate Contents.json file for Xcode asset catalogs
 */
function generateContentsJson(_platform: 'ios' | 'macos', sizes: AppIconSize[]): string {
  const images = sizes.map(({ size, scale, idiom, filename }) => ({
    size: `${size}x${size}`,
    idiom,
    filename,
    scale: `${scale}x`,
  }))

  const contents = {
    images,
    info: {
      version: 1,
      author: 'imgx',
    },
  }

  return JSON.stringify(contents, null, 2)
}

/**
 * Generate README file with installation instructions
 */
async function generateReadme(outputDir: string, platform: string | string[]): Promise<void> {
  const platforms = Array.isArray(platform) ? platform : [platform]
  const readmePath = join(outputDir, 'README.md')

  let content = `# App Icons Generated with imgx\n\n`

  if (platforms.includes('macos')) {
    content += `## macOS App Icons\n\n`
    content += `To use these icons in your macOS app:\n\n`
    content += `1. In Xcode, open your project\n`
    content += `2. In the Project Navigator, find your Assets.xcassets folder\n`
    content += `3. Drag the entire \`AppIcon.appiconset\` folder into the Assets.xcassets folder\n`
    content += `4. Ensure the "AppIcon" is set as the app icon in your target's settings\n\n`
  }

  if (platforms.includes('ios')) {
    content += `## iOS App Icons\n\n`
    content += `To use these icons in your iOS app:\n\n`
    content += `1. In Xcode, open your project\n`
    content += `2. In the Project Navigator, find your Assets.xcassets folder\n`
    content += `3. Drag the entire \`AppIcon.appiconset\` folder into the Assets.xcassets folder\n`
    content += `4. Ensure the "AppIcon" is set as the app icon in your target's settings\n\n`
  }

  content += `## Icon Sizes\n\n`

  if (platforms.includes('macos')) {
    content += `### macOS\n\n`
    content += `| Size | Scale | Filename |\n`
    content += `| --- | --- | --- |\n`

    for (const { size, scale, filename } of macOSSizes) {
      content += `| ${size}x${size} | ${scale}x | ${filename} |\n`
    }

    content += `\n`
  }

  if (platforms.includes('ios')) {
    content += `### iOS\n\n`
    content += `| Size | Scale | Idiom | Filename |\n`
    content += `| --- | --- | --- | --- |\n`

    for (const { size, scale, idiom, filename } of iOSSizes) {
      content += `| ${size}x${size} | ${scale}x | ${idiom} | ${filename} |\n`
    }
  }

  await writeFile(readmePath, content)
}
