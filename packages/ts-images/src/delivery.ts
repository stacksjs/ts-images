import type { ImageData, ResizeFit, ResizeOptions } from './core'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { decode, encode } from './codecs'
import { resize } from './core'
import { imageToSplatHash, splatHashToBase64, splatHashToDataURL } from './splathash'

export type WebImageFormat = 'avif' | 'webp' | 'jpeg' | 'png'
export type ImageDeliveryPreset = 'avatar' | 'content' | 'hero' | 'thumbnail'

export interface ImageStoredObject {
  bytes: number
  path?: string
  url?: string
}

export interface ImageDeliveryStorage {
  cacheNamespace: string
  stat: (_key: string) => Promise<ImageStoredObject | null>
  write: (_key: string, _bytes: Uint8Array, _metadata: { contentType: string, cacheControl: string }) => Promise<ImageStoredObject | void>
  url?: (_key: string) => string | Promise<string>
}

export interface ImageAuthorizationRequest {
  input: string | Uint8Array
  name?: string
  context?: unknown
}

export interface ImageDeliveryOptions {
  input: string | Uint8Array
  outDir?: string
  storage?: ImageDeliveryStorage
  authorize?: (_request: ImageAuthorizationRequest) => boolean | Promise<boolean>
  authorizationContext?: unknown
  preset?: ImageDeliveryPreset
  name?: string
  baseUrl?: string
  widths?: readonly number[]
  height?: number
  aspectRatio?: number
  fit?: ResizeFit
  position?: ResizeOptions['position']
  formats?: readonly WebImageFormat[]
  fallbackFormat?: Extract<WebImageFormat, 'jpeg' | 'png'>
  quality?: number | Partial<Record<WebImageFormat, number>>
  concurrency?: number
  upscale?: boolean
  includeOriginal?: boolean
  placeholder?: boolean
}

export interface ImageVariant {
  path: string
  url: string
  width: number
  height: number
  bytes: number
  format: WebImageFormat
  mimeType: string
  cacheKey: string
}

export interface ImageDeliveryManifest {
  source: { width: number, height: number, hash: string }
  variants: ImageVariant[]
  sources: Partial<Record<WebImageFormat, string>>
  fallback: ImageVariant
  placeholder?: { hash: string, dataUrl: string }
}

export interface ImageDeliveryCatalogEntry {
  /** Stable public identifier used by consumers to look the image up. */
  key: string
  input: string | Uint8Array
  /** Optional output basename. Defaults to the entry key. */
  name?: string
  /** Per-image overrides layered over the catalog defaults. */
  options?: Partial<Omit<ImageDeliveryOptions, 'input' | 'name'>>
}

export interface ImageDeliveryCatalogOptions extends Omit<ImageDeliveryOptions, 'input' | 'name'> {
  entries: readonly ImageDeliveryCatalogEntry[]
  /** Number of source images processed concurrently. */
  batchConcurrency?: number
}

export interface ImageDeliveryCatalog {
  entries: Record<string, ImageDeliveryManifest>
  /** Content-derived digest suitable for build cache invalidation. */
  fingerprint: string
}

export interface SelectedImageVariant {
  variant: ImageVariant
  headers: Record<string, string>
}

interface WeightedMediaType {
  type: string
  quality: number
  order: number
}

const formatMimeTypes: Record<WebImageFormat, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

const formatExtensions: Record<WebImageFormat, string> = {
  avif: 'avif',
  webp: 'webp',
  jpeg: 'jpg',
  png: 'png',
}

const activeGenerations = new Map<string, Promise<ImageDeliveryManifest>>()

const deliveryPresets: Record<ImageDeliveryPreset, Partial<ImageDeliveryOptions>> = {
  avatar: { widths: [64, 128, 256, 512], aspectRatio: 1, fit: 'cover', position: 'center', includeOriginal: false },
  content: { widths: [320, 640, 960, 1280, 1920], fit: 'inside' },
  hero: { widths: [640, 1280, 1920, 2560], aspectRatio: 16 / 9, fit: 'cover', position: 'center' },
  thumbnail: { widths: [160, 320, 640], aspectRatio: 16 / 9, fit: 'cover', position: 'center', includeOriginal: false },
}

