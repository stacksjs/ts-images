import { describe, expect, test } from 'bun:test'
import { splatHashFromBase64, splatHashToBase64, splatHashToDataURL, rgbaToSplatHash } from '../src/splathash'

/**
 * The decoder is importable on its own, and works without the encoders.
 *
 * Producing a hash happens at build time next to the codecs, which are native
 * and Node-only. Decoding one happens in a browser, where the placeholder has
 * to be painted before the real file arrives. Importing the package root to
 * reach the decoder pulls the codecs along, so a bundler either fails on them
 * or ships them — which is why `ts-images/splathash` exists as its own entry.
 *
 * These cover the half that runs in the browser: base64 in, data URL out, with
 * nothing else loaded.
 */
describe('the splathash entry point', () => {
  // A small gradient, which is enough to produce a non-degenerate hash.
  const width = 8
  const height = 8
  const rgba = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      rgba[i] = (x / width) * 255
      rgba[i + 1] = (y / height) * 255
      rgba[i + 2] = 128
      rgba[i + 3] = 255
    }
  }

  const hash = rgbaToSplatHash(rgba, width, height)

  test('base64 round-trips to the same bytes', () => {
    const encoded = splatHashToBase64(hash)
    const decoded = splatHashFromBase64(encoded)

    expect(Array.from(decoded)).toEqual(Array.from(hash))
  })

  test('the encoded form is short enough to inline per image', () => {
    // The reason this path exists: the decoded data URL is a few kilobytes,
    // and a page with sixty cards cannot carry sixty of those in its markup.
    expect(splatHashToBase64(hash).length).toBeLessThanOrEqual(32)
  })

  test('decodes to a usable image data URL', () => {
    const url = splatHashToDataURL(splatHashFromBase64(splatHashToBase64(hash)))

    expect(url.startsWith('data:image/')).toBe(true)
    expect(url.length).toBeGreaterThan(100)
  })

  test('a malformed hash is rejected rather than half-decoded', () => {
    expect(() => splatHashFromBase64('not-a-real-hash')).toThrow()
  })
})
