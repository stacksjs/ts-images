# Splash Screens

`generateSplashScreens` makes the launch images an iOS and an Android app need from one logo: a mark centred on the colour the platform paints, sharp at every density, with nothing cropped on any screen shape.

A launch screen is not a picture of the whole screen. iOS draws its launch image centred at its own size in points over a background colour, and Android 12 draws a splash icon inside a circle over its own colour. A full-screen image gets cropped on every device whose shape it was not made for, and blurred on every one whose density it was not made for. So the preset renders the mark (the logo, an optional line of text and a soft glow) at its size in points, once per scale, and leaves the background to the platform. The app's first frame then continues that same colour.

## Usage

```ts
import { generateSplashScreens } from 'ts-images'

const splash = await generateSplashScreens({
  logo: 'public/logo.svg', // SVG, PNG, JPEG or WebP
  accent: '#dd0f15', // the glow's colour
  light: { background: '#ffffff' },
  dark: { background: '#000000' }, // or `dark: false` for one appearance
  text: { value: 'Last Soul Ultra', font: 'fonts/Barlow-Regular.ttf', uppercase: true },
}, 'build/splash')

splash.ios?.image // build/splash/ios/LaunchLogo.imageset/LaunchLogo.png (@2x, @3x beside it)
splash.ios?.imageDark // …/LaunchLogo-dark.png
splash.android?.resources // build/splash/android/res
splash.backgrounds // { light: '#ffffff', dark: '#000000' }
```

What it writes:

| Platform | Files |
| --- | --- |
| iOS | `LaunchLogo.imageset/LaunchLogo.png`, `@2x`, `@3x`, the `-dark` set and `Contents.json` |
| Android | `res/drawable-<density>/splash_icon.png`: Android 12's 288dp splash icon, its content inside the 192dp circle |
| Android | `res/drawable-<density>/splash_logo.png`: the same mark for the window background before Android 12 |
| Android | `res/drawable-night-<density>/…` for Dark Mode |

Hand the files to [Craft](https://github.com/stacksjs/craft) as `splashImagePath` / `splashImagePathDark` (iOS) and `splashResources` (Android), with `backgroundColor` / `backgroundColorDark` set to `splash.backgrounds`. A Stacks app gets all of this from `buddy build:ios` and `buddy build:android` without asking.

## Options

| Option | Default | |
| --- | --- | --- |
| `logo` | | A path, file bytes or decoded pixels |
| `light`, `dark` | white, black | Each takes `background`, its own `logo`, `tint`, `glow` and `textColor` |
| `accent` | the logo's colour | The glow's colour in both appearances |
| `size` | `96` | The logo's optical size in points (the side of a square of the same area), or `'intrinsic'` for the size the file states |
| `maxWidth`, `maxHeight` | `240`, `128` | The largest the logo is drawn, in points |
| `shape` | `'none'` | `'rounded'` or `'circle'` to mask a full-bleed square such as an app icon |
| `glow`, `glowStrength` | `true`, `1` | A soft radial glow that fades out before the image's edge |
| `text` | | A line under the logo: `value`, `font` (a `.ttf`), `size`, `letterSpacing`, `uppercase`, `gap` |
| `trim` | `true` | Crop the logo's transparent margin before sizing it |
| `platforms` | both | `['ios']` or `['android']` |

A logo that would not read on its background (under 1.6:1 contrast, such as a white mark on a white Light Mode background) is repainted in near-black or near-white unless that appearance gives a `tint`.

## In memory and previews

`renderSplashScreens(options)` returns the same images as PNG bytes with their paths, without writing anything. `renderSplashPreview(options, { device: 'iphone-se', appearance: 'dark' })` draws one launch screen at a device's real size, which is the quickest way to check a splash before it goes into an app.
