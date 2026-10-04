import type { ImageData } from '../core/image-data'
import { applyExifOrientation, jpegExifOrientation } from '../core/exif'
import { fromCodecData, toCodecData } from '../core/image-data'

export interface EncodeOptions {
  quality?: number
  progressive?: boolean
  lossless?: boolean
  effort?: number
  [key: string]: any
}

export interface DecodeOptions {
  colorTransform?: boolean
  formatAsRGBA?: boolean
  /**
   * Re-orient JPEG pixels upright per the EXIF orientation tag
   * (default: true). The returned width/height reflect the upright image.
   */
  applyOrientation?: boolean
}

export interface ImageMetadata {
  width: number
  height: number
  format: string
  channels?: number
  bitDepth?: number
  hasAlpha?: boolean
  colorSpace?: string
}

/**
 * Codec resolution.
 *
 * ts-images is built on top of our own pure-TypeScript image libraries.
 * Each codec is loaded lazily on first use so a consumer that only ever
 * touches PNGs doesn't pay the parse cost of the AVIF + AV1 stack at
 * startup. We cache the import result because in bun, re-importing a
 * broken-symlink module on a second call hangs forever — caching the
 * first attempt (success or failure) avoids that.
 */
const _codecCache: Record<string, { module: any, available: boolean, error?: unknown }> = Object.create(null)

/**
 * One literal `import()` per codec. A bundler (and `bun build --compile`)
 * only follows specifiers it can read, so `import(name)` with a variable
 * left every codec out of compiled apps, where decoding then failed with
 * "not installed" although the package was a declared dependency.
 */
const codecLoaders: Record<string, () => Promise<any>> = {
  'ts-jpeg': () => import('ts-jpeg'),
  'ts-gif': () => import('ts-gif'),
  '@stacksjs/ts-png': () => import('@stacksjs/ts-png'),
  '@stacksjs/ts-bmp': () => import('@stacksjs/ts-bmp'),
  '@stacksjs/ts-webp': () => import('@stacksjs/ts-webp'),
  '@stacksjs/ts-avif': () => import('@stacksjs/ts-avif'),
}

async function loadCodec(name: string): Promise<any> {
  const cached = _codecCache[name]
  if (cached) {
    if (cached.available) return cached.module
    throw new Error(
      `ts-images: codec package "${name}" failed to load. `
      + `Install it with \`bun add ${name}\` (or \`npm install ${name}\`).`,
      { cause: cached.error },
    )
  }
  try {
    const loader = codecLoaders[name]
    const mod = loader ? await loader() : await import(name)
    _codecCache[name] = { module: mod, available: true }
    return mod
  }
  catch (err) {
    _codecCache[name] = { module: null, available: false, error: err }
    throw new Error(
      `ts-images: codec package "${name}" is not installed. `
      + `Install it with \`bun add ${name}\` (or \`npm install ${name}\`).`,
      { cause: err },
    )
  }
}

/**
 * Detect image format from buffer magic bytes.
 *
 * Returns null when the buffer is too short or doesn't match a known
 * signature — caller decides whether to treat that as an error.
 */
export function detectFormat(buffer: Uint8Array): string | null {
  if (buffer.length < 12) return null

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpeg'

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
    && buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
  ) return 'png'

  // GIF: "GIF"
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif'

  // BMP: "BM"
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) return 'bmp'

  // WebP: RIFF....WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return 'webp'

  // AVIF/HEIF: ftypXXXX at offset 4
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    const brand = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11])
    if (brand === 'avif' || brand === 'avis' || brand === 'mif1' || brand === 'miaf') return 'avif'
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx') return 'heif'
  }

  // TIFF: "II*\0" or "MM\0*"
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2A && buffer[3] === 0x00)
    || (buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A)
  ) return 'tiff'

  return null
}