export function resolveImageDeliveryOptions(options: ImageDeliveryOptions): ImageDeliveryOptions {
  const preset = options.preset ? deliveryPresets[options.preset] : undefined
  return { ...preset, ...options }
}

function clampQuality(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError('Image quality must be a finite number')
  return Math.max(1, Math.min(100, Math.round(value)))
}

function getQuality(quality: ImageDeliveryOptions['quality'], format: WebImageFormat): number {
  if (typeof quality === 'number') return clampQuality(quality)
  return clampQuality(quality?.[format] ?? (format === 'png' ? 100 : 82))
}

function normalizeName(input: string | Uint8Array, name?: string): string {
  const requested = name ?? (typeof input === 'string' ? basename(input, extname(input)) : 'image')
  const normalized = requested.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!normalized) throw new TypeError('Image name must contain at least one letter or number')
  return normalized
}

function normalizeBaseUrl(baseUrl = ''): string {
  return baseUrl ? baseUrl.replace(/\/$/, '') : ''
}

function buildUrl(baseUrl: string, filename: string): string {
  return baseUrl ? `${baseUrl}/${encodeURIComponent(filename)}` : filename
}

function canonicalFormats(formats: readonly WebImageFormat[], fallback: WebImageFormat): WebImageFormat[] {
  const unique = [...new Set([...formats, fallback])]
  if (unique.length === 0) throw new TypeError('At least one image format is required')
  return unique
}

export function normalizeImageWidths(widths: readonly number[], sourceWidth: number, upscale = false, includeOriginal = true): number[] {
  if (!Number.isInteger(sourceWidth) || sourceWidth < 1) throw new TypeError('Source width must be a positive integer')

  const normalized = widths.map((width) => {
    if (!Number.isFinite(width) || width < 1 || width > 16_384) throw new TypeError('Image widths must be between 1 and 16384')
    return Math.round(width)
  })

  if (normalized.length === 0) normalized.push(sourceWidth)
  if (!upscale && includeOriginal) normalized.push(sourceWidth)

  const result = [...new Set(normalized)]
    .filter(width => upscale || width <= sourceWidth)
    .sort((a, b) => a - b)

  if (result.length === 0) result.push(sourceWidth)
  return result
}

function parseAccept(accept: string): WeightedMediaType[] {
  return accept
    .split(',')
    .map((entry, order) => {
      const [rawType, ...parameters] = entry.trim().toLowerCase().split(';')
      const q = parameters.find(parameter => parameter.trim().startsWith('q='))?.split('=')[1]
      const parsedQuality = q === undefined ? 1 : Number.parseFloat(q)
      return {
        type: rawType,
        quality: Number.isFinite(parsedQuality) ? Math.max(0, Math.min(1, parsedQuality)) : 0,
        order,
      }
    })
    .filter(entry => entry.type && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.order - b.order)
}

export function negotiateImageFormat(
  accept: string | null | undefined,
  available: readonly WebImageFormat[],
  fallback: WebImageFormat = 'jpeg',
): WebImageFormat {
  const supported = new Set(available)
  if (supported.size === 0) throw new TypeError('At least one available image format is required')

  for (const entry of parseAccept(accept ?? '*/*')) {
    if (entry.type === '*/*' || entry.type === 'image/*') break
    const match = (Object.entries(formatMimeTypes) as Array<[WebImageFormat, string]>)
      .find(([format, mimeType]) => mimeType === entry.type && supported.has(format))
    if (match) return match[0]
  }

  if (supported.has(fallback)) return fallback
  return available[0]
}

async function writeAtomically(path: string, bytes: Uint8Array): Promise<void> {
  const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, bytes)
    await rename(temporaryPath, path)
  }
  catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

