import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { decode } from '../src/codecs'
import { loadFont } from '../src/font'
import { renderSocialCard } from '../src/og'

/**
 * A card is set at 1200px and mostly seen at 300-500px. At the default sizes
 * the subtitle lands near 7px and the eyebrow near 6px in a chat thread, so a
 * card that has to read small needs them larger. `titleSize` was the only one
 * a caller could set.
 */

const FONT = '/Users/chris/Code/Fonts/Satoshi/WEB/fonts/Satoshi-Bold.ttf'
const hasFont = existsSync(FONT)
const font = hasFont ? loadFont(new Uint8Array(await readFile(FONT))) : (null as never)

const base = {
  title: 'Mario Adrion',
  eyebrow: 'On tour',
  subtitle: 'Stand-up comedian.',
  titleFont: font,
  backgroundColor: { r: 0, g: 0, b: 0 },
  format: 'png' as const,
}

/** Lit pixels in a horizontal band, as a share of the band. */
async function ink(bytes: Uint8Array, from: number, to: number): Promise<number> {
  const image = await decode(bytes)
  let lit = 0
  for (let y = Math.round(image.height * from); y < Math.round(image.height * to); y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4]! > 96)
        lit++
    }
  }
  return lit
}

describe.if(hasFont)('card text sizes', () => {
  it('draws the subtitle at the size asked for', async () => {
    const small = await renderSocialCard(base)
    const large = await renderSocialCard({ ...base, subtitleSize: 60 })

    // The subtitle sits at the foot of the card.
    expect(await ink(large, 0.8, 1)).toBeGreaterThan((await ink(small, 0.8, 1)) * 2)
  })

  it('draws the eyebrow at the size asked for', async () => {
    const small = await renderSocialCard({ ...base, subtitle: undefined })
    const large = await renderSocialCard({ ...base, subtitle: undefined, eyebrowSize: 60 })

    // Everything but the eyebrow is identical, so all of the extra ink is it.
    expect(await ink(large, 0, 1)).toBeGreaterThan((await ink(small, 0, 1)) * 1.2)
  })

  it('keeps the defaults when no size is given', async () => {
    const implicit = await renderSocialCard(base)
    const explicit = await renderSocialCard({ ...base, subtitleSize: Math.round(1200 * 0.0245), eyebrowSize: Math.round(1200 * 0.019) })

    expect(Buffer.from(explicit).equals(Buffer.from(implicit))).toBe(true)
  })
})