/**
 * Read width and height from a buffer header without doing a full decode.
 *
 * Falls back to a full decode for formats whose dimension fields aren't at
 * a fixed offset (currently AVIF; the ISOBMFF box walk is cheaper than the
 * AV1 decode but still needs the codec).
 */
export function readDimensions(buffer: Uint8Array): { width: number, height: number } | null {
  const fmt = detectFormat(buffer)
  if (!fmt) return null
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  switch (fmt) {
    case 'png':
      // IHDR chunk starts at byte 8 (after signature) — width/height are
      // big-endian uint32 at bytes 16 and 20.
      if (buffer.length < 24) return null
      return { width: view.getUint32(16, false), height: view.getUint32(20, false) }

    case 'gif':
      // Logical Screen Descriptor — little-endian uint16 width@6, height@8.
      if (buffer.length < 10) return null
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) }

    case 'bmp':
      // BITMAPINFOHEADER width@18 (int32 LE), height@22 (int32 LE, may be negative).
      if (buffer.length < 26) return null
      return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) }

    case 'webp': {
      // RIFF/WEBP at byte 12 we have the four-CC of the first chunk.
      // Three sub-formats: VP8, VP8L, VP8X.
      const fourCC = String.fromCharCode(buffer[12], buffer[13], buffer[14], buffer[15])
      if (fourCC === 'VP8 ') {
        // 3-byte start code at 23, then width+height at 26 (uint16 LE, low 14 bits).
        if (buffer.length < 30) return null
        const w = view.getUint16(26, true) & 0x3FFF
        const h = view.getUint16(28, true) & 0x3FFF
        return { width: w, height: h }
      }
      if (fourCC === 'VP8L') {
        // After 5-byte VP8L chunk header, width-1 and height-1 are packed
        // into 14-bit little-endian fields starting at byte 21.
        if (buffer.length < 25) return null
        const b1 = buffer[21]
        const b2 = buffer[22]
        const b3 = buffer[23]
        const b4 = buffer[24]
        const w = 1 + (((b2 & 0x3F) << 8) | b1)
        const h = 1 + (((b4 & 0x0F) << 10) | (b3 << 2) | ((b2 & 0xC0) >> 6))
        return { width: w, height: h }
      }
      if (fourCC === 'VP8X') {
        // Canvas size minus-1, 24-bit LE at offsets 24 and 27.
        if (buffer.length < 30) return null
        const w = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16))
        const h = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16))
        return { width: w, height: h }
      }
      return null
    }

    case 'jpeg': {
      // Walk SOFn markers (0xFFC0..0xFFCF except DHT 0xC4, JPG 0xC8, DAC 0xCC).
      let p = 2
      const len = buffer.length
      while (p < len - 8) {
        if (buffer[p] !== 0xFF) return null
        // Skip fill bytes (the spec lets encoders pad markers with 0xFF).
        while (p < len && buffer[p] === 0xFF) p++
        const marker = buffer[p++]
        // Standalone markers (no length): SOI/EOI/RSTn — shouldn't appear here
        // mid-file. Everything else has a uint16 BE length right after.
        if (marker === 0xD8 || marker === 0xD9) return null
        if (marker >= 0xD0 && marker <= 0xD7) continue
        const segLen = (buffer[p] << 8) | buffer[p + 1]
        // SOFn (frame headers carry dimensions). Excludes DHT/JPG/DAC.
        if (
          (marker >= 0xC0 && marker <= 0xCF)
          && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC
        ) {
          // Layout after segLen: [precision:1][height:2 BE][width:2 BE][...]
          const h = (buffer[p + 3] << 8) | buffer[p + 4]
          const w = (buffer[p + 5] << 8) | buffer[p + 6]
          return { width: w, height: h }
        }
        p += segLen
      }
      return null
    }

    default:
      return null
  }
}

/**
 * Decode an image buffer to RGBA ImageData.
 */
