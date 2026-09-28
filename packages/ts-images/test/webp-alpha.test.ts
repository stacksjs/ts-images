/**
 * A WebP encoded from a transparent image keeps its alpha channel.
 *
 * @stacksjs/ts-webp before 0.1.6 wrote a plain lossy `VP8 ` frame whatever the
 * input, so every transparent pixel came out solid. The dependency range used
 * to allow those versions, and a lockfile that already held one kept it: stx
 * then had to detect the opaque variants and fall back to PNG. The range now
 * starts at 0.1.6; this pins the behaviour the range is there for.
 */
import { describe, expect, it } from 'bun:test'
import { encode } from '../src'

function webpHasAlpha(bytes: Uint8Array): boolean {
  const text = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
  if (text(0, 4) !== 'RIFF' || text(8, 12) !== 'WEBP')
    return false
  const chunk = text(12, 16)
  if (chunk === 'VP8X')
    return (bytes[20] & 0x10) !== 0
  if (chunk === 'VP8L')
    return ((bytes[24] >>> 4) & 1) === 1
  return false
}

describe('webp encoding of a transparent image', () => {
  it('declares an alpha channel', async () => {
    const width = 16
    const height = 16
    const data = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = 255
      data[i * 4 + 1] = 255
      data[i * 4 + 2] = 255
      data[i * 4 + 3] = i % width < width / 2 ? 0 : 255
    }

    const webp = await encode({ data, width, height } as any, 'webp')
    expect(webpHasAlpha(webp)).toBe(true)
  })
})
