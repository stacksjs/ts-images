import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decode, detectFormat } from '../src/codecs'

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(import.meta.dir, 'fixtures', name)))

/** An `ftyp` box with the given major and compatible brands, padded past the 12-byte sniff. */
function ftyp(major: string, compatible: string[]): Uint8Array {
  const size = 16 + compatible.length * 4
  const bytes = new Uint8Array(size + 8)
  new DataView(bytes.buffer).setUint32(0, size)
  bytes.set(new TextEncoder().encode(`ftyp${major}\0\0\0\0${compatible.join('')}`), 4)
  return bytes
}

describe('HEIF', () => {
  it('tells HEIC from AVIF when both use a generic major brand', () => {
    expect(detectFormat(ftyp('heic', ['mif1', 'heic']))).toBe('heif')
    expect(detectFormat(ftyp('mif1', ['mif1', 'heic']))).toBe('heif')
    expect(detectFormat(ftyp('mif1', ['mif1', 'avif']))).toBe('avif')
    expect(detectFormat(ftyp('avif', ['mif1', 'miaf']))).toBe('avif')
    expect(detectFormat(ftyp('isom', ['mp41']))).toBeNull()
  })

  it('decodes an iPhone photo to the pixels Apple renders', async () => {
    const heic = fixture('iphone-small.heic')
    expect(detectFormat(heic)).toBe('heif')

    const image = await decode(heic)
    const truth = await decode(fixture('iphone-small.groundtruth.jpg'))
    expect([image.width, image.height]).toEqual([truth.width, truth.height])

    let squared = 0
    let samples = 0
    for (let i = 0; i < image.data.length; i += 4 * 13) {
      for (let c = 0; c < 3; c++) {
        const d = image.data[i + c] - truth.data[i + c]
        squared += d * d
        samples++
      }
    }
    const psnr = 10 * Math.log10((255 * 255) / (squared / samples))
    // The ground truth is itself a lossy JPEG, so this measures "the same
    // photo", not bit-exactness - a wrong colour matrix or a missing tile
    // lands far below.
    expect(psnr).toBeGreaterThan(30)
  }, 30_000)
})