export async function decode(
  buffer: Uint8Array,
  options: DecodeOptions = {},
): Promise<ImageData> {
  const format = detectFormat(buffer)
  if (!format) throw new Error('ts-images: unknown image format (no matching magic bytes)')

  switch (format) {
    case 'jpeg': {
      const image = await decodeJpeg(buffer, options)
      if (options.applyOrientation === false)
        return image
      // Cameras store sensor-native pixels + an orientation tag; without
      // this, portrait shots decode sideways.
      return applyExifOrientation(image, jpegExifOrientation(buffer))
    }
    case 'png': return decodePng(buffer, options)
    case 'gif': return decodeGif(buffer, options)
    case 'bmp': return decodeBmp(buffer, options)
    case 'webp': return decodeWebp(buffer, options)
    case 'avif': return decodeAvif(buffer, options)
    default: throw new Error(`ts-images: unsupported format "${format}"`)
  }
}

/**
 * Encode RGBA ImageData to a specific format.
 */
export async function encode(
  imageData: ImageData,
  format: string,
  options: EncodeOptions = {},
): Promise<Uint8Array> {
  switch (format) {
    case 'jpeg':
    case 'jpg': return encodeJpeg(imageData, options)
    case 'png': return encodePng(imageData, options)
    case 'gif': return encodeGif(imageData, options)
    case 'bmp': return encodeBmp(imageData, options)
    case 'webp': return encodeWebp(imageData, options)
    case 'avif': return encodeAvif(imageData, options)
    default: throw new Error(`ts-images: unsupported format "${format}"`)
  }
}

/**
 * Read image metadata (dimensions, format, alpha info) without doing a
 * full pixel decode where possible.
 */
export async function getMetadata(buffer: Uint8Array): Promise<ImageMetadata> {
  const format = detectFormat(buffer)
  if (!format) throw new Error('ts-images: unknown image format (no matching magic bytes)')

  const dims = readDimensions(buffer)
  if (dims) {
    // Cheap path: dimensions came from the header.
    // For most callers `hasAlpha` won't matter at metadata-time, so we
    // return a sensible default and only do a full decode when dims fail.
    return {
      width: dims.width,
      height: dims.height,
      format,
      channels: 4,
      bitDepth: 8,
      hasAlpha: format !== 'jpeg' && format !== 'bmp',
      colorSpace: 'srgb',
    }
  }

  // Fallback: decode (covers AVIF and any future format without a header
  // dimension reader).
  const imageData = await decode(buffer)
  return {
    width: imageData.width,
    height: imageData.height,
    format,
    channels: 4,
    bitDepth: imageData.bitDepth,
    hasAlpha: imageData.hasAlpha,
    colorSpace: imageData.colorSpace,
  }
}

// -----------------------------------------------------------------------
// Codec adapters — each thin wrapper translates the codec library's data
// layout to/from our internal `ImageData`. All packages are loaded lazily
// via `loadCodec` so a caller that only needs PNG never imports AVIF.
// -----------------------------------------------------------------------

async function decodeJpeg(buffer: Uint8Array, options: DecodeOptions): Promise<ImageData> {
  const tsJpeg = await loadCodec('ts-jpeg')
  const result = tsJpeg.decode(buffer, {
    colorTransform: options.colorTransform,
    formatAsRGBA: options.formatAsRGBA ?? true,
  })
  // ts-jpeg≤0.2 sometimes returned RGB even when formatAsRGBA was set;
  // detect by buffer length so we stay correct against older releases.
  const expectedRGBA = result.width * result.height * 4
  const channels = result.data.length === expectedRGBA ? 4 : 3
  const imageData = fromCodecData(result.data, result.width, result.height, { channels })
  imageData.hasAlpha = false
  return imageData
}

async function encodeJpeg(imageData: ImageData, options: EncodeOptions): Promise<Uint8Array> {
  const tsJpeg = await loadCodec('ts-jpeg')
  // ts-jpeg encoder takes RGBA. Quality is 0..100 with 80 as a sane default.
  const data = toCodecData(imageData, { channels: 4 })
  const result = tsJpeg.encode({
    width: imageData.width,
    height: imageData.height,
    data,
  }, options.quality ?? 80)
  return new Uint8Array(result.data)
}

