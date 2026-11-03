import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { decode } from '../src/codecs'
import {
  ANDROID_SPLASH_DENSITIES,
  ANDROID_SPLASH_ICON_DP,
  ANDROID_SPLASH_SAFE_DP,
  generateSplashScreens,
  renderSplashPreview,
  renderSplashScreens,
  splashImageSetContents,
} from '../src/splash'

const OUTPUT_DIR = join(import.meta.dir, 'output-splash')
const FIXTURES = join(import.meta.dir, 'fixtures')
const FONT = '/Users/chris/Code/Fonts/Satoshi/WEB/fonts/Satoshi-Bold.ttf'

/** A square mark in one colour, sized 48x48, on a transparent margin. */
function mark(color: string, width = 64, height = 64): Uint8Array {
  return new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="8" y="8" width="${width - 16}" height="${height - 16}" rx="6" fill="${color}"/></svg>`)
}

function alphaAt(image: { width: number, data: Uint8Array | Uint8ClampedArray }, x: number, y: number): number {
  return image.data[(Math.floor(y) * image.width + Math.floor(x)) * 4 + 3]!
}

function opaqueBox(image: { width: number, height: number, data: Uint8Array | Uint8ClampedArray }, threshold = 200) {
  let left = image.width
  let top = image.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (alphaAt(image, x, y) < threshold)
        continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 }
}

afterAll(async () => {
  await rm(OUTPUT_DIR, { recursive: true, force: true })
})

describe('renderSplashScreens', () => {
  it('renders the iOS launch image at 1x, 2x and 3x of one size in points', async () => {
    const images = await renderSplashScreens({ logo: mark('#dd0f15'), platforms: ['ios'], dark: false })
    expect(images.map(image => image.path)).toEqual([
      'LaunchLogo.imageset/LaunchLogo.png',
      'LaunchLogo.imageset/LaunchLogo@2x.png',
      'LaunchLogo.imageset/LaunchLogo@3x.png',
    ])
    const [one, two, three] = images
    expect(Math.abs(two!.width - one!.width * 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(three!.height - one!.height * 3)).toBeLessThanOrEqual(1)

    // The default logo is 96 points across (a square's optical size is its side).
    const decoded = await decode(three!.bytes)
    expect(decoded.width).toBe(three!.width)
    const box = opaqueBox(decoded)
    expect(Math.abs(box.width - 96 * 3)).toBeLessThanOrEqual(3)
    // Centred, to the pixel.
    expect(Math.abs(box.left - (decoded.width - 1 - box.right))).toBeLessThanOrEqual(1)
    expect(Math.abs(box.top - (decoded.height - 1 - box.bottom))).toBeLessThanOrEqual(1)
  })

  it('fades the glow to nothing before the image edge, so it has no seam', async () => {
    const [image] = await renderSplashScreens({ logo: mark('#dd0f15'), platforms: ['ios'], dark: false, light: { background: '#000000' } })
    const decoded = await decode(image!.bytes)
    for (let x = 0; x < decoded.width; x++) {
      expect(alphaAt(decoded, x, 0)).toBeLessThanOrEqual(1)
      expect(alphaAt(decoded, x, decoded.height - 1)).toBeLessThanOrEqual(1)
    }
    // ...and there is a glow: a faint pixel between the mark and the edge.
    const between = alphaAt(decoded, decoded.width / 2, decoded.height / 2 - 96 / 2 - 12)
    expect(between).toBeGreaterThan(0)
    expect(between).toBeLessThan(160)
  })

  it('writes light and dark sets, the dark ones named for the asset catalog', async () => {
    const images = await renderSplashScreens({ logo: mark('#2563eb'), platforms: ['ios'] })
    expect(images.filter(image => image.appearance === 'dark').map(image => image.path)).toEqual([
      'LaunchLogo.imageset/LaunchLogo-dark.png',
      'LaunchLogo.imageset/LaunchLogo-dark@2x.png',
      'LaunchLogo.imageset/LaunchLogo-dark@3x.png',
    ])
  })

  it('renders Android splash icons at 288dp with everything inside the 192dp circle', async () => {
    const images = await renderSplashScreens({ logo: mark('#dd0f15', 240, 48), platforms: ['android'], dark: false })
    const icons = images.filter(image => image.kind === 'icon')
    expect(icons.map(icon => icon.path)).toEqual(ANDROID_SPLASH_DENSITIES.map(({ density }) => `res/drawable-${density}/splash_icon.png`))
    for (const icon of icons) {
      expect(icon.width).toBe(Math.round(ANDROID_SPLASH_ICON_DP * icon.scale))
      expect(icon.height).toBe(icon.width)
    }

    const xxhdpi = icons.find(icon => icon.path.includes('xxhdpi'))!
    const decoded = await decode(xxhdpi.bytes)
    const centre = decoded.width / 2
    const safe = (ANDROID_SPLASH_SAFE_DP / 2) * xxhdpi.scale
    for (let y = 0; y < decoded.height; y += 2) {
      for (let x = 0; x < decoded.width; x += 2) {
        if (Math.hypot(x + 0.5 - centre, y + 0.5 - centre) > safe)
          expect(alphaAt(decoded, x, y)).toBe(0)
      }
    }

    // The legacy window-background logo, per density.
    const logos = images.filter(image => image.kind === 'logo')
    expect(logos).toHaveLength(ANDROID_SPLASH_DENSITIES.length)
    expect(logos[0]!.path).toBe('res/drawable-mdpi/splash_logo.png')
  })

  it('puts Dark Mode Android images in the night buckets', async () => {
    const images = await renderSplashScreens({ logo: mark('#ffffff'), platforms: ['android'], glow: false })
    expect(images.some(image => image.path === 'res/drawable-night-xhdpi/splash_icon.png')).toBe(true)
  })

  it('keeps a wide wordmark inside maxWidth', async () => {
    const [image] = await renderSplashScreens({ logo: mark('#111111', 800, 100), platforms: ['ios'], dark: false, glow: false })
    const box = opaqueBox(await decode(image!.bytes))
    expect(box.width).toBeLessThanOrEqual(240)
    expect(box.width).toBeGreaterThan(200)
  })

  it('repaints a logo that would vanish on its background', async () => {
    const [image] = await renderSplashScreens({ logo: mark('#ffffff'), platforms: ['ios'], dark: false, glow: false, light: { background: '#ffffff' } })
    const decoded = await decode(image!.bytes)
    const index = (Math.floor(decoded.height / 2) * decoded.width + Math.floor(decoded.width / 2)) * 4
    expect(decoded.data[index]!).toBeLessThan(64)
    expect(decoded.data[index + 3]!).toBe(255)
  })

  it('masks a full-bleed bitmap logo to an app icon\'s rounded corners', async () => {
    const [image] = await renderSplashScreens({ logo: join(FIXTURES, 'app-icon.png'), shape: 'rounded', platforms: ['ios'], dark: false, glow: false, trim: false })
    const decoded = await decode(image!.bytes)
    const box = opaqueBox(decoded, 1)
    expect(alphaAt(decoded, box.left, box.top)).toBe(0)
    expect(alphaAt(decoded, decoded.width / 2, decoded.height / 2)).toBe(255)
  })

  it('treats blank text as none, without reading its font', async () => {
    const images = await renderSplashScreens({ logo: mark('#000000'), platforms: ['ios'], dark: false, text: { value: '  ', font: '/nonexistent.ttf' } })
    expect(images).toHaveLength(3)
  })

  // A real TrueType face, as text.test.ts uses; skipped on a bare checkout.
  it.if(existsSync(FONT))('draws a line of text under the logo, inside the image', async () => {
    const plain = await renderSplashScreens({ logo: mark('#000000'), platforms: ['ios'], dark: false, glow: false })
    const [image] = await renderSplashScreens({ logo: mark('#000000'), platforms: ['ios'], dark: false, glow: false, text: { value: 'Last Soul Ultra', font: FONT, uppercase: true } })
    const decoded = await decode(image!.bytes)
    expect(decoded.height).toBeGreaterThan(plain[0]!.height)
    const box = opaqueBox(decoded, 1)
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.bottom).toBeLessThan(decoded.height)
    // The text is wider than the 96pt mark.
    expect(box.width).toBeGreaterThan(96)
  })
})

describe('generateSplashScreens', () => {
  it('writes the image set and resources, and names what a build hands on', async () => {
    const result = await generateSplashScreens({ logo: mark('#dd0f15'), light: { background: '#F2F2F7' }, dark: { background: '#000' } }, OUTPUT_DIR)
    expect(result.backgrounds).toEqual({ light: '#f2f2f7', dark: '#000000' })
    expect(result.ios!.image).toBe(join(OUTPUT_DIR, 'ios', 'LaunchLogo.imageset', 'LaunchLogo.png'))
    expect(existsSync(result.ios!.imageDark!)).toBe(true)
    expect(existsSync(join(result.ios!.imageset, 'LaunchLogo@3x.png'))).toBe(true)
    const contents = JSON.parse(await Bun.file(join(result.ios!.imageset, 'Contents.json')).text())
    expect(contents.images).toHaveLength(6)
    expect(existsSync(join(result.android!.resources, 'drawable-night-xxxhdpi', 'splash_icon.png'))).toBe(true)
    expect(result.files.every(file => existsSync(file.path))).toBe(true)
  })
})

describe('splashImageSetContents', () => {
  it('lists each scale, dark ones by luminosity', () => {
    const contents = JSON.parse(splashImageSetContents(['light', 'dark']))
    expect(contents.images[0]).toEqual({ filename: 'LaunchLogo.png', idiom: 'universal', scale: '1x' })
    expect(contents.images[5]).toEqual({ appearances: [{ appearance: 'luminosity', value: 'dark' }], filename: 'LaunchLogo-dark@3x.png', idiom: 'universal', scale: '3x' })
  })
})

describe('renderSplashPreview', () => {
  it('draws the launch screen at a device size on its background', async () => {
    const png = await renderSplashPreview({ logo: mark('#2563eb'), dark: { background: '#101010' } }, { device: 'iphone-se', appearance: 'dark' })
    const decoded = await decode(png)
    expect([decoded.width, decoded.height]).toEqual([750, 1334])
    expect([...decoded.data.subarray(0, 4)]).toEqual([16, 16, 16, 255])
  })
})
