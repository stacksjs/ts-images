import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { decode, encode } from '../src/codecs'
import { createImageData } from '../src/core'
import { generateFavicons, trimTransparentMargin } from '../src/favicon'
import { readMetadata } from './utils/test-helpers'

const FIXTURES_DIR = join(import.meta.dir, 'fixtures')
const OUTPUT_DIR = join(import.meta.dir, 'output')

describe('favicon', () => {
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

  describe('generateFavicons', () => {
    it('should generate favicons in multiple sizes', async () => {
      const input = join(FIXTURES_DIR, 'app-icon.png')

      const results = await generateFavicons(input, OUTPUT_DIR)

      expect(results.length).toBeGreaterThan(0)

      // Check if the .ico file was generated
      const icoExists = await Bun.file(join(OUTPUT_DIR, 'favicon.ico')).exists()
      expect(icoExists).toBe(true)

      // Check if the PNG favicons were generated
      const pngExists = await Bun.file(join(OUTPUT_DIR, 'favicon-32x32.png')).exists()
      expect(pngExists).toBe(true)

      // Verify dimensions of a favicon
      const metadata = await readMetadata(join(OUTPUT_DIR, 'favicon-32x32.png'))
      expect(metadata.width).toBe(32)
      expect(metadata.height).toBe(32)
    })
  })

  /** A square canvas with a transparent margin around an opaque block, like an icon drawn on Apple's grid. */
  function marginIcon(size: number, inset: number, width = size - 2 * inset, height = size - 2 * inset) {
    const image = createImageData(size, size, { hasAlpha: true, fill: { r: 0, g: 0, b: 0, a: 0 } })
    const left = Math.floor((size - width) / 2)
    const top = Math.floor((size - height) / 2)
    for (let y = top; y < top + height; y++) {
      for (let x = left; x < left + width; x++) {
        const i = (y * size + x) * 4
        image.data[i] = 245
        image.data[i + 1] = 158
        image.data[i + 2] = 11
        image.data[i + 3] = 255
      }
    }
    return image
  }

  async function writeIcon(name: string, image: ReturnType<typeof createImageData>) {
    const path = join(OUTPUT_DIR, name)
    await Bun.write(path, await encode(image, 'png'))
    return path
  }

  async function pixelAlpha(path: string, x: number, y: number) {
    const image = await decode(new Uint8Array(await Bun.file(path).arrayBuffer()))
    return image.data[(y * image.width + x) * 4 + 3]
  }

  describe('a source with a transparent margin', () => {
    it('crops the margin, so the icon fills a small favicon', async () => {
      const input = await writeIcon('source.png', marginIcon(256, 32))
      const out = join(OUTPUT_DIR, 'set')
      await generateFavicons(input, out)

      // Untrimmed, the 32px corner would be the transparent margin.
      expect(await pixelAlpha(join(out, 'favicon-32x32.png'), 1, 1)).toBe(255)
    })

    it('keeps the margin when trim is off', async () => {
      const input = await writeIcon('source.png', marginIcon(256, 32))
      const out = join(OUTPUT_DIR, 'set')
      await generateFavicons(input, out, { trim: false })

      expect(await pixelAlpha(join(out, 'favicon-32x32.png'), 1, 1)).toBe(0)
    })

    it('centres a wide mark in a square rather than stretching it', () => {
      const trimmed = trimTransparentMargin(marginIcon(200, 0, 120, 40))
      expect(trimmed.width).toBe(120)
      expect(trimmed.height).toBe(120)
      // Transparent above and below the band, opaque through its middle.
      expect(trimmed.data[(10 * 120 + 60) * 4 + 3]).toBe(0)
      expect(trimmed.data[(60 * 120 + 60) * 4 + 3]).toBe(255)
    })

    it('returns a full-bleed or empty image unchanged', () => {
      const full = marginIcon(64, 0)
      expect(trimTransparentMargin(full)).toBe(full)
      const empty = createImageData(64, 64, { hasAlpha: true, fill: { r: 0, g: 0, b: 0, a: 0 } })
      expect(trimTransparentMargin(empty)).toBe(empty)
    })
  })

  describe('the manifest and touch icon', () => {
    it('declares icons for any purpose, and maskable only when asked', async () => {
      const input = await writeIcon('source.png', marginIcon(512, 0))
      await generateFavicons(input, join(OUTPUT_DIR, 'plain'), { manifest: { name: 'Uplink' } })
      await generateFavicons(input, join(OUTPUT_DIR, 'masked'), { manifest: { name: 'Uplink', maskable: true } })

      const plain = await Bun.file(join(OUTPUT_DIR, 'plain', 'site.webmanifest')).json()
      const masked = await Bun.file(join(OUTPUT_DIR, 'masked', 'site.webmanifest')).json()
      expect(plain.icons.every((icon: { purpose: string }) => icon.purpose === 'any')).toBe(true)
      expect(masked.icons.every((icon: { purpose: string }) => icon.purpose === 'any maskable')).toBe(true)
    })

    it('flattens the touch icon onto the manifest background, since iOS fills transparency with black', async () => {
      // A circle-ish source: transparent corners even after the margin is cropped.
      const image = marginIcon(256, 32)
      for (const [x, y] of [[32, 32], [223, 32], [32, 223], [223, 223]])
        image.data[(y * 256 + x) * 4 + 3] = 0
      const input = await writeIcon('source.png', image)

      await generateFavicons(input, join(OUTPUT_DIR, 'bg'), { manifest: { backgroundColor: '#0c0c0e' } })
      await generateFavicons(input, join(OUTPUT_DIR, 'nobg'), { manifest: {} })

      expect(await pixelAlpha(join(OUTPUT_DIR, 'bg', 'apple-touch-icon.png'), 0, 0)).toBe(255)
      expect(await pixelAlpha(join(OUTPUT_DIR, 'nobg', 'apple-touch-icon.png'), 0, 0)).toBeLessThan(255)
    })
  })
})