async function decodePng(buffer: Uint8Array, _options: DecodeOptions): Promise<ImageData> {
  const tsPng = await loadCodec('@stacksjs/ts-png')
  const result = tsPng.png.sync.read(Buffer.from(buffer))
  return fromCodecData(result.data, result.width, result.height, { channels: 4 })
}

async function encodePng(imageData: ImageData, options: EncodeOptions): Promise<Uint8Array> {
  const tsPng = await loadCodec('@stacksjs/ts-png')
  const data = Buffer.from(Uint8Array.from(toCodecData(imageData, { channels: 4 })))
  const out = tsPng.png.sync.write({
    width: imageData.width,
    height: imageData.height,
    data,
  }, {
    deflateLevel: options.effort ?? 9,
  })
  return new Uint8Array(out)
}

async function decodeGif(buffer: Uint8Array, _options: DecodeOptions): Promise<ImageData> {
  const gif = await loadCodec('ts-gif')
  const reader = new gif.Reader(Buffer.from(buffer))
  const info = reader.frameInfo(0)
  const pixels = new Uint8Array(info.width * info.height * 4)
  reader.decodeAndBlitFrameRGBA(0, pixels)
  return fromCodecData(pixels, info.width, info.height, { channels: 4 })
}

async function encodeGif(imageData: ImageData, _options: EncodeOptions): Promise<Uint8Array> {
  const gif = await loadCodec('ts-gif')
  const { indexedPixels, palette } = quantizeImage(imageData)
  // Worst-case GIF size for an indexed image is roughly w*h plus per-block
  // overhead; allocate generously and slice to actual size on close.
  const bufSize = imageData.width * imageData.height + 1024
  const buf = Buffer.alloc(bufSize)
  const writer = new gif.Writer(buf, imageData.width, imageData.height, { palette })
  writer.addFrame(0, 0, imageData.width, imageData.height, indexedPixels)
  const finalSize = writer.end()
  return new Uint8Array(buf.slice(0, finalSize))
}

async function decodeBmp(buffer: Uint8Array, _options: DecodeOptions): Promise<ImageData> {
  const bmp = await loadCodec('@stacksjs/ts-bmp')
  const result = bmp.decode(buffer)
  return fromCodecData(result.data, result.width, result.height, { channels: 4 })
}

async function encodeBmp(imageData: ImageData, _options: EncodeOptions): Promise<Uint8Array> {
  const bmp = await loadCodec('@stacksjs/ts-bmp')
  const data = toCodecData(imageData, { channels: 4 })
  return bmp.encode({
    width: imageData.width,
    height: imageData.height,
    data,
  })
}

async function decodeWebp(buffer: Uint8Array, _options: DecodeOptions): Promise<ImageData> {
  const webp = await loadCodec('@stacksjs/ts-webp')
  const result = webp.decode(buffer)
  const channels = 4
  const imageData = fromCodecData(result.data, result.width, result.height, { channels })
  if (typeof result.hasAlpha === 'boolean') imageData.hasAlpha = result.hasAlpha
  return imageData
}

