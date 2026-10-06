# ts-images

A powerful image optimization and manipulation toolkit for modern web development. This is the core library package of the imgx project.

## Installation

```bash
bun add ts-images -d
# or
npm install ts-images --save-dev
```

## Usage

### Library

```typescript
import { optimizeImage, processImage } from 'ts-images'

// Optimize a single image
await optimizeImage('input.jpg', {
  quality: 80,
  format: 'webp',
  output: 'output.webp',
})

// Process with advanced options
await processImage('photo.png', {
  resize: { width: 800, height: 600 },
  format: 'avif',
  quality: 75,
})
```

### Activity share cards

Create branded, browser-safe SVG cards for activity feeds, downloads, and native social sharing. The card includes a normalized route trace and the activity's key metrics without embedding source coordinates in the output.

```typescript
import { activityShareCardSvg } from 'ts-images/activity-card'

const svg = activityShareCardSvg({
  activityType: 'Trail run',
  athlete: 'Chris',
  completedAt: 'August 12, 2026',
  distance: '8.42 mi',
  duration: '1:07:32',
  elevation: '1,284 ft',
  pace: '8:01 /mi',
  preset: 'story',
  route: recordedPoints,
  title: 'Headlands sunrise',
})
```

Use `square` for feed posts, `story` for vertical stories, and `landscape` for link previews. `activityShareCardFileName()` creates a safe download name for the selected preset.

To draw the route on a real map, give the card a basemap made for the same preset. The best one is vector: draw your map style with ts-maps' `renderStaticMap()` into the preset's map box, with the card's own projection, so the route lands on the streets it ran and the map stays sharp at any size:

```typescript
import { ACTIVITY_SHARE_MAP_BOXES, activityShareCardSvg, activityShareProjection } from 'ts-images/activity-card'
import { renderStaticMap } from 'ts-maps/static'

const box = ACTIVITY_SHARE_MAP_BOXES.landscape
const projection = activityShareProjection(recordedPoints, 'landscape')!
const map = await renderStaticMap({ style, width: box.width, height: box.height, view: projection })

const svg = activityShareCardSvg({
  ...card,
  preset: 'landscape',
  basemap: { preset: 'landscape', projection, markup: map.markup, attribution: map.attribution },
})
```

For a raster tile server, `activityShareBasemap()` fetches the tiles under the map box and inlines them as `data:` URIs instead, choosing the zoom so at least two tile pixels sit under every card pixel (`pixelRatio`, default 2). Pass `tileSize: 512` for @2x tiles, or an array of URLs to stack layers. A tile that fails is left out, and if none load the result is `null` and the plain card is drawn.

A map shows where the route is, so add one only when the person sharing is the person who ran it.

### CLI

```bash
# Optimize an image
imgx optimize input.jpg --quality 80 --format webp

# Batch process images
imgx batch ./images --format webp --quality 80

# Generate app icons
imgx app-icon logo.png --output ./icons

# Generate favicons
imgx favicon logo.svg --output ./public

# Optimize SVGs
imgx svg-optimize ./svgs
```

## Features

- **Format Conversion** - Convert between JPEG, PNG, WebP, AVIF, GIF, BMP
- **Image Optimization** - Lossy and lossless compression with smart quality settings
- **Batch Processing** - Process multiple images with configurable pipelines
- **App Icon Generation** - Generate iOS, macOS, and Android app icons from a single source
- **Favicon Generation** - Generate all required favicon sizes and formats
- **SVG Optimization** - Minify and optimize SVG files via SVGO
- **Image Placeholders** - Generate ThumbHash and BlurHash placeholders
- **Responsive Images** - Generate multiple sizes for responsive web design
- **Watermarking** - Add text or image watermarks
- **Image to SVG** - Convert raster images to SVG using potrace
- **Activity Share Cards** - Render route-aware square, story, and landscape social assets

## Supported Formats

| Format | Decode | Encode |
|--------|--------|--------|
| JPEG | Yes | Yes |
| PNG | Yes | Yes |
| WebP | Yes | Yes |
| AVIF | Yes | Yes |
| GIF | Yes | Yes |
| BMP | Yes | Yes |
| SVG | Yes | - |

## License

MIT
