import { describe, expect, test } from 'bun:test'
import { ACTIVITY_SHARE_CARD_PRESETS, activityShareCardFileName, activityShareCardSvg, activityShareRoutePath } from '../src/activity-card'

const route = [
  { lat: 37.7749, lng: -122.4194 },
  { lat: 37.779, lng: -122.414 },
  { lat: 37.781, lng: -122.407 },
]

describe('activity share cards', () => {
  test('renders a square card with activity details and route', () => {
    const svg = activityShareCardSvg({
      activityType: 'Trail run',
      athlete: 'Chris',
      completedAt: 'August 12, 2026',
      distance: '8.42 mi',
      duration: '1:07:32',
      elevation: '1,284 ft',
      pace: '8:01 /mi',
      route,
      title: 'Headlands sunrise',
    })

    expect(svg).toContain('width="1080" height="1080"')
    expect(svg).toContain('id="activity-route"')
    expect(svg).toContain('8.42 mi')
    expect(svg).toContain('1:07:32')
    expect(svg).toContain('1,284 ft')
    expect(svg).toContain('Chris')
  })

  test('brands the card with the loop mark and the Wildloop name by default', () => {
    const svg = activityShareCardSvg({ activityType: 'Run', distance: '5 km', duration: '25:00', route, title: 'Loop' })

    expect(svg).toContain('>Wildloop</text>')
    expect(svg).not.toContain('WildLoop')
    // The ring, not the old check badge.
    expect(svg).toContain('r="13" fill="none" stroke="#34d399"')
    expect(svg).not.toContain('M8 -10 L14 -3 L27 -20')
  })

  test('draws a caller-supplied mark and name in every preset', () => {
    const mark = '<rect data-test-mark width="34" height="34"/>'
    for (const preset of ['landscape', 'square', 'story'] as const) {
      const svg = activityShareCardSvg({ activityType: 'Run', brand: 'Acme', distance: '5 km', duration: '25:00', mark, preset, route, title: 'Loop' })
      expect(svg).toContain(mark)
      expect(svg).toContain('>Acme</text>')
      expect(svg).not.toContain('r="13" fill="none"')
    }
  })

  test('uses the requested social preset dimensions', () => {
    for (const preset of ['landscape', 'square', 'story'] as const) {
      const svg = activityShareCardSvg({ activityType: 'Hike', distance: '5 km', duration: '48:20', preset, route, title: 'Forest loop' })
      const size = ACTIVITY_SHARE_CARD_PRESETS[preset]
      expect(svg).toContain(`viewBox="0 0 ${size.width} ${size.height}"`)
    }
  })

  test('escapes user content and rejects unsafe accent values', () => {
    const svg = activityShareCardSvg({
      accent: 'url(javascript:alert(1))',
      activityType: '<script>',
      distance: '4 & 5',
      duration: '20:00',
      route,
      title: 'Run <home>',
    })
    expect(svg).not.toContain('<script>')
    expect(svg).not.toContain('javascript:')
    expect(svg).toContain('Run &lt;home&gt;')
    expect(svg).toContain('4 &amp; 5')
    expect(svg).toContain('#34d399')
  })

  test('normalizes valid route points into a bounded path', () => {
    const path = activityShareRoutePath([...route, { lat: Number.NaN, lng: 20 }], { x: 10, y: 20, width: 200, height: 100, padding: 10 })
    expect(path).toStartWith('M')
    expect(path).toContain(' L')
    expect(path).not.toContain('NaN')
  })

  test('creates safe, predictable download names', () => {
    expect(activityShareCardFileName('Café Ridge Run', 'story')).toBe('cafe-ridge-run-story.png')
    expect(activityShareCardFileName('!!!')).toBe('activity-square.png')
  })
})
