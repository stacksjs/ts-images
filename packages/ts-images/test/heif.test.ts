import { describe, expect, it } from 'bun:test'
import { detectFormat } from '../src/codecs'

/** An `ftyp` box with the given major and compatible brands, padded past the 12-byte sniff. */
function ftyp(major: string, compatible: string[]): Uint8Array {
  const size = 16 + compatible.length * 4
  const bytes = new Uint8Array(size + 8)
  new DataView(bytes.buffer).setUint32(0, size)
  bytes.set(new TextEncoder().encode(`ftyp${major}\0\0\0\0${compatible.join('')}`), 4)
  return bytes
}

describe('ISOBMFF brand sniffing', () => {
  it('tells HEIC from AVIF when both use a generic major brand', () => {
    expect(detectFormat(ftyp('heic', ['mif1', 'heic']))).toBe('heif')
    expect(detectFormat(ftyp('mif1', ['mif1', 'heic']))).toBe('heif')
    expect(detectFormat(ftyp('mif1', ['mif1', 'avif']))).toBe('avif')
    expect(detectFormat(ftyp('avif', ['mif1', 'miaf']))).toBe('avif')
    expect(detectFormat(ftyp('isom', ['mp41']))).toBeNull()
  })
})
