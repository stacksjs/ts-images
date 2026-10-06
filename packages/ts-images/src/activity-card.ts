export type ActivityShareCardPreset = 'landscape' | 'square' | 'story'

export interface ActivitySharePoint {
  lat: number
  lng: number
}

export interface ActivityShareMetric {
  label: string
  value: string
}

export interface ActivityShareCardOptions {
  accent?: string
  activityType: string
  athlete?: string
  /** The name beside the mark. Defaults to `Wildloop`. */
  brand?: string
  /**
   * The logo drawn before the brand name, as SVG markup in a 34×34 box with
   * its origin at the top left. Trusted markup — it is inserted as given, so
   * pass your own artwork, never user input. Defaults to the loop mark: a ring
   * with the runner's position on it, in the accent colour.
   */
  mark?: string
  completedAt?: string
  distance: string
  duration: string
  elevation?: string
  location?: string
  pace?: string
  preset?: ActivityShareCardPreset
  route: ActivitySharePoint[]
  title: string
  /**
   * Map tiles to draw under the route, from `activityShareBasemap()`. Without
   * one the route is drawn on its own over a plain panel. With one the route is
   * projected exactly as the tiles are, so it sits on the streets it ran.
   */
  basemap?: ActivityShareBasemap | null
}

/**
 * Where the map box's top-left corner is in Web Mercator (the world as a unit
 * square, 0..1 on each axis), and how many card pixels one unit spans.
 */
export interface ActivityShareProjection {
  left: number
  scale: number
  top: number
}

export interface ActivityShareTile {
  /** The tile image, normally a `data:` URI so the card stays self-contained. */
  href: string
  size: number
  x: number
  y: number
}

export interface ActivityShareBasemap {
  /** Plain text, drawn in the map's corner, e.g. `© OpenStreetMap`. */
  attribution?: string
  /**
   * A map already drawn as SVG, such as ts-maps' `renderStaticMap()`, in the
   * map box's own coordinates (0..width × 0..height) and with the same
   * `projection`. Vector, so it stays sharp at any size. Trusted markup: it is
   * inserted as given.
   */
  markup?: string
  preset: ActivityShareCardPreset
  projection: ActivityShareProjection
  /** Image tiles, from `activityShareBasemap()`. Drawn under `markup`. */
  tiles?: ActivityShareTile[]
}

/** A tile URL template with `{z}`, `{x}`, `{y}` and optionally `{s}` (a, b or c), or a function of the tile. */
export type ActivityShareTileSource = string | ((tile: { x: number, y: number, z: number }) => string)

export interface ActivityShareBasemapOptions {
  attribution?: string
  /** Defaults to `globalThis.fetch`. */
  fetch?: (url: string) => Promise<Response>
  /** The most detailed tile zoom to ask for. Defaults to 16. */
  maxZoom?: number
  /**
   * Tile pixels to put under every card pixel. Defaults to 2, so a card
   * exported at twice its size, or viewed on a retina screen, stays sharp.
   */
  pixelRatio?: number
  preset?: ActivityShareCardPreset
  /**
   * The tiles, or several layers of them drawn bottom first, such as a base
   * map and its labels. Every layer must use the same tiling and `tileSize`.
   */
  tileUrl: ActivityShareTileSource | ActivityShareTileSource[]
  /** The width of one fetched tile in pixels: 256, or 512 for @2x tiles. Defaults to 256. */
  tileSize?: number
}

export interface ActivityShareCardSize {
  height: number
  width: number
}

export interface ActivityRouteBox {
  height: number
  padding?: number
  width: number
  x: number
  y: number
}

export const ACTIVITY_SHARE_CARD_PRESETS: Readonly<Record<ActivityShareCardPreset, ActivityShareCardSize>> = Object.freeze({
  landscape: Object.freeze({ width: 1200, height: 630 }),
  square: Object.freeze({ width: 1080, height: 1080 }),
  story: Object.freeze({ width: 1080, height: 1920 }),
})

const DEFAULT_ACCENT = '#34d399'

/** Where each preset draws its map. A basemap is made for one of these. */
export const ACTIVITY_SHARE_MAP_BOXES: Readonly<Record<ActivityShareCardPreset, Readonly<ActivityRouteBox>>> = Object.freeze({
  landscape: Object.freeze({ x: 664, y: 72, width: 464, height: 486, padding: 60 }),
  square: Object.freeze({ x: 72, y: 284, width: 936, height: 476, padding: 62 }),
  story: Object.freeze({ x: 72, y: 432, width: 936, height: 930, padding: 90 }),
})

