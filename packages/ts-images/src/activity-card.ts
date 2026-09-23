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

export function activityShareRoutePath(route: ActivitySharePoint[], box: ActivityRouteBox): string {
  const points = finiteRoute(route)
  if (points.length === 0)
    return ''

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

function mapMarkup(route: ActivitySharePoint[], box: ActivityRouteBox, accent: string): string {
  const path = activityShareRoutePath(route, box)
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
  const map = { x: 664, y: 72, width: 464, height: 486, padding: 60 }
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
  ${mapMarkup(options.route, map, accent)}`
}

function squareCard(options: ActivityShareCardOptions, accent: string): string {
  const map = { x: 72, y: 284, width: 936, height: 476, padding: 62 }
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
  ${mapMarkup(options.route, map, accent)}
  ${metricMarkup(metrics, 72, 842, 936, 4, 34)}`
}

function storyCard(options: ActivityShareCardOptions, accent: string): string {
  const map = { x: 72, y: 432, width: 936, height: 930, padding: 90 }
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
  ${mapMarkup(options.route, map, accent)}
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