function localStorage(outDir: string, baseUrl: string): ImageDeliveryStorage {
  return {
    // Deliberately free of `outDir`. This namespace is folded into the content
    // hash that names every variant, so anything in it becomes part of the
    // filename. The absolute directory is not a property of the artifact —
    // it is where this particular build happens to put it — and including it
    // breaks every consumer that builds the same tree from a new path each
    // time. Atomic-release deploys do exactly that:
    //
    //   releases/<sha-1>/images  ->  hero-44338d78039b57e4-640.webp
    //   releases/<sha-2>/images  ->  hero-301f828bdc402f4a-640.webp
    //
    // Identical bytes, identical options, a different name — so `stat()` never
    // finds what the last release wrote, every deploy re-encodes the whole
    // directory, and the old generation is left behind forever.
    //
    // The base URL stays, because two targets publishing into different URL
    // spaces genuinely are different artifacts. Two builds writing the same
    // URL space from different directories are not.
    cacheNamespace: `local:${baseUrl}`,
    async stat(key) {
      const path = join(outDir, key)
      const value = await stat(path).catch(() => null)
      return value ? { bytes: value.size, path, url: buildUrl(baseUrl, key) } : null
    },
    async write(key, bytes) {
      await mkdir(outDir, { recursive: true })
      const path = join(outDir, key)
      await writeAtomically(path, bytes)
      return { bytes: bytes.byteLength, path, url: buildUrl(baseUrl, key) }
    },
    url: key => buildUrl(baseUrl, key),
  }
}