/** A basemap only fits the box it was fetched for, so another preset's is ignored. */
function basemapFor(options: ActivityShareCardOptions, preset: ActivityShareCardPreset): ActivityShareBasemap | null {
  return options.basemap && options.basemap.preset === preset ? options.basemap : null
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;')
}

function cleanText(value: string | undefined, fallback = ''): string {
  const normalized = value?.replace(/\s+/g, ' ').trim() || fallback
  return escapeXml(normalized)
}

function truncate(value: string | undefined, maxLength: number, fallback = ''): string {
  const normalized = value?.replace(/\s+/g, ' ').trim() || fallback
  if (normalized.length <= maxLength)
    return escapeXml(normalized)

  return escapeXml(`${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`)
}

function safeAccent(value: string | undefined): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_ACCENT
}

function finiteRoute(route: ActivitySharePoint[]): ActivitySharePoint[] {
  const valid = route.filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng))
  if (valid.length <= 320)
    return valid

  const step = (valid.length - 1) / 319
  return Array.from({ length: 320 }, (_, index) => valid[Math.round(index * step)]!)
}

function mercatorX(lng: number): number {
  return (lng + 180) / 360
}

function mercatorY(lat: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const radians = clamped * Math.PI / 180
  return (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) / 2
}

export function activityShareRoutePath(route: ActivitySharePoint[], box: ActivityRouteBox, projection?: ActivityShareProjection | null): string {
  const points = finiteRoute(route)
  if (points.length === 0)
    return ''

  if (projection) {
    return points.map((point, index) => {
      const x = box.x + (mercatorX(point.lng) - projection.left) * projection.scale
      const y = box.y + (mercatorY(point.lat) - projection.top) * projection.scale
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    }).join(' ')
  }

  const padding = Math.max(0, box.padding ?? 48)
  const availableWidth = Math.max(1, box.width - padding * 2)
  const availableHeight = Math.max(1, box.height - padding * 2)
  const minLng = Math.min(...points.map(point => point.lng))
  const maxLng = Math.max(...points.map(point => point.lng))
  const minLat = Math.min(...points.map(point => point.lat))
  const maxLat = Math.max(...points.map(point => point.lat))
  const lngRange = Math.max(maxLng - minLng, Number.EPSILON)
  const latRange = Math.max(maxLat - minLat, Number.EPSILON)
  const scale = Math.min(availableWidth / lngRange, availableHeight / latRange)
  const drawnWidth = lngRange * scale
  const drawnHeight = latRange * scale
  const offsetX = box.x + padding + (availableWidth - drawnWidth) / 2
  const offsetY = box.y + padding + (availableHeight - drawnHeight) / 2

  return points.map((point, index) => {
    const x = offsetX + (point.lng - minLng) * scale
    const y = offsetY + (maxLat - point.lat) * scale
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
}

export function activityShareCardFileName(title: string, preset: ActivityShareCardPreset = 'square'): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'activity'

  return `${slug}-${preset}.png`
}

function metricMarkup(metrics: ActivityShareMetric[], x: number, y: number, width: number, columns: number, valueSize: number): string {
  const gap = 22
  const cellWidth = (width - gap * (columns - 1)) / columns
  return metrics.map((metric, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const metricX = x + column * (cellWidth + gap)
    const metricY = y + row * 116
    return `<g transform="translate(${metricX} ${metricY})">
      <text class="label" y="0">${cleanText(metric.label)}</text>
      <text class="metric" y="48" font-size="${valueSize}">${truncate(metric.value, 18, '—')}</text>
    </g>`
  }).join('')
}

function basemapMarkup(basemap: ActivityShareBasemap, box: ActivityRouteBox): string {
  // Each tile is drawn half a pixel wider than its slot, so no hairline of the
  // panel shows between neighbours once the card is rasterised.
  const tiles = (basemap.tiles ?? []).map(tile => `<image href="${escapeXml(tile.href)}" x="${tile.x.toFixed(2)}" y="${tile.y.toFixed(2)}" width="${(tile.size + 0.5).toFixed(2)}" height="${(tile.size + 0.5).toFixed(2)}" preserveAspectRatio="none"/>`).join('')
  const attribution = basemap.attribution
    ? `<text x="${box.x + box.width - 22}" y="${box.y + box.height - 18}" text-anchor="end" fill="#f3f7f5" fill-opacity="0.62" font-size="13" font-weight="560">${truncate(basemap.attribution, 64)}</text>`
    : ''
  return `<clipPath id="map-clip"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="36"/></clipPath>
    <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="36" fill="#101c19"/>
    <g clip-path="url(#map-clip)">${tiles}${basemap.markup ? `<g transform="translate(${box.x} ${box.y})">${basemap.markup}</g>` : ''}
      <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="url(#map-shade)"/>
    </g>
    ${attribution}
    <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="36" fill="none" stroke="#ffffff" stroke-opacity="0.12"/>`
}

function mapMarkup(route: ActivitySharePoint[], box: ActivityRouteBox, accent: string, basemap?: ActivityShareBasemap | null): string {
  const path = activityShareRoutePath(route, box, basemap?.projection)
  const hasRoute = path.length > 0
  const start = hasRoute ? path.match(/^M([\d.]+) ([\d.]+)/) : null
  const end = hasRoute ? path.match(/L([\d.]+) ([\d.]+)$/) ?? start : null
  const radius = Math.min(box.width, box.height) * 0.03
  const routeMarkup = hasRoute
    ? `<path id="activity-route" d="${path}" fill="none" stroke="#06120f" stroke-opacity="0.55" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${path}" fill="none" stroke="${accent}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${start?.[1]}" cy="${start?.[2]}" r="${radius}" fill="#f3f7f5" stroke="#101c19" stroke-width="7"/>
    <circle cx="${end?.[1]}" cy="${end?.[2]}" r="${radius}" fill="${accent}" stroke="#101c19" stroke-width="7"/>`
    : `<text x="${box.x + box.width / 2}" y="${box.y + box.height / 2}" text-anchor="middle" class="label">ROUTE UNAVAILABLE</text>`
  if (basemap && ((basemap.tiles?.length ?? 0) > 0 || basemap.markup))
    return `<g>${basemapMarkup(basemap, box)}${routeMarkup}</g>`

  return `<g>
    <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="36" fill="#101c19" stroke="#ffffff" stroke-opacity="0.1"/>
    <path d="M${box.x - 20} ${box.y + box.height * 0.32} C${box.x + box.width * 0.22} ${box.y + box.height * 0.08}, ${box.x + box.width * 0.6} ${box.y + box.height * 0.54}, ${box.x + box.width + 30} ${box.y + box.height * 0.18}" fill="none" stroke="#ffffff" stroke-opacity="0.055" stroke-width="3"/>
    <path d="M${box.x - 30} ${box.y + box.height * 0.76} C${box.x + box.width * 0.26} ${box.y + box.height * 0.45}, ${box.x + box.width * 0.7} ${box.y + box.height * 0.98}, ${box.x + box.width + 40} ${box.y + box.height * 0.62}" fill="none" stroke="#ffffff" stroke-opacity="0.055" stroke-width="3"/>
    ${routeMarkup}
  </g>`
}

function baseStyle(accent: string): string {
  return `<style>
    text { font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .brand { fill: #f3f7f5; font-size: 31px; font-weight: 800; letter-spacing: -1px; }
    .kicker, .label { fill: #aab9b3; font-size: 17px; font-weight: 700; letter-spacing: 2.2px; }
    .title { fill: #f3f7f5; font-weight: 750; letter-spacing: -2.4px; }
    .metric { fill: #f3f7f5; font-weight: 720; letter-spacing: -1.6px; }
    .accent { fill: ${accent}; }
  </style>`
}

function defs(accent: string): string {
  return `<defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#07110f"/>
      <stop offset="0.62" stop-color="#0b1714"/>
      <stop offset="1" stop-color="#10251e"/>
    </linearGradient>
    <linearGradient id="map-shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#07110f" stop-opacity="0.05"/>
      <stop offset="0.75" stop-color="#07110f" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#07110f" stop-opacity="0.45"/>
    </linearGradient>
    <radialGradient id="glow" cx="100%" cy="0%" r="85%">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.2"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>`
}

/** The name a card carries when the caller names none. */
const DEFAULT_BRAND = 'Wildloop'

/**
 * The default mark, in its 34×34 box: a closed ring with the runner's position
 * on it, the same mark the Wildloop site draws beside its wordmark. It used to
 * be a check in a filled circle, which is nobody's logo and read as a
 * "completed" badge rather than a brand.
 */
function loopMark(accent: string): string {
  return `<circle cx="17" cy="19" r="13" fill="none" stroke="${accent}" stroke-width="4"/>
    <circle cx="17" cy="6" r="5.5" fill="${accent}" stroke="#07110f" stroke-width="3"/>`
}

function brandMarkup(options: ActivityShareCardOptions, x: number, y: number, accent: string): string {
  // The mark's box spans y -27..7 around the brand baseline, which is where
  // the old 17px-radius badge sat, so every preset keeps its spacing.
  return `<g transform="translate(${x} ${y})">
    <g transform="translate(0 -27)">${options.mark || loopMark(accent)}</g>
    <text x="49" class="brand">${truncate(options.brand, 24, DEFAULT_BRAND)}</text>
  </g>`
}

function metadataMarkup(options: ActivityShareCardOptions, x: number, y: number, maxLength: number): string {
  const metadata = [options.athlete, options.completedAt, options.location].filter(Boolean).join('  ·  ')
  return metadata ? `<text x="${x}" y="${y}" fill="#aab9b3" font-size="20" font-weight="520">${truncate(metadata, maxLength)}</text>` : ''
}

function landscapeCard(options: ActivityShareCardOptions, accent: string): string {
  const map = ACTIVITY_SHARE_MAP_BOXES.landscape
  const metrics = [
    { label: 'DISTANCE', value: options.distance },
    { label: 'MOVING TIME', value: options.duration },
    { label: 'AVG PACE', value: options.pace || '—' },
    { label: 'ELEVATION', value: options.elevation || '—' },
  ]
  return `${brandMarkup(options, 72, 66, accent)}
  <text x="72" y="158" class="accent kicker">${truncate(options.activityType.toUpperCase(), 28)}</text>
  <text x="72" y="220" class="title" font-size="57">${truncate(options.title, 26)}</text>
  ${metadataMarkup(options, 72, 262, 42)}
  ${metricMarkup(metrics, 72, 350, 520, 2, 38)}
  ${mapMarkup(options.route, map, accent, basemapFor(options, 'landscape'))}`
}

function squareCard(options: ActivityShareCardOptions, accent: string): string {
  const map = ACTIVITY_SHARE_MAP_BOXES.square
  const metrics = [
    { label: 'DISTANCE', value: options.distance },
    { label: 'MOVING TIME', value: options.duration },
    { label: 'AVG PACE', value: options.pace || '—' },
    { label: 'ELEVATION', value: options.elevation || '—' },
  ]
  return `${brandMarkup(options, 72, 68, accent)}
  <text x="72" y="158" class="accent kicker">${truncate(options.activityType.toUpperCase(), 30)}</text>
  <text x="72" y="222" class="title" font-size="60">${truncate(options.title, 31)}</text>
  ${metadataMarkup(options, 72, 258, 66)}
  ${mapMarkup(options.route, map, accent, basemapFor(options, 'square'))}
  ${metricMarkup(metrics, 72, 842, 936, 4, 34)}`
}

function storyCard(options: ActivityShareCardOptions, accent: string): string {
  const map = ACTIVITY_SHARE_MAP_BOXES.story
  const metrics = [
    { label: 'DISTANCE', value: options.distance },
    { label: 'MOVING TIME', value: options.duration },
    { label: 'AVG PACE', value: options.pace || '—' },
    { label: 'ELEVATION', value: options.elevation || '—' },
  ]
  return `${brandMarkup(options, 72, 94, accent)}
  <text x="72" y="226" class="accent kicker">${truncate(options.activityType.toUpperCase(), 30)}</text>
  <text x="72" y="310" class="title" font-size="72">${truncate(options.title, 27)}</text>
  ${metadataMarkup(options, 72, 362, 68)}
  ${mapMarkup(options.route, map, accent, basemapFor(options, 'story'))}
  ${metricMarkup(metrics, 72, 1504, 936, 2, 48)}
  <text x="72" y="1842" fill="#71817b" font-size="18" font-weight="650" letter-spacing="1.5">MOVE OUTSIDE. CLAIM YOUR LOOP.</text>`
}

export function activityShareCardSvg(options: ActivityShareCardOptions): string {
  const preset = options.preset || 'square'
  const size = ACTIVITY_SHARE_CARD_PRESETS[preset]
  const accent = safeAccent(options.accent)
  const content = preset === 'landscape'
    ? landscapeCard(options, accent)
    : preset === 'story'
      ? storyCard(options, accent)
      : squareCard(options, accent)

  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="card-title card-description" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">
  <title id="card-title">${cleanText(options.title, 'Outdoor activity')}</title>
  <desc id="card-description">${cleanText(options.activityType, 'Activity')} activity card with route, distance, duration, pace, and elevation.</desc>
  ${defs(accent)}
  ${baseStyle(accent)}
  <rect width="${size.width}" height="${size.height}" fill="url(#background)"/>
  <rect width="${size.width}" height="${size.height}" fill="url(#glow)"/>
  ${content}
</svg>`
}

/** Fits the route into a preset's map box: the same fit the card draws it with. */
export function activityShareProjection(route: ActivitySharePoint[], preset: ActivityShareCardPreset = 'square', maxZoom = 16): ActivityShareProjection | null {
  const points = finiteRoute(route)
  if (points.length === 0)
    return null

  const box = ACTIVITY_SHARE_MAP_BOXES[preset]
  const padding = box.padding ?? 48
  const xs = points.map(point => mercatorX(point.lng))
  const ys = points.map(point => mercatorY(point.lat))
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const fit = Math.min(
    (box.width - padding * 2) / Math.max(maxX - minX, Number.EPSILON),
    (box.height - padding * 2) / Math.max(maxY - minY, Number.EPSILON),
  )
  // Never closer than the most detailed tiles, never so far out that the
  // world no longer covers the box.
  const scale = Math.max(Math.max(box.width, box.height), Math.min(fit, 256 * 2 ** maxZoom))
  return {
    left: (minX + maxX) / 2 - box.width / 2 / scale,
    scale,
    top: (minY + maxY) / 2 - box.height / 2 / scale,
  }
}

function tileHref(template: ActivityShareTileSource, tile: { x: number, y: number, z: number }): string {
  if (typeof template === 'function')
    return template(tile)
  return template
    .replaceAll('{z}', String(tile.z))
    .replaceAll('{x}', String(tile.x))
    .replaceAll('{y}', String(tile.y))
    .replaceAll('{s}', 'abc'[(tile.x + tile.y) % 3]!)
}

function base64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined')
    return Buffer.from(bytes).toString('base64')
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

/**
 * Fetches the map tiles a card needs to draw the route on a real map, and
 * inlines them as `data:` URIs so the SVG renders anywhere: in an `<img>`, on a
 * canvas, or as a file. Pass the result as `basemap` with the same `preset`.
 *
 * A tile that fails to load is left out, and if none load this resolves to
 * `null`, which draws the plain card. A basemap shows where the route is, so
 * only add one when the person sharing is the person who ran it.
 */
export async function activityShareBasemap(route: ActivitySharePoint[], options: ActivityShareBasemapOptions): Promise<ActivityShareBasemap | null> {
  const preset = options.preset || 'square'
  const maxZoom = Math.max(0, Math.min(22, Math.round(options.maxZoom ?? 16)))
  const projection = activityShareProjection(route, preset, maxZoom)
  const doFetch = options.fetch ?? globalThis.fetch?.bind(globalThis)
  if (!projection || !doFetch)
    return null

  const box = ACTIVITY_SHARE_MAP_BOXES[preset]
  const tileSize = Math.max(1, options.tileSize ?? 256)
  const pixelRatio = Math.max(0.25, options.pixelRatio ?? 2)
  const sources = Array.isArray(options.tileUrl) ? options.tileUrl : [options.tileUrl]
  // The least detailed zoom that still puts `pixelRatio` tile pixels under
  // every card pixel.
  const zoom = Math.max(0, Math.min(maxZoom, Math.ceil(Math.log2(projection.scale * pixelRatio / tileSize))))
  const count = 2 ** zoom
  const size = projection.scale / count
  const right = projection.left + box.width / projection.scale
  const bottom = projection.top + box.height / projection.scale
  const wanted: { source: ActivityShareTileSource, x: number, y: number, z: number, at: { x: number, y: number } }[] = []
  for (const source of sources) {
    for (let ty = Math.max(0, Math.floor(projection.top * count)); ty <= Math.min(count - 1, Math.floor(bottom * count)); ty++) {
      for (let tx = Math.floor(projection.left * count); tx <= Math.floor(right * count); tx++) {
        wanted.push({
          source,
          x: ((tx % count) + count) % count,
          y: ty,
          z: zoom,
          at: { x: box.x + (tx / count - projection.left) * projection.scale, y: box.y + (ty / count - projection.top) * projection.scale },
        })
      }
    }
  }

  const tiles = await Promise.all(wanted.map(async (tile): Promise<ActivityShareTile | null> => {
    try {
      const response = await doFetch(tileHref(tile.source, tile))
      if (!response.ok)
        return null
      const type = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png'
      if (!type.startsWith('image/'))
        return null
      const bytes = new Uint8Array(await response.arrayBuffer())
      return { href: `data:${type};base64,${base64(bytes)}`, size, x: tile.at.x, y: tile.at.y }
    }
    catch {
      return null
    }
  }))

  const loaded = tiles.filter((tile): tile is ActivityShareTile => tile !== null)
  if (loaded.length === 0)
    return null
  return { attribution: options.attribution, preset, projection, tiles: loaded }
}
