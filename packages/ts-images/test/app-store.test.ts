import { describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APP_STORE_DISPLAY_SIZES, generateAppStoreScreenshot, generateAppStoreScreenshots } from '../src/app-store'
import { getMetadata } from '../src/codecs'
import { loadFont } from '../src/font'

// A licensed fixture keeps actual screenshot validation running in CI too.
const FONT = join(import.meta.dir, 'fixtures/Anton-Regular.ttf')
const CAPTURE = join(import.meta.dir, 'fixtures/og-image.png')

async function font(): Promise<ReturnType<typeof loadFont>> {
  return loadFont(new Uint8Array(await readFile(FONT)))
}

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ts-images-app-store-'))
}

describe('APP_STORE_DISPLAY_SIZES', () => {
  it('carries the sizes App Store Connect accepts', () => {
    expect(APP_STORE_DISPLAY_SIZES.APP_IPHONE_67).toEqual({ width: 1290, height: 2796 })
    expect(APP_STORE_DISPLAY_SIZES.APP_IPAD_PRO_3GEN_129).toEqual({ width: 2048, height: 2732 })
    expect(APP_STORE_DISPLAY_SIZES.APP_DESKTOP).toEqual({ width: 2880, height: 1800 })
  })

  it('is portrait for every handheld class and landscape for the desktop', () => {
    for (const [displayType, size] of Object.entries(APP_STORE_DISPLAY_SIZES)) {
      if (displayType === 'APP_DESKTOP')
        expect(size.width).toBeGreaterThan(size.height)
      else
        expect(size.height).toBeGreaterThan(size.width)
    }
  })
})

describe('generateAppStoreScreenshots', () => {
  it('writes every slide at every display type, at Apple\'s exact dimensions', async () => {
    const outputDir = await scratch()
    try {
      const results = await generateAppStoreScreenshots({
        outputDir,
        titleFont: await font(),
        displayTypes: ['APP_IPHONE_67', 'APP_DESKTOP'],
        slides: [
          { capture: CAPTURE, headline: 'Ads gone before the page loads.', subheadline: 'Blocked at the source.' },
          { capture: CAPTURE, headline: 'Every block, counted.' },
        ],
      })

      expect(Object.keys(results).sort()).toEqual(['APP_DESKTOP', 'APP_IPHONE_67'])
      expect(results.APP_IPHONE_67).toHaveLength(2)

      const phone = await getMetadata(new Uint8Array(await readFile(results.APP_IPHONE_67![0]!)))
      expect(phone.width).toBe(1290)
      expect(phone.height).toBe(2796)
      // Apple rejects an alpha channel even when every pixel is opaque.
      for (const path of Object.values(results).flat())
        expect((await readFile(path))[25]).toBe(2)

      const desktop = await getMetadata(new Uint8Array(await readFile(results.APP_DESKTOP![0]!)))
      expect(desktop.width).toBe(2880)
      expect(desktop.height).toBe(1800)
    }
    finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  }, 60_000)

  it('numbers files so the upload order is the slide order', async () => {
    const outputDir = await scratch()
    try {
      const results = await generateAppStoreScreenshots({
        outputDir,
        titleFont: await font(),
        displayTypes: ['APP_IPHONE_67'],
        slides: [
          { capture: CAPTURE, headline: 'One' },
          { capture: CAPTURE, headline: 'Two' },
        ],
      })

      expect(results.APP_IPHONE_67!.map(path => path.split('/').at(-1))).toEqual([
        'app-iphone-67-01.png',
        'app-iphone-67-02.png',
      ])
    }
    finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  }, 60_000)

  it('takes a caller-supplied naming scheme', async () => {
    const outputDir = await scratch()
    try {
      const results = await generateAppStoreScreenshots({
        outputDir,
        titleFont: await font(),
        displayTypes: ['APP_IPHONE_67'],
        slides: [{ capture: CAPTURE, headline: 'One' }],
        fileName: (displayType, index) => `${displayType}_${index}.png`,
      })

      expect(results.APP_IPHONE_67![0]!.endsWith('APP_IPHONE_67_0.png')).toBe(true)
    }
    finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  }, 60_000)

  it('renders one frame at an arbitrary size', async () => {
    const outputDir = await scratch()
    try {
      const path = join(outputDir, 'promo.png')
      await generateAppStoreScreenshot(path, { width: 1200, height: 1200 }, { capture: CAPTURE, headline: 'Square' }, {
        titleFont: await font(),
      })

      const meta = await getMetadata(new Uint8Array(await readFile(path)))
      expect(meta.width).toBe(1200)
      expect(meta.height).toBe(1200)
      expect((await readFile(path))[25]).toBe(2)
    }
    finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  }, 60_000)

  it('refuses a transparent composition instead of inventing a matte', async () => {
    const outputDir = await scratch()
    try {
      await expect(generateAppStoreScreenshot(join(outputDir, 'transparent.png'), { width: 300, height: 600 }, { capture: CAPTURE, headline: 'Training' }, {
        titleFont: await font(),
        drawMark: (canvas) => { canvas.data[3] = 0 },
      })).rejects.toThrow('App Store screenshots need an opaque background')
    }
    finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  })
})

describe('generateAppStoreScreenshots validation', () => {
  it('refuses an empty slide list', async () => {
    await expect(generateAppStoreScreenshots({
      outputDir: '/tmp', titleFont: await font(), displayTypes: ['APP_IPHONE_67'], slides: [],
    })).rejects.toThrow(/At least one slide/)
  })

  it('refuses an empty display-type list', async () => {
    await expect(generateAppStoreScreenshots({
      outputDir: '/tmp', titleFont: await font(), displayTypes: [], slides: [{ capture: CAPTURE, headline: 'One' }],
    })).rejects.toThrow(/At least one display type/)
  })

  it('refuses more slides than App Store Connect accepts', async () => {
    await expect(generateAppStoreScreenshots({
      outputDir: '/tmp',
      titleFont: await font(),
      displayTypes: ['APP_IPHONE_67'],
      slides: Array.from({ length: 11 }, () => ({ capture: CAPTURE, headline: 'One' })),
    })).rejects.toThrow(/at most 10/)
  })
})
