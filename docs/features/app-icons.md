# App Icon Generation

imgx provides powerful tools for generating app icons for iOS, macOS, and other platforms from a single source image.

## Overview

When developing applications, you need icons in various sizes for different platforms, devices, and contexts. Creating these manually is time-consuming and error-prone. imgx automates this process, generating all required icon sizes from a single high-resolution source image.

## Supported Platforms

- **iOS**: All icon sizes required for iPhone and iPad apps, including App Store icons
- **macOS**: App icons for Mac applications, including the .icns format
- **Web**: Favicon sets including various sizes and formats
- **Android**: Square and round launcher icons in every density, plus the Play Store icon

## Basic Usage

### CLI

```bash
# Generate all app icons (iOS and macOS) from a single image
imgx app-icon source-icon.png

# Generate only iOS app icons
imgx app-icon source-icon.png --platform ios

# Generate only macOS app icons
imgx app-icon source-icon.png --platform macos

# Specify output directory
imgx app-icon source-icon.png --output-dir ./assets/app-icons
```

### JavaScript/TypeScript API

```ts
import { createAppIcon } from '@stacksjs/imgx'

// Generate all app icons
const result = await createAppIcon('path/to/source-icon.png')

// Generate only iOS icons
const iosIcons = await createAppIcon('path/to/source-icon.png', {
  platform: 'ios',
  outputDir: './public/app-icons',
})

console.log(`Generated ${iosIcons.sizes.length} icons for ${iosIcons.platform}`)
```

## Source Image Requirements

For best results, your source image should meet these requirements:

- **Resolution**: At least 1024×1024 pixels (higher is better)
- **Format**: PNG with transparency
- **Content**: Place important content within the center 80% of the image (avoid corners)
- **Style**: Follow platform-specific guidelines (i.e., rounded corners for iOS)
- **Color**: Vibrant, distinctive and legible at small sizes

## Generated Icons

### iOS Icons

imgx generates all iOS app icon sizes required by Apple, including:

| Size | Purpose |
|------|---------|
| 20×20 pt @1x, @2x, @3x | Notification icon |
| 29×29 pt @1x, @2x, @3x | Settings icon |
| 40×40 pt @1x, @2x, @3x | Spotlight icon |
| 60×60 pt @2x, @3x | iPhone app icon |
| 76×76 pt @1x, @2x | iPad app icon |
| 83.5×83.5 pt @2x | iPad Pro app icon |
| 1024×1024 px | App Store icon |

The output includes a properly formatted `Contents.json` file for use in Xcode projects.

### Android Icons

`--platform android` (or `generateAndroidAppIcons`) writes, under `android/`:

| File | Size |
|------|------|
| `res/mipmap-mdpi/ic_launcher.png`, `ic_launcher_round.png` | 48×48 px |
| `res/mipmap-hdpi/…` | 72×72 px |
| `res/mipmap-xhdpi/…` | 96×96 px |
| `res/mipmap-xxhdpi/…` | 144×144 px |
| `res/mipmap-xxxhdpi/…` | 192×192 px |
| `playstore-icon.png` | 512×512 px, for the Play Store listing |

The round icon is the same artwork masked to a circle. Transparency is kept
unless a background is given.

### In memory

`renderAppIcons` renders the same sets without writing anything, for a server
that checks an upload and stores the icons itself:

```ts
import { renderAppIcons } from 'ts-images'

const icons = await renderAppIcons(uploadBytes, { platforms: ['ios', 'android'], background: '#0a84ff' })
for (const icon of icons)
  await storage.write(`${icon.platform}/${icon.path}`, icon.bytes) // icon.size, icon.shape
```

iOS icons are always opaque, white under any transparency unless
`background` says otherwise: App Store Connect refuses a marketing icon with an
alpha channel. A source that is not square is contained, centred, never
stretched or cropped.

### macOS Icons

For macOS applications, imgx generates:

| Size | Purpose |
|------|---------|
| 16×16 pt @1x, @2x | Menu bar, Spotlight, Finder |
| 32×32 pt @1x, @2x | Finder, Desktop |
| 128×128 pt @1x, @2x | Finder, File Info |
| 256×256 pt @1x, @2x | Finder, File Info |
| 512×512 pt @1x, @2x | App Store |

The output includes a `.icns` file that can be used directly in macOS applications.

## Output Structure

By default, imgx creates this directory structure:

```
output-dir/
├── ios/
│   ├── AppIcon.appiconset/
│   │   ├── Contents.json
│   │   ├── Icon-20@2x.png
│   │   ├── Icon-20@3x.png
│   │   ├── ... (all other iOS sizes)
│   │   └── Icon-1024.png
├── macos/
│   ├── AppIcon.appiconset/
│   │   ├── Contents.json
│   │   ├── Icon-16.png
│   │   ├── Icon-16@2x.png
│   │   ├── ... (all other macOS sizes)
│   │   └── Icon-512@2x.png
│   └── AppIcon.icns
```

## Advanced Usage

### Custom Background

For platforms that don't support transparency (like iOS App Store), you can specify a background color:

```bash
imgx app-icon icon.png --background "#ffffff"
```

```ts
await generateAppIcons('icon.png', {
  platform: 'ios',
  background: '#ffffff', // any colour parseColor reads; the icons come out opaque
})
```

### Custom Filename Template

You can customize the filename pattern:

```bash
imgx app-icon icon.png --filename-template "custom-[size]@[scale]x.[ext]"
```

```ts
await createAppIcon('icon.png', {
  filenameTemplate: 'custom-[size]@[scale]x.[ext]',
})
```

Available placeholders:

- `[size]`: Icon size (e.g., 20, 29, 40)
- `[scale]`: Scale factor (1, 2, 3)
- `[ext]`: File extension (png)
- `[platform]`: Platform name (ios, macos)

### Generating Specific Sizes

You can generate only specific sizes if needed:

```bash
imgx app-icon icon.png --platform ios --sizes 20,29,40
```

```ts
await createAppIcon('icon.png', {
  platform: 'ios',
  sizes: [20, 29, 40], // Only generate these sizes
})
```

## Integration with Xcode

The generated iOS and macOS AppIcon.appiconset directories can be directly used in Xcode:

1. Generate the icons using imgx
2. Drag the entire `.appiconset` folder into your Xcode project
3. Select your target and set the AppIcon set as your app icon

## Configuration

You can set default app icon generation options in your imgx.config.ts file:

```ts
// imgx.config.ts
export default {
  appIcon: {
    outputDir: 'assets/app-icons',
    platform: 'all', // 'ios', 'macos', or 'all'
    background: '#ffffff', // Background for non-transparent contexts
    filenameTemplate: 'Icon-[size]@[scale]x.[ext]',
  },
}
```
