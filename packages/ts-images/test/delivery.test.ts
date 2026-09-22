import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createImageDeliveryCatalog, createImageDeliveryManifest, decode, negotiateImageFormat, normalizeImageWidths, resolveImageDeliveryOptions, selectImageVariant } from '../src'

const fixture = join(import.meta.dir, 'fixtures/app-icon.png')
const outputDirectories: string[] = []

afterAll(async () => {
  await Promise.all(outputDirectories.map(directory => rm(directory, { recursive: true, force: true })))
})

describe('image delivery', () => {
  test('negotiates image formats using q-values and fallback', () => {
    expect(negotiateImageFormat('image/webp;q=0.8,image/avif;q=0.9', ['webp', 'avif', 'jpeg'])).toBe('avif')
    expect(negotiateImageFormat('image/gif,*/*;q=0.5', ['webp', 'jpeg'], 'jpeg')).toBe('jpeg')
    expect(negotiateImageFormat('image/avif;q=0,image/webp', ['avif', 'webp'])).toBe('webp')
  })

  test('normalizes widths without accidental upscaling', () => {
    expect(normalizeImageWidths([640, 320, 320, 2048], 1024)).toEqual([320, 640, 1024])
    expect(normalizeImageWidths([2048], 1024, true)).toEqual([2048])
    expect(() => normalizeImageWidths([0], 1024)).toThrow()
  })

  test('leaves the event loop free while it builds a catalog', async () => {
    // Codec work is a long synchronous stretch inside a promise, so awaiting
    // it only drains microtasks — a batch of images starves the macrotask side
    // entirely. When the host is a server that means the socket callbacks
    // which answer requests never run: the port is bound, nothing replies, and
    // the connection is eventually closed having sent nothing.
    //
    // Storage reports every variant as already present, so nothing encodes and
    // no file I/O happens. Any turn the loop gets is therefore one the catalog
    // handed back on purpose: unyielded this counter reaches exactly zero.
    const directory = await mkdtemp(join(tmpdir(), 'ts-images-yield-'))
    outputDirectories.push(directory)

    const storage = {
      cacheNamespace: 'yield-test',
      async stat(key: string) {
        return { bytes: 10, path: join(directory, key), url: `/_img/${key}` }
      },
      async write(key: string, bytes: Uint8Array) {
        return { bytes: bytes.byteLength, path: join(directory, key), url: `/_img/${key}` }
      },
      url: (key: string) => `/_img/${key}`,
    }

    let turns = 0
    let stop = false
    const tick = (): void => {
      if (stop) return
      turns++
      setTimeout(tick, 0)
    }
    setTimeout(tick, 0)

    try {
      await createImageDeliveryCatalog({
        storage,
        baseUrl: '/_img',
        widths: [320],
        formats: ['webp'],
        entries: Array.from({ length: 20 }, (_, index) => ({
          key: `/${index}.png`,
          input: fixture,
          name: `n${index}`,
        })),
      })
    }
    finally {
      stop = true
    }

    expect(turns).toBeGreaterThan(0)
  })

  test('names variants the same from any output directory', async () => {
    // A deploy that ships atomic releases runs the identical build from a new
    // absolute path every time. If the output directory reaches the variant
    // names, nothing the previous release wrote is ever reusable.
    const first = await mkdtemp(join(tmpdir(), 'ts-images-delivery-a-'))
    const second = await mkdtemp(join(tmpdir(), 'ts-images-delivery-b-'))
    outputDirectories.push(first, second)

    const options = {
      input: fixture,
      name: 'app-icon',
      widths: [64, 128],
      formats: ['webp'] as const,
      baseUrl: '/images',
      placeholder: false,
    }

    const one = await createImageDeliveryManifest({ ...options, outDir: first })
    const two = await createImageDeliveryManifest({ ...options, outDir: second })

    expect(two.variants.map(variant => variant.url)).toEqual(one.variants.map(variant => variant.url))
    expect(two.fallback.url).toBe(one.fallback.url)
  })

  test('keeps separate URL spaces apart', async () => {
    // The base URL still belongs in the namespace: two targets publishing into
    // different URL spaces really are different artifacts.
    const outDir = await mkdtemp(join(tmpdir(), 'ts-images-delivery-url-'))
    outputDirectories.push(outDir)

    const options = {
      input: fixture,
      name: 'app-icon',
      outDir,
      widths: [64],
      formats: ['webp'] as const,
      placeholder: false,
    }

    const one = await createImageDeliveryManifest({ ...options, baseUrl: '/images' })
    const two = await createImageDeliveryManifest({ ...options, baseUrl: '/assets' })

    const nameOf = (url: string) => url.split('/').pop()
    expect(nameOf(two.fallback.url)).not.toBe(nameOf(one.fallback.url))
  })

  test('generates deterministic responsive variants and response metadata', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ts-images-delivery-'))
    outputDirectories.push(outDir)
    const options = {
      input: fixture,
      outDir,
      name: 'avatar',
      baseUrl: 'https://cdn.example.com/images/',
      widths: [64, 128],
      formats: ['webp'] as const,
      fallbackFormat: 'png' as const,
      quality: 80,
    }

    const first = await createImageDeliveryManifest(options)
    const second = await createImageDeliveryManifest(options)

    expect(first.source.width).toBeGreaterThanOrEqual(128)
    expect(first.variants).toHaveLength(6)
    expect(second.variants.map(variant => variant.path)).toEqual(first.variants.map(variant => variant.path))
    expect(first.sources.webp).toContain('64w')
    expect(first.placeholder?.hash).toHaveLength(24)

    for (const variant of first.variants) {
      expect(variant.url.startsWith('https://cdn.example.com/images/')).toBe(true)
      const decoded = await decode(new Uint8Array(await readFile(variant.path)))
      expect(decoded.width).toBe(variant.width)
      expect(decoded.height).toBe(variant.height)
    }

    const selected = selectImageVariant(first, { accept: 'image/webp', width: 100 })
    expect(selected.variant.format).toBe('webp')
    expect(selected.variant.width).toBe(128)
    expect(selected.headers.Vary).toBe('Accept')
    expect(selected.headers['Cache-Control']).toContain('immutable')
  })

  test('emits decodable AVIF variants instead of advertising stub containers', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ts-images-avif-'))
    outputDirectories.push(outDir)
    const manifest = await createImageDeliveryManifest({
      input: join(import.meta.dir, 'fixtures/og-image.jpg'),
      outDir,
      widths: [64],
      formats: ['avif'],
      fallbackFormat: 'jpeg',
      includeOriginal: false,
      placeholder: false,
    })
    const avif = manifest.variants.find(variant => variant.format === 'avif')
    expect(avif).toBeDefined()
    const decoded = await decode(new Uint8Array(await readFile(avif!.path)))
    expect(decoded.width).toBe(64)
    expect(decoded.height).toBeGreaterThan(0)
  })

  test('encodes opaque RGBA sources as AVIF and preserves transparent sources with alpha formats', async () => {
    const opaqueOut = await mkdtemp(join(tmpdir(), 'ts-images-avif-opaque-'))
    const transparentOut = await mkdtemp(join(tmpdir(), 'ts-images-avif-transparent-'))
    outputDirectories.push(opaqueOut, transparentOut)

    const opaque = new Uint8Array([
      255, 0, 0, 255,
      0, 0, 255, 255,
    ])
    const transparent = new Uint8Array([
      255, 0, 0, 128,
      0, 0, 255, 255,
    ])
    const { encode } = await import('../src')
    const opaquePng = await encode({ data: opaque, width: 2, height: 1, channels: 4 }, 'png')
    const transparentPng = await encode({ data: transparent, width: 2, height: 1, channels: 4 }, 'png')

    const opaqueManifest = await createImageDeliveryManifest({
      input: opaquePng,
      outDir: opaqueOut,
      widths: [2],
      formats: ['avif', 'webp'],
    })
    const transparentManifest = await createImageDeliveryManifest({
      input: transparentPng,
      outDir: transparentOut,
      widths: [2],
      formats: ['avif', 'webp'],
    })

    expect(opaqueManifest.sources.avif).toBeDefined()
    expect(transparentManifest.sources.avif).toBeUndefined()
    expect(transparentManifest.sources.webp).toBeDefined()
    expect(transparentManifest.sources.png).toBeDefined()
  })

  test('builds a deterministic catalog with bounded source concurrency', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ts-images-catalog-'))
    outputDirectories.push(outDir)
    const input = join(import.meta.dir, 'fixtures/og-image.jpg')
    const options = {
      entries: [
        { key: '/images/hero.jpg', input },
        { key: '/images/card.jpg', input },
      ],
      outDir,
      baseUrl: '/_images',
      widths: [64],
      formats: ['webp'] as const,
      fallbackFormat: 'jpeg' as const,
      includeOriginal: false,
      batchConcurrency: 2,
    }
    const first = await createImageDeliveryCatalog(options)
    const second = await createImageDeliveryCatalog(options)

    expect(Object.keys(first.entries)).toEqual(['/images/hero.jpg', '/images/card.jpg'])
    expect(first.fingerprint).toHaveLength(64)
    expect(second.fingerprint).toBe(first.fingerprint)
    expect(first.entries['/images/hero.jpg'].sources.webp).toContain('/_images/')
  })

  test('rejects duplicate catalog keys before processing files', async () => {
    await expect(createImageDeliveryCatalog({
      entries: [
        { key: '/same.jpg', input: new Uint8Array() },
        { key: '/same.jpg', input: new Uint8Array() },
      ],
      outDir: '/tmp/ts-images-duplicate-key-test',
    })).rejects.toThrow('Duplicate image catalog key')
  })

  test('deduplicates simultaneous identical generations', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ts-images-dedupe-'))
    outputDirectories.push(outDir)
    const options = { input: fixture, outDir, widths: [48], formats: ['jpeg'] as const, placeholder: false }
    const [first, second] = await Promise.all([
      createImageDeliveryManifest(options),
      createImageDeliveryManifest(options),
    ])
    expect(second.variants.map(variant => variant.cacheKey)).toEqual(first.variants.map(variant => variant.cacheKey))
  })

  test('applies named crop presets before resolving defaults', () => {
    const options = resolveImageDeliveryOptions({ input: fixture, outDir: '/tmp/images', preset: 'avatar', widths: [32] })
    expect(options.widths).toEqual([32])
    expect(options.aspectRatio).toBe(1)
    expect(options.fit).toBe('cover')
  })

  test('authorizes before reading source metadata', async () => {
    let called = false
    await expect(createImageDeliveryManifest({
      input: '/path/that/must/not/be/read.png',
      outDir: '/tmp/images',
      authorize: () => {
        called = true
        return false
      },
    })).rejects.toThrow('not authorized')
    expect(called).toBe(true)
  })

  test('publishes variants through a storage adapter', async () => {
    const objects = new Map<string, Uint8Array>()
    const manifest = await createImageDeliveryManifest({
      input: fixture,
      preset: 'avatar',
      widths: [32],
      formats: ['webp'],
      fallbackFormat: 'png',
      placeholder: false,
      storage: {
        cacheNamespace: 'test-memory',
        stat: async key => objects.has(key) ? { bytes: objects.get(key)!.byteLength, url: `https://cdn.example/${key}` } : null,
        write: async (key, bytes) => { objects.set(key, bytes) },
      },
    })
    expect(manifest.variants).toHaveLength(2)
    expect(manifest.variants.every(variant => variant.width === 32 && variant.height === 32)).toBe(true)
    expect(manifest.variants.every(variant => variant.url.startsWith('https://cdn.example/'))).toBe(true)
  })
})
