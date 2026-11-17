# CLI Options

imgx provides a powerful command-line interface (CLI) for performing image operations. This page documents all available commands and their options.

## Global Options

These options apply to all imgx commands:

```text
--help, -h         Show help information
--version, -v      Show version information
--verbose          Enable verbose output
--config <path>    Path to config file (default: imgx.config.{ts,js})
```

## Commands

### `optimize`

Optimizes one or more images to reduce file size while maintaining quality.

```
imgx optimize <input> [options]
```

**Arguments:**

- `input`: File path or glob pattern for images to optimize

**Options:**

- `--output, -o <path>`: Output file or directory
- `--quality, -q <number>`: Quality setting (1-100) (default: 80)
- `--format, -f <format>`: Output format (jpeg, png, webp, avif)
- `--progressive, -p`: Enable progressive mode
- `--no-progressive`: Disable progressive mode
- `--preserve-metadata`: Preserve image metadata
- `--overwrite`: Overwrite existing files (default: true)

**Examples:**
```bash
# Optimize a single image
imgx optimize image.jpg

# Optimize and convert to WebP
imgx optimize image.jpg -f webp

# Optimize multiple images with glob
imgx optimize "images/**/*.{jpg,png}" -q 85

# Specify output directory
imgx optimize image.jpg -o optimized/
```

### `convert`

Converts images from one format to another.

```
imgx convert <input> --format <format> [options]
```

**Arguments:**

- `input`: File path or glob pattern for images to convert

**Options:**

- `--format, -f <format>`: Output format (required)
- `--output, -o <path>`: Output file or directory
- `--quality, -q <number>`: Quality setting (1-100) (default: 80)
- `--lossless`: Use lossless compression (for WebP/AVIF)
- `--progressive, -p`: Enable progressive mode
- `--preserve-metadata`: Preserve image metadata

**Examples:**
```bash
# Convert to WebP
imgx convert image.jpg -f webp

# Convert to AVIF with custom quality
imgx convert image.jpg -f avif -q 70

# Convert multiple images
imgx convert "images/*.jpg" -f webp -o converted/
```

### `responsive`

Generates responsive image sets in multiple sizes.

```
imgx responsive <input> [options]
```

**Arguments:**

- `input`: Image file path

**Options:**

- `--sizes <sizes>`: Comma-separated list of widths (default: 320,640,960,1280,1920)
- `--formats, -f <formats>`: Comma-separated list of formats (default: webp,jpeg)
- `--quality, -q <number>`: Quality setting (1-100) (default: 80)
- `--output-dir, -o <path>`: Output directory
- `--filename-template <template>`: Template for output filenames (default: [name]-[width].[ext])
- `--generate-html`: Generate HTML with srcset and sizes attributes

**Examples:**
```bash
# Generate responsive images with default settings
imgx responsive image.jpg

# Custom sizes and formats
imgx responsive image.jpg --sizes 480,768,1024,1440 -f webp,avif

# Generate with HTML output
imgx responsive image.jpg --generate-html
```

### `app-icon`

Generates app icons for iOS or macOS.

```
imgx app-icon <input> [options]
```

**Arguments:**

- `input`: Source image file path (should be high-res, at least 1024x1024px)

**Options:**

- `--platform <platform>`: Target platform (ios, macos, all) (default: all)
- `--output-dir, -o <path>`: Output directory

**Examples:**
```bash
# Generate all app icons
imgx app-icon icon.png

# Generate only iOS icons
imgx app-icon icon.png --platform ios -o assets/ios-icons/
```

### `placeholder`

Generates image placeholders for lazy loading.

```
imgx placeholder <input> [options]
```

**Arguments:**

- `input`: Image file path

**Options:**

- `--width, -w <number>`: Width of placeholder (default: 20)
- `--quality, -q <number>`: Quality setting (1-100) (default: 50)
- `--format, -f <format>`: Output format (webp, jpeg, png) (default: webp)
- `--strategy <strategy>`: Placeholder strategy (blur, pixelate, thumbhash, dominant-color) (default: blur)
- `--blur-level <level>`: Blur strength for blur strategy (default: 40)
- `--base64`: Output as base64 data URL (default: true)
- `--output, -o <path>`: Output file path

**Examples:**
```bash
# Generate a basic placeholder
imgx placeholder image.jpg

# Generate a thumbhash placeholder
imgx placeholder image.jpg --strategy thumbhash

# Generate a dominant color placeholder
imgx placeholder image.jpg --strategy dominant-color

# Save placeholder to file
imgx placeholder image.jpg -o placeholder.webp --base64=false
```

### `svg`

Optimizes SVG files.

```
imgx svg <input> [options]
```

**Arguments:**

- `input`: SVG file path or glob pattern

**Options:**

- `--output, -o <path>`: Output file or directory
- `--prettify`: Format SVG code for readability
- `--remove-comments`: Remove comments
- `--remove-dimensions`: Remove width/height attributes
- `--remove-viewbox`: Remove viewBox attribute
- `--precision <number>`: Precision of floating-point values (default: 3)

**Examples:**
```bash
# Optimize SVG
imgx svg icon.svg

# Optimize with specific options
imgx svg icon.svg --remove-comments --precision 2

# Optimize multiple SVGs
imgx svg "icons/*.svg" -o optimized/
```

### `batch`

Batch processes multiple images.

```
imgx batch <input> [options]
```

**Arguments:**

- `input`: Directory or glob pattern for images to process

**Options:**

- `--formats, -f <formats>`: Comma-separated list of output formats (default: webp)
- `--quality, -q <number>`: Quality setting (1-100) (default: 80)
- `--output-dir, -o <path>`: Output directory
- `--recursive, -r`: Process subdirectories recursively
- `--filter <pattern>`: Regex pattern to filter files
- `--skip-existing`: Skip already processed files
- `--concurrency <number>`: Number of files to process concurrently (default: 4)
- `--preserve-structure`: Preserve directory structure in output

**Examples:**
```bash
# Process all images in a directory
imgx batch ./images

# Process recursively and convert to multiple formats
imgx batch ./images -r -f webp,avif

# Use a specific filter pattern
imgx batch ./assets --filter "\.(jpe?g|png)$"
```

### `watch`

Watches a directory for changes and processes images automatically.

```
imgx watch <directory> [options]
```

**Arguments:**

- `directory`: Directory to watch for changes

**Options:**

- `--formats, -f <formats>`: Comma-separated list of output formats (default: webp)
- `--quality, -q <number>`: Quality setting (1-100) (default: 80)
- `--output-dir, -o <path>`: Output directory
- `--filter <pattern>`: Regex pattern to filter files

**Examples:**
```bash
# Watch a directory
imgx watch ./src/assets

# Watch with custom options
imgx watch ./images -f webp,avif -q 85 -o ./public/images
```
