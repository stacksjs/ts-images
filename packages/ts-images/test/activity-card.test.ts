import { describe, expect, test } from 'bun:test'
import { ACTIVITY_SHARE_CARD_PRESETS, ACTIVITY_SHARE_MAP_BOXES, activityShareBasemap, activityShareMapReserve, activityShareCardFileName, activityShareCardSvg, activityShareProjection, activityShareRoutePath } from '../src/activity-card'

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

  test('fits the route inside the map box when projected for a basemap', () => {
    const projection = activityShareProjection(route, 'landscape')!
    const path = activityShareRoutePath(route, { x: 664, y: 72, width: 464, height: 486 }, projection)
    const coords = [...path.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])] as const)
    expect(coords.length).toBe(route.length)
    for (const [x, y] of coords) {
      expect(x).toBeGreaterThanOrEqual(664 + 60 - 0.1)
      expect(x).toBeLessThanOrEqual(664 + 464 - 60 + 0.1)
      expect(y).toBeGreaterThanOrEqual(72 + 60 - 0.1)
      expect(y).toBeLessThanOrEqual(72 + 486 - 60 + 0.1)
    }
    // North stays up: the northernmost point is drawn highest.
    expect(coords[2]![1]).toBeLessThan(coords[0]![1])
  })

  test('fetches the tiles that cover the map box and inlines them', async () => {
    const requested: string[] = []
    const fetch = async (url: string) => {
      requested.push(url)
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })
    }
    const basemap = (await activityShareBasemap(route, { attribution: '© OpenStreetMap', fetch, preset: 'square', tileSize: 512, tileUrl: 'https://{s}.tiles.test/{z}/{x}/{y}@2x.png' }))!
    expect(basemap.preset).toBe('square')
    expect(basemap.tiles!.length).toBe(requested.length)
    expect(requested[0]).toMatch(/^https:\/\/[abc]\.tiles\.test\/\d+\/\d+\/\d+@2x\.png$/)
    for (const tile of basemap.tiles!) {
      expect(tile.href).toStartWith('data:image/png;base64,')
      // Two tile pixels under every card pixel, and no more detail than that.
      expect(tile.size).toBeGreaterThan(128)
      expect(tile.size).toBeLessThanOrEqual(256)
    }
    // Together the tiles cover the whole box.
    const box = { x: 72, y: 284, width: 936, height: 476 }
    expect(Math.min(...basemap.tiles!.map(t => t.x))).toBeLessThanOrEqual(box.x)
    expect(Math.min(...basemap.tiles!.map(t => t.y))).toBeLessThanOrEqual(box.y)
    expect(Math.max(...basemap.tiles!.map(t => t.x + t.size))).toBeGreaterThanOrEqual(box.x + box.width)
    expect(Math.max(...basemap.tiles!.map(t => t.y + t.size))).toBeGreaterThanOrEqual(box.y + box.height)

    const svg = activityShareCardSvg({ activityType: 'Run', basemap, distance: '5 km', duration: '25:00', route, title: 'Loop' })
    expect(svg).toContain('clip-path="url(#map-clip)"')
    expect(svg).toContain('<image href="data:image/png;base64,')
    expect(svg).toContain('© OpenStreetMap')
    expect(svg).toContain('id="activity-route"')
  })

  test('stacks layers in order, each over the same tiles', async () => {
    const requested: string[] = []
    const fetch = async (url: string) => {
      requested.push(url)
      return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })
    }
    // Long enough that the fit, not the zoom limit, decides the scale.
    const coast = [{ lat: 32.94, lng: -117.26 }, { lat: 32.85, lng: -117.27 }, { lat: 32.76, lng: -117.25 }]
    const basemap = (await activityShareBasemap(coast, { fetch, preset: 'landscape', tileUrl: ['https://base.test/{z}/{y}/{x}', 'https://labels.test/{z}/{y}/{x}'] }))!
    const half = requested.length / 2
    expect(requested.slice(0, half).every(url => url.startsWith('https://base.test/'))).toBe(true)
    expect(requested.slice(half).every(url => url.startsWith('https://labels.test/'))).toBe(true)
    expect(requested.slice(half).map(url => url.replace('labels', 'base'))).toEqual(requested.slice(0, half))
    // 256px tiles at the default pixel ratio of 2 are drawn at most 128 wide.
    expect(basemap.tiles![0]!.size).toBeLessThanOrEqual(128)
  })

  test('draws the plain card when the basemap belongs to another preset or no tile loads', async () => {
    const fetch = async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })
    const basemap = await activityShareBasemap(route, { fetch, preset: 'story', tileUrl: 'https://tiles.test/{z}/{x}/{y}.png' })
    const svg = activityShareCardSvg({ activityType: 'Run', basemap, distance: '5 km', duration: '25:00', preset: 'square', route, title: 'Loop' })
    expect(svg).not.toContain('<image')

    const failing = async () => new Response('nope', { status: 503 })
    expect(await activityShareBasemap(route, { fetch: failing, tileUrl: 'https://tiles.test/{z}/{x}/{y}.png' })).toBeNull()
    expect(await activityShareBasemap([], { fetch, tileUrl: 'https://tiles.test/{z}/{x}/{y}.png' })).toBeNull()
  })

  test('draws a vector basemap given as markup, in the map box\'s coordinates', () => {
    const projection = activityShareProjection(route, 'story')!
    const box = ACTIVITY_SHARE_MAP_BOXES.story
    const markup = `<rect data-test-map width="${box.width}" height="${box.height}" fill="#0b1220"/>`
    const svg = activityShareCardSvg({ activityType: 'Run', basemap: { attribution: '© OpenStreetMap', markup, preset: 'story', projection }, distance: '5 km', duration: '25:00', preset: 'story', route, title: 'Loop' })
    expect(svg).toContain(`<g transform="translate(${box.x} ${box.y})"><rect data-test-map`)
    expect(svg).toContain('clip-path="url(#map-clip)"')
    expect(svg).not.toContain('<image')
    expect(svg).toContain('© OpenStreetMap')
    // The credit's pill sits inside the reserved corner.
    const [left, top, right, bottom] = activityShareMapReserve('story')
    const pill = svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="28" rx="14"/)!
    expect(Number(pill[1]) - box.x).toBeGreaterThanOrEqual(left)
    expect(Number(pill[2]) - box.y).toBeGreaterThanOrEqual(top)
    expect(Number(pill[1]) + Number(pill[3]) - box.x).toBeLessThanOrEqual(right)
    expect(Number(pill[2]) + 28 - box.y).toBeLessThanOrEqual(bottom)
  })
})
