import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createImageData } from '../src/core/image-data'
import { decode, encode } from '../src/codecs'
import { loadFont } from '../src/font'
import { renderSocialCard, socialCardMetrics } from '../src/og'

/**
 * The eyebrow keeps to the copy's column, as the title and subtitle do. It was
 * drawn at its full width, so a long one - a page's address,
 * `site.com/features/performance-analytics` - ran on across the product shot
 * beside it.
 */

// A real TrueType face is needed to draw anything. Skipped rather than failed
// where one is not on the machine, matching the other card tests.
const FONT = '/Users/chris/Code/Fonts/Satoshi/WEB/fonts/Satoshi-Bold.ttf'
const hasFont = existsSync(FONT)
const font = hasFont ? loadFont(new Uint8Array(await readFile(FONT))) : (null as never)

describe.if(hasFont)('a card\'s eyebrow', () => {
  it('stops at the edge of the copy, before the shot beside it', async () => {
    const shot = join(await mkdtemp(join(tmpdir(), 'og-eyebrow-')), 'shot.png')
    await writeFile(shot, await encode(createImageData(400, 300, { fill: { r: 0, g: 0, b: 0, a: 1 } }), 'png'))
    const accent = { r: 255, g: 0, b: 0, a: 1 }
    const bytes = await renderSocialCard({
      title: 'Performance analytics',
      eyebrow: 'hq.training/features/performance-analytics/and-then-some-more',
      titleFont: font,
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      color: { r: 0, g: 0, b: 0, a: 1 },
      accent,
      foreground: { image: shot, shadow: undefined },
      format: 'png',
    })
    const card = await decode(bytes)
    const { padding, textWidth } = socialCardMetrics({ foreground: { aspect: 400 / 300 } })
    // Nothing in the accent colour right of the copy's column.
    let stray = 0
    for (let y = 0; y < card.height; y++) {
      for (let x = padding + textWidth + 2; x < card.width; x++) {
        const at = (y * card.width + x) * 4
        if (card.data[at]! > 200 && card.data[at + 1]! < 90 && card.data[at + 2]! < 90)
          stray++
      }
    }
    expect(stray).toBe(0)
  })
})