/**
 * Hand the event loop a full turn.
 *
 * `await` alone only drains microtasks, and decoding or encoding an image is a
 * long synchronous stretch inside one. A batch of them therefore starves
 * everything the host has queued on the macrotask side — timers, and, when the
 * host is a server, the socket callbacks that answer requests. A zero-delay
 * timer is the yield point that lets those run.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

async function mapConcurrent<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++
      // Before each item, not after: the yield has to sit between two pieces
      // of codec work, and the last item has nothing following it to separate.
      // Costs one timer per image — unmeasurable next to decoding one.
      await yieldToEventLoop()
      output[index] = await work(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return output
}

function hashDelivery(bytes: Uint8Array, options: object): string {
  return createHash('sha256')
    .update(bytes)
    .update('\0')
    .update(JSON.stringify(options))
    .digest('hex')
}

function createSrcset(variants: ImageVariant[]): string {
  return variants.map(variant => `${variant.url} ${variant.width}w`).join(', ')
}

function hasVisibleAlpha(image: ImageData): boolean {
  if (!image.hasAlpha) return false
  for (let index = 3; index < image.data.length; index += 4) {
    if (image.data[index] !== 255) return true
  }
  return false
}

async function generateManifest(options: ImageDeliveryOptions): Promise<ImageDeliveryManifest> {
  const sourceBytes = typeof options.input === 'string'
    ? new Uint8Array(await readFile(options.input))
    : options.input
  const source = await decode(sourceBytes)
  if (options.height !== undefined && (!Number.isInteger(options.height) || options.height < 1 || options.height > 16_384)) {
    throw new TypeError('Image height must be between 1 and 16384')
  }
  if (options.aspectRatio !== undefined && (!Number.isFinite(options.aspectRatio) || options.aspectRatio <= 0 || options.aspectRatio > 100)) {
    throw new TypeError('Image aspect ratio must be between 0 and 100')
  }
  if (options.height !== undefined && options.aspectRatio !== undefined) throw new TypeError('Image height and aspect ratio are mutually exclusive')
  const fallbackFormat = options.fallbackFormat ?? (source.hasAlpha ? 'png' : 'jpeg')
  const formats = canonicalFormats(options.formats ?? ['avif', 'webp'], fallbackFormat)
    // The bundled AVIF codec intentionally rejects transparency until it can
    // preserve an alpha plane. Never fail an otherwise optimizable transparent
    // image, and never flatten it: WebP + PNG remain lossless-alpha outputs.
    .filter(format => format !== 'avif' || !hasVisibleAlpha(source))
  const widths = normalizeImageWidths(options.widths ?? [320, 640, 960, 1280, 1920], source.width, options.upscale, options.includeOriginal)
  const concurrency = Math.max(1, Math.min(32, Math.round(options.concurrency ?? 4)))
  const name = normalizeName(options.input, options.name)
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  if (!options.storage && !options.outDir) throw new TypeError('Image delivery requires outDir or a storage adapter')
  const storage = options.storage ?? localStorage(options.outDir!, baseUrl)
  const deliveryOptions = {
    formats,
    widths,
    quality: formats.map(format => [format, getQuality(options.quality, format)]),
    upscale: options.upscale ?? false,
    includeOriginal: options.includeOriginal ?? true,
    height: options.height,
    aspectRatio: options.aspectRatio,
    fit: options.fit ?? 'inside',
    position: options.position ?? 'center',
    storage: storage.cacheNamespace,
  }
  const sourceHash = createHash('sha256').update(sourceBytes).digest('hex')
  const deliveryHash = hashDelivery(sourceBytes, deliveryOptions).slice(0, 16)

  const tasks = formats.flatMap(format => widths.map(width => ({ format, width })))
  const variants = await mapConcurrent(tasks, concurrency, async ({ format, width }) => {
    const filename = `${name}-${deliveryHash}-${width}.${formatExtensions[format]}`
    const requestedHeight = options.height ?? (options.aspectRatio ? Math.max(1, Math.round(width / options.aspectRatio)) : undefined)
    const fit = options.fit ?? 'inside'
    const position = options.position ?? 'center'
    const existing = await storage.stat(filename)
    let generated: ImageData | undefined
    if (!existing) {
      const unchanged = width === source.width && requestedHeight === undefined
      generated = unchanged ? source : resize(source, { width, height: requestedHeight, fit, position })
      if (!options.upscale && (generated.width > source.width || generated.height > source.height)) {
        throw new TypeError(`Image variant ${generated.width}x${generated.height} would upscale the source`)
      }
      const encoded = await encode(generated, format, { quality: getQuality(options.quality, format) })
      await storage.write(filename, encoded, {
        contentType: formatMimeTypes[format],
        cacheControl: 'public, max-age=31536000, immutable',
      })
    }
    const file = await storage.stat(filename)
    if (!file) throw new Error(`Image storage did not persist ${filename}`)
    const output = generated ?? (requestedHeight === undefined
      ? { width, height: Math.max(1, Math.round(source.height * (width / source.width))) }
      : resize(source, { width, height: requestedHeight, fit, position }))
    return {
      path: file.path ?? filename,
      url: file.url ?? await storage.url?.(filename) ?? buildUrl(baseUrl, filename),
      width: output.width,
      height: output.height,
      bytes: file.bytes,
      format,
      mimeType: formatMimeTypes[format],
      cacheKey: `${sourceHash}:${deliveryHash}:${format}:${width}`,
    } satisfies ImageVariant
  })

  const sources: ImageDeliveryManifest['sources'] = {}
  for (const format of formats) {
    sources[format] = createSrcset(variants.filter(variant => variant.format === format))
  }

  const fallbackVariants = variants.filter(variant => variant.format === fallbackFormat)
  const fallback = fallbackVariants.at(-1)
  if (!fallback) throw new Error(`No ${fallbackFormat} fallback variant was generated`)

  const placeholder = options.placeholder === false
    ? undefined
    : (() => {
        const hash = imageToSplatHash(source)
        return { hash: splatHashToBase64(hash), dataUrl: splatHashToDataURL(hash) }
      })()

  return {
    source: { width: source.width, height: source.height, hash: sourceHash },
    variants,
    sources,
    fallback,
    placeholder,
  }
}

export async function createImageDeliveryManifest(options: ImageDeliveryOptions): Promise<ImageDeliveryManifest> {
  const resolved = resolveImageDeliveryOptions(options)
  if (resolved.authorize && !await resolved.authorize({
    input: resolved.input,
    name: resolved.name,
    context: resolved.authorizationContext,
  })) throw new Error('Image delivery is not authorized')
  const sourceBytes = typeof resolved.input === 'string'
    ? new Uint8Array(await readFile(resolved.input))
    : resolved.input
  const key = hashDelivery(sourceBytes, {
    outDir: resolved.outDir,
    storage: resolved.storage?.cacheNamespace,
    name: resolved.name,
    baseUrl: resolved.baseUrl,
    widths: resolved.widths,
    height: resolved.height,
    aspectRatio: resolved.aspectRatio,
    fit: resolved.fit,
    position: resolved.position,
    formats: resolved.formats,
    fallbackFormat: resolved.fallbackFormat,
    quality: resolved.quality,
    upscale: resolved.upscale,
    includeOriginal: resolved.includeOriginal,
    placeholder: resolved.placeholder,
  })
  const active = activeGenerations.get(key)
  if (active) return active

  const generation = generateManifest({ ...resolved, input: sourceBytes })
  activeGenerations.set(key, generation)
  try {
    return await generation
  }
  finally {
    activeGenerations.delete(key)
  }
}

/**
 * Build a deterministic group of responsive image manifests.
 *
 * Frameworks should use this instead of coordinating one manifest promise per
 * template. It bounds source-level concurrency, rejects duplicate public keys,
 * and returns one digest that can participate in an HTML build cache key.
 */
