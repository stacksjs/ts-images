# App Store Screenshots

App Store Connect accepts up to ten screenshots per device class. Most listings
ship one, because producing ten — per device, per release, with the copy in
step — is a day's work by hand every time anything changes.

`generateAppStoreScreenshots` takes a list of slides and a list of device
classes and renders every combination at Apple's exact pixel dimensions.

PNG screenshots are encoded as RGB without an alpha channel. App Store
Connect rejects alpha channels even when every pixel is opaque. Rendered
compositions containing transparent pixels are rejected with an actionable
error. Ordinary PNG encoding continues to preserve requested
transparency.

## Slides in, listing out

```ts
import { generateAppStoreScreenshots, loadFont, parseColor } from 'ts-images'
import { readFile } from 'node:fs/promises'

const titleFont = loadFont(new Uint8Array(await readFile('fonts/Inter-Bold.ttf')))
const bodyFont = loadFont(new Uint8Array(await readFile('fonts/Inter-Regular.ttf')))

const screenshots = await generateAppStoreScreenshots({
  outputDir: 'resources/app-store/screenshots',
  displayTypes: ['APP_IPHONE_67', 'APP_IPAD_PRO_3GEN_129', 'APP_DESKTOP'],
  titleFont,
  bodyFont,
  brand: 'Very Good AdBlock',
  color: parseColor('#fbf3f3'),
  background: {
    color: parseColor('#120b0c'),
    gradient: { angle: 165, stops: [
      { offset: 0, color: parseColor('#120b0c') },
      { offset: 1, color: parseColor('#1e1214') },
    ] },
    glows: [{ x: 0.84, y: 0.08, radius: 0.62, color: parseColor('#ef444438') }],
  },
  device: { radius: 0.035, borderColor: parseColor('#ffffff14'), shadow: {} },
  slides: [
    {
      capture: 'captures/popup.png',
      headline: 'Ads gone before the page loads.',
      subheadline: 'Blocks ads, pop-ups, and trackers at the source.',
    },
    {
      capture: 'captures/dashboard.png',
      headline: 'Every block, counted.',
      subheadline: 'Lifetime totals and per-site history — all of it local.',
    },
  ],
})
```

The result is keyed by display type, in slide order — the shape App Store
Connect's screenshot sets are declared in:

```ts
{
  APP_IPHONE_67: ['…/app-iphone-67-01.png', '…/app-iphone-67-02.png'],
  APP_IPAD_PRO_3GEN_129: ['…/app-ipad-pro-3gen-129-01.png', …],
  APP_DESKTOP: ['…/app-desktop-01.png', …],
}
```

## Captures

`capture` is a screenshot of the app itself, at whatever size it was taken.
Getting it is the one step this cannot do: drive the app with whatever can, and
capture the surface raw — no frame, no caption, no device bezel. The framing
happens here.

Captures are decoded once and reused across every device class, so the same
popup PNG costs one decode whether it feeds one listing or six.

Crop the capture from the top rather than the middle, which is what this does: a
screenshot's identity is in its first few hundred pixels.

## Display types and sizes

| Display type | Size |
| --- | --- |
| `APP_IPHONE_67` | 1290×2796 |
| `APP_IPHONE_65` | 1242×2688 |
| `APP_IPHONE_61` | 1179×2556 |
| `APP_IPHONE_58` | 1125×2436 |
| `APP_IPHONE_55` | 1242×2208 |
| `APP_IPAD_PRO_3GEN_129` | 2048×2732 |
| `APP_IPAD_PRO_3GEN_11` | 1668×2388 |
| `APP_IPAD_PRO_129` | 2048×2732 |
| `APP_IPAD_105` | 1668×2224 |
| `APP_IPAD_97` | 1536×2048 |
| `APP_DESKTOP` | 2880×1800 |

Apple accepts more than one size for several classes; the table uses the larger,
because a store screenshot is downsampled for display and never upsampled.

## Layout

`layout` defaults to `auto`: a landscape canvas puts the copy in a column beside
the capture, a portrait one stacks the copy above it. Forcing the split on a
portrait frame leaves the headline in a narrow gutter set over twenty lines,
which is why the default is not a single arrangement.

Match the capture's shape to the device class. A wide dashboard capture on a
1290×2796 phone frame can only be so large before it runs out of width, and the
slack shows as empty background. Capture a portrait-shaped surface for phone
slides.

## Limits

App Store Connect rejects a set larger than ten, and so does this — before
rendering, rather than at upload:

```ts
export const APP_STORE_MAX_SCREENSHOTS = 10
```

## One-off frames

For a localized variant or a promotional image at a size Apple does not list,
render a single frame directly:

```ts
import { generateAppStoreScreenshot } from 'ts-images'

await generateAppStoreScreenshot('promo.png', { width: 1200, height: 1200 }, {
  capture: 'captures/popup.png',
  headline: 'Ads gone before the page loads.',
}, { titleFont })
```