async function encodeWebp(imageData: ImageData, options: EncodeOptions): Promise<Uint8Array> {
  const webp = await loadCodec('@stacksjs/ts-webp')
  const data = toCodecData(imageData, { channels: 4 })
  // Prefer `encodeAsync` when ts-webp exposes it (>= the version
  // that added system `cwebp` integration). It tries the system
  // binary first and falls back to the bundled pure-TS encoder
  // when the binary is missing — so on any machine with libwebp
  // installed (most dev boxes + CI), this produces real, compact
  // libwebp output instead of the larger pure-TS bitstream.
  const useAsync = typeof (webp as { encodeAsync?: unknown }).encodeAsync === 'function'
  const tryEncode = async (lossless: boolean): Promise<Uint8Array> => {
    const args = [{
      width: imageData.width,
      height: imageData.height,
      data: data instanceof Uint8Array ? data : new Uint8Array(data),
      hasAlpha: imageData.hasAlpha,
    }, {
      quality: options.quality,
      lossless,
      effort: options.effort,
    }] as const
    return useAsync
      ? (webp as { encodeAsync: (...a: unknown[]) => Promise<Uint8Array> }).encodeAsync(...args)
      : webp.encode(...args)
  }
  try {
    return await tryEncode(options.lossless ?? false)
  }
  catch (err) {
    if (err instanceof Error && /lossy.*not implemented/i.test(err.message)) {
      return tryEncode(true)
    }
    throw err
  }
}

async function decodeAvif(buffer: Uint8Array, _options: DecodeOptions): Promise<ImageData> {
  const avif = await loadCodec('@stacksjs/ts-avif')
  const result = avif.decode(buffer)
  return fromCodecData(result.data, result.width, result.height, { channels: 4 })
}

async function encodeAvif(imageData: ImageData, options: EncodeOptions): Promise<Uint8Array> {
  const avif = await loadCodec('@stacksjs/ts-avif')
  const data = toCodecData(imageData, { channels: 4 })
  // Decoders normalize pixels to RGBA, so `hasAlpha` describes the source
  // channel layout rather than proving any pixel is transparent. The bundled
  // AVIF encoder accepts opaque RGBA input and only rejects real transparency;
  // inspect alpha bytes so ordinary PNGs do not get misclassified.
  let hasVisibleAlpha = false
  if (imageData.hasAlpha) {
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] !== 255) {
        hasVisibleAlpha = true
        break
      }
    }
  }
  // Prefer `encodeAsync` when ts-avif exposes it. It shells out to
  // `avifenc` (libavif) when present, which is the only path that
  // produces real AV1 image data — the bundled `encode()` writes a
  // valid container around stub frame bytes.
  const useAsync = typeof (avif as { encodeAsync?: unknown }).encodeAsync === 'function'
  const args = [{
    width: imageData.width,
    height: imageData.height,
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    hasAlpha: hasVisibleAlpha,
  }, {
    quality: options.quality,
    lossless: options.lossless,
    effort: options.effort,
  }] as const
  return useAsync
    ? (avif as { encodeAsync: (...a: unknown[]) => Promise<Uint8Array> }).encodeAsync(...args)
    : avif.encode(...args)
}

/**
 * Quantize an RGBA image to a 256-entry palette suitable for GIF.
 *
 * Uses a fixed 6×6×6 RGB cube + 40 grayscale entries. Not perceptually
 * tuned — for production-quality GIF output, callers should pre-process
 * with a dedicated palette algorithm (median-cut / Wu / NeuQuant).
 */
function quantizeImage(imageData: ImageData): { indexedPixels: Uint8Array, palette: number[] } {
  const palette: number[] = []
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        const red = Math.round(r * 255 / 5)
        const green = Math.round(g * 255 / 5)
        const blue = Math.round(b * 255 / 5)
        palette.push((red << 16) | (green << 8) | blue)
      }
    }
  }
  for (let i = 0; i < 40; i++) {
    const gray = Math.round(i * 255 / 39)
    palette.push((gray << 16) | (gray << 8) | gray)
  }

  const indexedPixels = new Uint8Array(imageData.width * imageData.height)
  for (let i = 0, j = 0; i < imageData.data.length; i += 4, j++) {
    const ri = Math.round(imageData.data[i] * 5 / 255)
    const gi = Math.round(imageData.data[i + 1] * 5 / 255)
    const bi = Math.round(imageData.data[i + 2] * 5 / 255)
    indexedPixels[j] = ri * 36 + gi * 6 + bi
  }

  return { indexedPixels, palette }
}