export async function createImageDeliveryCatalog(options: ImageDeliveryCatalogOptions): Promise<ImageDeliveryCatalog> {
  const { entries, batchConcurrency = 4, ...defaults } = options
  if (!Number.isInteger(batchConcurrency) || batchConcurrency < 1 || batchConcurrency > 32)
    throw new TypeError('Image catalog concurrency must be between 1 and 32')

  const seen = new Set<string>()
  for (const entry of entries) {
    if (!entry.key.trim()) throw new TypeError('Image catalog keys cannot be empty')
    if (seen.has(entry.key)) throw new TypeError(`Duplicate image catalog key: ${entry.key}`)
    seen.add(entry.key)
  }

  const manifests = await mapConcurrent([...entries], batchConcurrency, async (entry) => {
    const manifest = await createImageDeliveryManifest({
      ...defaults,
      ...entry.options,
      input: entry.input,
      name: entry.name ?? entry.key,
    })
    return [entry.key, manifest] as const
  })

  const catalogEntries = Object.fromEntries(manifests)
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(manifests.map(([key, manifest]) => ({
      key,
      source: manifest.source.hash,
      variants: manifest.variants.map(variant => variant.cacheKey),
      placeholder: manifest.placeholder?.hash ?? null,
    }))))
    .digest('hex')

  return { entries: catalogEntries, fingerprint }
}

export function selectImageVariant(
  manifest: ImageDeliveryManifest,
  options: { accept?: string | null, width?: number } = {},
): SelectedImageVariant {
  const formats = [...new Set(manifest.variants.map(variant => variant.format))]
  const format = negotiateImageFormat(options.accept, formats, manifest.fallback.format)
  const candidates = manifest.variants.filter(variant => variant.format === format).sort((a, b) => a.width - b.width)
  if (candidates.length === 0) throw new Error(`Manifest has no ${format} variants`)

  const requestedWidth = Math.max(1, Math.round(options.width ?? candidates.at(-1)!.width))
  const variant = candidates.find(candidate => candidate.width >= requestedWidth) ?? candidates.at(-1)!
  return {
    variant,
    headers: {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(variant.bytes),
      'Content-Type': variant.mimeType,
      'ETag': `"${variant.cacheKey}"`,
      'Vary': 'Accept',
    },
  }
}
