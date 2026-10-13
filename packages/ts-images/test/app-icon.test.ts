import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { androidIconDensities, generateAndroidAppIcons, generateAppIcons, generateIOSAppIcons, generateMacOSAppIcons, renderAppIcons } from '../src/app-icon'
import { decode, encode } from '../src/codecs'
import { createImageData } from '../src/core/image-data'

const FIXTURES_DIR = join(import.meta.dir, 'fixtures')
const OUTPUT_DIR = join(import.meta.dir, 'output')

describe('app-icon', () => {
  beforeAll(async () => {
    await mkdir(OUTPUT_DIR, { recursive: true })
  })

  afterAll(async () => {
    await rm(OUTPUT_DIR, { recursive: true, force: true })
  })

  afterEach(async () => {
    await rm(OUTPUT_DIR, { recursive: true, force: true })
      .catch(() => {})
    await mkdir(OUTPUT_DIR, { recursive: true })
  })

  describe('generateMacOSAppIcons', () => {
    it('should generate macOS app icons', async () => {
      const input = join(FIXTURES_DIR, 'app-icon.png')
      const result = await generateMacOSAppIcons(input, OUTPUT_DIR)

      expect(result.platform).toBe('macos')
      expect(result.sizes.length).toBeGreaterThan(0)
      expect(result.contentsJson).toBeDefined()

      // Check if Contents.json exists
      const contentsJsonPath = join(OUTPUT_DIR, 'AppIcon.appiconset', 'Contents.json')
      const contentsJson = await Bun.file(contentsJsonPath).text()
      expect(contentsJson).toBeDefined()

      // Check if at least one icon was generated
      const firstIcon = result.sizes[0]
      const iconExists = await Bun.file(firstIcon.path).exists()
      expect(iconExists).toBe(true)

      // Check if README was generated
      const readmePath = join(OUTPUT_DIR, 'README.md')
      const readmeExists = await Bun.file(readmePath).exists()
      expect(readmeExists).toBe(true)
    })
  })

  describe('generateIOSAppIcons', () => {
    it('should generate iOS app icons', async () => {
      const input = join(FIXTURES_DIR, 'app-icon.png')
      const result = await generateIOSAppIcons(input, OUTPUT_DIR)

      expect(result.platform).toBe('ios')
      expect(result.sizes.length).toBeGreaterThan(0)
      expect(result.contentsJson).toBeDefined()

      // Check if Contents.json exists
      const contentsJsonPath = join(OUTPUT_DIR, 'AppIcon.appiconset', 'Contents.json')
      const contentsJson = await Bun.file(contentsJsonPath).text()
      expect(contentsJson).toBeDefined()

      // Check if at least one icon was generated
      const firstIcon = result.sizes[0]
      const iconExists = await Bun.file(firstIcon.path).exists()
      expect(iconExists).toBe(true)
    })
  })

  describe('generateAppIcons', () => {
    it('should generate icons for specified platform', async () => {
      const input = join(FIXTURES_DIR, 'app-icon.png')

      const results = await generateAppIcons(input, {
        outputDir: OUTPUT_DIR,
        platform: 'macos',
      })

      expect(results.length).toBe(1)
      expect(results[0].platform).toBe('macos')
    })

    it('should generate icons for all platforms when specified', async () => {
      const input = join(FIXTURES_DIR, 'app-icon.png')

      const results = await generateAppIcons(input, {
        outputDir: OUTPUT_DIR,
        platform: 'all',
      })

      expect(results.length).toBe(2)
      expect(results.some(r => r.platform === 'macos')).toBe(true)
      expect(results.some(r => r.platform === 'ios')).toBe(true)
    })
  })

  describe('renderAppIcons', () => {
    // A 64px source, transparent but for a red square in the middle.
    async function transparentSource(): Promise<Uint8Array> {
      const image = createImageData(64, 64)
      for (let y = 16; y < 48; y++) {
        for (let x = 16; x < 48; x++) {
          const i = (y * 64 + x) * 4
          image.data[i] = 255
          image.data[i + 3] = 255
        }
      }
      return encode(image, 'png')
    }

    it('renders every iOS and Android icon in memory, at its size', async () => {
      const icons = await renderAppIcons(await transparentSource())
      const ios = icons.filter(icon => icon.platform === 'ios')
      const android = icons.filter(icon => icon.platform === 'android')
      expect(ios.map(icon => icon.path)).toContain('AppIcon.appiconset/AppIcon-1024.png')
      expect(android.map(icon => icon.path)).toEqual([
        ...androidIconDensities.flatMap(({ density }) => [`mipmap-${density}/ic_launcher.png`, `mipmap-${density}/ic_launcher_round.png`]),
        'playstore-icon.png',
      ])
      for (const icon of icons) {
        const decoded = await decode(icon.bytes)
        expect(decoded.width).toBe(icon.size)
        expect(decoded.height).toBe(icon.size)
      }
      expect(android.find(icon => icon.path === 'mipmap-xxxhdpi/ic_launcher.png')!.size).toBe(192)
      expect(android.find(icon => icon.path === 'playstore-icon.png')!.size).toBe(512)
    })

    it('makes iOS icons opaque, on white unless a background is given', async () => {
      const source = await transparentSource()
      const white = await decode((await renderAppIcons(source, { platforms: ['ios'] })).find(icon => icon.size === 1024)!.bytes)
      expect([...white.data.slice(0, 4)]).toEqual([255, 255, 255, 255])
      const blue = await decode((await renderAppIcons(source, { platforms: ['ios'], background: '#0a84ff' })).find(icon => icon.size === 1024)!.bytes)
      expect([...blue.data.slice(0, 4)]).toEqual([10, 132, 255, 255])
      // The square itself is drawn over it.
      const centre = (512 * 1024 + 512) * 4
      expect([...blue.data.slice(centre, centre + 4)]).toEqual([255, 0, 0, 255])
    })

    it('keeps Android transparency, and rounds the round icon', async () => {
      const icons = await renderAppIcons(await transparentSource(), { platforms: ['android'], background: '#00ff00' })
      const round = await decode(icons.find(icon => icon.path === 'mipmap-xxxhdpi/ic_launcher_round.png')!.bytes)
      const square = await decode(icons.find(icon => icon.path === 'mipmap-xxxhdpi/ic_launcher.png')!.bytes)
      // A corner is outside the circle, inside the square.
      expect(round.data[3]).toBe(0)
      expect(square.data[3]).toBe(255)
      const plain = await renderAppIcons(await transparentSource(), { platforms: ['android'] })
      expect((await decode(plain[0]!.bytes)).data[3]).toBe(0)
    })

    it('contains a source that is not square rather than stretching it', async () => {
      const wide = createImageData(80, 40, { fill: { r: 0, g: 0, b: 0, a: 255 } })
      const [icon] = await renderAppIcons(wide, { platforms: ['ios'], background: '#ffffff' })
      const decoded = await decode(icon!.bytes)
      // The top row is background, the middle row the black source.
      expect([...decoded.data.slice(0, 3)]).toEqual([255, 255, 255])
      const middle = (Math.floor(decoded.height / 2) * decoded.width) * 4
      expect([...decoded.data.slice(middle, middle + 3)]).toEqual([0, 0, 0])
    })
  })

  describe('generateAndroidAppIcons', () => {
    it('writes the mipmaps and the Play Store icon', async () => {
      const result = await generateAndroidAppIcons(join(FIXTURES_DIR, 'app-icon.png'), OUTPUT_DIR)
      expect(result.platform).toBe('android')
      expect(await Bun.file(join(OUTPUT_DIR, 'android', 'res', 'mipmap-mdpi', 'ic_launcher.png')).exists()).toBe(true)
      expect(await Bun.file(join(OUTPUT_DIR, 'android', 'playstore-icon.png')).exists()).toBe(true)
      const results = await generateAppIcons(join(FIXTURES_DIR, 'app-icon.png'), { outputDir: OUTPUT_DIR, platform: 'android' })
      expect(results.map(r => r.platform)).toEqual(['android'])
    })
  })
})
