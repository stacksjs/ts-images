#!/usr/bin/env bun
// For the Express module
import type { ImgxOptions, OptimizeResult, ProcessOptions } from '../src/types'
import { Buffer } from 'node:buffer'
import { copyFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import proc from 'node:process'
import { CLI } from '@stacksjs/clapp'
import { version } from '../package.json'
import { generateReport } from '../src/analyze'
import { generateAppIcons } from '../src/app-icon'
import { process } from '../src/core'
import { generateSprite } from '../src/sprite-generator'
import { generateThumbHash } from '../src/thumbhash'
import { debugLog, formatBytes, getFiles, watchFiles } from '../src/utils'

// Helper function to parse file size strings like "5MB" or "500KB"
function parseFileSize(sizeStr: string): number {
  const units: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  }

  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/i)
  if (!match)
    return Number.parseInt(sizeStr, 10) || 0

  const size = Number.parseFloat(match[1])
  const unit = match[2].toLowerCase()

  return size * (units[unit] || 1)
}

// Helper function to format a report
function formatReport(report: any): string {
  const { stats, summary } = report

  let output = `
Image Analysis Report
=====================

Summary:
- Total images: ${summary.totalImages}
- Total size: ${formatBytes(summary.totalSize)}
- Average size: ${formatBytes(summary.averageSize)}
- Potential savings: ${summary.potentialSavings}

Format breakdown:
${Object.entries(summary.formatBreakdown)
  .map(([format, count]) => `- ${format}: ${count}`)
  .join('\n')}

Warnings:
${summary.warnings.length ? summary.warnings.map((w: string) => `- ${w}`).join('\n') : '- None'}

Details:
`

  for (const stat of stats) {
    output += `
${stat.path}
Size: ${formatBytes(stat.size)}
Format: ${stat.format}
Dimensions: ${stat.width}x${stat.height}
Optimization potential: ${stat.optimizationPotential}
${stat.warnings.length ? `Warnings:\n${stat.warnings.map((w: string) => `- ${w}`).join('\n')}` : ''}
`
  }

  return output
}

// CLI options interface for optimize command
interface OptimizeCommandOptions extends Omit<ProcessOptions, 'responsive'>, Omit<ImgxOptions, 'responsive'> {
  maxSize?: string
  minSize?: string
  include: string
  exclude: string
  maxDepth?: string
  followSymlinks: boolean
  dot: boolean
  outputDir?: string
  backup?: boolean
  skipExisting?: boolean
  watch?: boolean
  responsive?: boolean
  responsiveSizes: string
  thumbhash?: boolean
  thumbhashSize: string
}

// CLI options interface for analyze command
interface AnalyzeCommandOptions {
  json?: boolean
  output?: string
  ci?: boolean
  threshold?: string
}

// CLI options interface for app-icon command
interface AppIconCommandOptions {
  outputDir?: string
  platform?: 'macos' | 'ios' | 'android' | 'all'
  background?: string
  verbose?: boolean
}

// CLI options interface for serve command
interface ServeCommandOptions {
  port: number
  host: string
  cache: boolean
}

const cli = new CLI('imgx')

cli
  .command('optimize [input] [output]', 'Optimize images and SVGs')
  .alias('o')
  .option('-q, --quality <number>', 'Image quality (1-100)', { default: 80 })
  .option('-r, --resize <string>', 'Resize image (e.g., "50%" or "800x600")')
  .option('-f, --format <string>', 'Output format (jpeg, png, webp, avif)')
  .option('-p, --progressive', 'Enable progressive mode for JPEG/PNG', { default: true })
  .option('-m, --preserve-metadata', 'Preserve image metadata')
  .option('--cleanup', 'Clean up SVG', { default: true })
  .option('--prettify', 'Prettify SVG output')
  .option('--remove-comments', 'Remove SVG comments', { default: true })
  .option('--remove-dimensions', 'Remove SVG dimensions')
  .option('--remove-viewbox', 'Remove SVG viewBox')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-w, --watch', 'Watch for file changes')
  .option('-R, --recursive', 'Process directories recursively')
  .option('-t, --thumbhash', 'Generate ThumbHash placeholder')
  .option('--thumbhash-size <size>', 'ThumbHash output size', { default: '32x32' })
  .option('--skip-existing', 'Skip already optimized files')
  .option('--max-size <size>', 'Maximum file size to process (e.g., "5MB")')
  .option('--min-size <size>', 'Minimum file size to process (e.g., "10KB")')
  .option('--output-dir <dir>', 'Output directory for batch processing')
  .option('--backup', 'Create backup of original files')
  .option('--responsive', 'Generate responsive image sizes')
  .option('--responsive-sizes <sizes>', 'Responsive image sizes (comma-separated)', { default: '320,768,1024,1920' })
  .option('--include <patterns>', 'Include patterns (comma-separated)', { default: '**/*.{jpg,jpeg,png,webp,avif,svg}' })
  .option('--exclude <patterns>', 'Exclude patterns (comma-separated)', { default: '**/node_modules/**,**/.git/**' })
  .option('--max-depth <number>', 'Maximum directory depth to process')
  .option('--follow-symlinks', 'Follow symbolic links', { default: false })
  .option('--dot', 'Process dotfiles', { default: false })
  .example('imgx optimize input.jpg')
  .example('imgx optimize input.jpg output.webp -q 75 -r 50%')
  .example('imgx optimize ./images -f webp -R')
  .action(async (input?: string, output?: string, options?: OptimizeCommandOptions) => {
    if (!input) {
      cli.outputHelp()
      return
    }

    try {
      // Parse file size limits if specified
      const maxSize = options?.maxSize ? parseFileSize(options.maxSize) : Infinity
      const minSize = options?.minSize ? parseFileSize(options.minSize) : 0

      // Parse include/exclude patterns
      const includePatterns = options?.include.split(',').map(p => p.trim()) || ['**/*.{jpg,jpeg,png,webp,avif,svg}']
      const excludePatterns = options?.exclude.split(',').map(p => p.trim()) || ['**/node_modules/**,**/.git/**']

      const files = await getFiles(input, {
        patterns: includePatterns,
        ignore: excludePatterns,
        maxDepth: options?.maxDepth ? Number.parseInt(options.maxDepth) : undefined,
        followSymlinks: options?.followSymlinks,
        dot: options?.dot,
        absolute: true,
        onlyFiles: true,
      })

      if (files.length === 0) {
        console.error('No files found to process')
        proc.exit(1)
      }

      debugLog('cli', `Found ${files.length} files to process`)

      // Watch mode
      if (options?.watch) {
        console.log('Watching for changes...')

        const cleanup = await watchFiles(input, includePatterns, async (file) => {
          console.log(`File ${file} has been changed`)
          if (options) {
            await processFile(file, file, options)
          }
        }, {
          dot: options?.dot,
          followSymlinks: options?.followSymlinks,
          ignore: excludePatterns,
        })

        // Handle cleanup on process exit
        proc.on('SIGINT', () => {
          cleanup()
          proc.exit(0)
        })

        return // Keep watching
      }

      // Single file processing
      if (files.length === 1 && output) {
        await processFile(files[0], output, options || { input: files[0], output, include: '**', exclude: '', followSymlinks: false, dot: false, responsiveSizes: '320,768,1024,1920' })
      }
      // Batch processing
      else {
        const outputDir = options?.outputDir ? resolve(options.outputDir) : null
        const results = await Promise.all(
          files.map(async (file) => {
            const stats = await stat(file)
            if (stats.size < minSize || stats.size > maxSize) {
              debugLog('cli', `Skipping ${file} (size: ${stats.size} bytes)`)
              return null
            }

            if (options?.skipExisting) {
              try {
                const outputStats = await stat(file)
                if (outputStats.mtimeMs > stats.mtimeMs) {
                  debugLog('cli', `Skipping ${file} (already optimized)`)
                  return null
                }
              }
              catch {} // Output doesn't exist, continue processing
            }

            const outputPath = outputDir
              ? join(outputDir, file.split('/').pop() || '')
              : file

            if (options?.backup) {
              const backupPath = `${file}.backup`
              await copyFile(file, backupPath)
              debugLog('cli', `Created backup: ${backupPath}`)
            }

            return processFile(file, outputPath, options || { input: file, output: outputPath, include: '**', exclude: '', followSymlinks: false, dot: false, responsiveSizes: '320,768,1024,1920' })
          }),
        )

        const validResults = results.filter(Boolean) as OptimizeResult[]

        // Print summary
        const successful = validResults.filter(r => !r.error)
        const failed = validResults.filter(r => r.error)

        if (successful.length > 0) {
          const totalInputSize = successful.reduce((sum, r) => sum + r.inputSize, 0)
          const totalOutputSize = successful.reduce((sum, r) => sum + r.outputSize, 0)
          const totalSaved = totalInputSize - totalOutputSize
          const totalPercentage = (totalSaved / totalInputSize) * 100

          console.log(`
            Successfully processed ${successful.length} files:
            - Total input size: ${formatBytes(totalInputSize)}
            - Total output size: ${formatBytes(totalOutputSize)}
            - Total saved: ${formatBytes(totalSaved)} (${totalPercentage.toFixed(2)}%)
          `)
        }

        if (failed.length > 0) {
          console.error(`\nFailed to process ${failed.length} files:`)
          failed.forEach((result) => {
            console.error(`- ${result.inputPath}: ${result.error?.message}`)
          })
          proc.exit(1)
        }
      }
    }
    catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      proc.exit(1)
    }
  })

cli
  .command('analyze [input]', 'Analyze images and generate optimization report')
  .alias('a')
  .option('-j, --json', 'Output as JSON')
  .option('-o, --output <file>', 'Save report to file')
  .option('--ci', 'Exit with error if optimization potential is high')
  .option('--threshold <size>', 'Size threshold for warnings (e.g., "500KB")')
  .action(async (input?: string, options?: AnalyzeCommandOptions) => {
    if (!input) {
      cli.outputHelp()
      return
    }

    try {
      const files = await getFiles(input, { onlyFiles: true })
      const report = await generateReport(files)

      const output = options?.json
        ? JSON.stringify(report, null, 2)
        : formatReport(report)

      if (options?.output) {
        await writeFile(options.output, output)
        console.log(`Report saved to ${options.output}`)
      }
      else {
        console.log(output)
      }

      // CI mode
      if (options?.ci) {
        const threshold = options?.threshold ? parseFileSize(options.threshold) : 500 * 1024 // 500KB default
        const hasLargeFiles = report.stats.some(stat => stat.size > threshold)
        const hasHighPotential = report.stats.some(stat => stat.optimizationPotential === 'high')

        if (hasLargeFiles || hasHighPotential) {
          console.error('Found images that need optimization')
          proc.exit(1)
        }
      }
    }
    catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      proc.exit(1)
    }
  })

cli
  .command('sprite [input] [output]', 'Generate sprite sheet from images')
  .alias('s')
  .option('-p, --prefix <prefix>', 'CSS class prefix', { default: 'sprite' })
  .option('-f, --format <format>', 'Output format (png, webp)', { default: 'png' })
  .option('-q, --quality <number>', 'Output quality', { default: 90 })
  .option('-s, --scale <number>', 'Scale factor', { default: 1 })
  .option('--padding <number>', 'Padding between sprites', { default: 2 })
  .option('--max-width <number>', 'Maximum sprite sheet width', { default: 2048 })
  .option('--retina', 'Generate retina sprite sheet')
  .option('--optimize', 'Optimize sprite sheet')
  .action(async (input?: string, output?: string, options?: any) => {
    if (!input || !output) {
      cli.outputHelp()
      return
    }

    try {
      const files = await getFiles(input)
      const images = files.map(file => ({
        path: file,
        name: file.split('/').pop()?.split('.')[0] || '',
      }))

      // Generate normal sprite sheet
      const result = await generateSprite(images, output, options)

      // Generate retina sprite sheet if requested
      if (options?.retina) {
        const retinaOptions = {
          ...options,
          scale: 2,
          prefix: `${options.prefix}-2x`,
        }
        const retinaResult = await generateSprite(images, output, retinaOptions)
        console.log('Generated retina sprite sheet:', retinaResult)
      }

      // Optimize if requested
      if (options?.optimize) {
        await process({
          input: result.imagePath,
          output: result.imagePath,
          quality: options.quality,
        })
      }

      console.log(`
        Generated sprite sheet:
        - Image: ${result.imagePath}
        - CSS: ${result.cssPath}
        - Sprites: ${result.sprites.length}
        - Dimensions: ${result.width}x${result.height}
      `)
    }
    catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      proc.exit(1)
    }
  })

cli
  .command('convert [input] [output]', 'Convert images between formats')
  .alias('c')
  .option('-f, --format <format>', 'Output format (jpeg, png, webp, avif)')
  .option('-q, --quality <number>', 'Output quality', { default: 80 })
  .option('--strip', 'Strip metadata')
  .option('--keep-animation', 'Preserve animation frames')
  .option('-R, --recursive', 'Process directories recursively')
  .action(async (input?: string, output?: string, options?: any) => {
    if (!input) {
      cli.outputHelp()
      return
    }

    try {
      const files = await getFiles(input, { onlyFiles: true })
      for (const file of files) {
        const outputPath = output || file.replace(/\.[^.]+$/, `.${options?.format}`)
        await process({
          ...options,
          input: file,
          output: outputPath,
          format: options?.format,
        })
      }
    }
    catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      proc.exit(1)
    }
  })

interface ProcessFileOptions extends Omit<ProcessOptions, 'responsive'> {
  maxSize?: string
  minSize?: string
  include?: string
  exclude?: string
  maxDepth?: string
  followSymlinks?: boolean
  dot?: boolean
  outputDir?: string
  backup?: boolean
  skipExisting?: boolean
  watch?: boolean
  responsive?: boolean
  responsiveSizes?: string
  thumbhash?: boolean
  thumbhashSize?: string
  [key: string]: any // Allow other properties
}

async function processFile(input: string, output: string, options: ProcessFileOptions): Promise<OptimizeResult> {
  // Process main image
  const result = await process({
    ...options,
    input,
    output,
  })

  if (result.error) {
    console.error(`Error processing ${result.inputPath}: ${result.error.message}`)
    return result
  }

  // Generate ThumbHash if requested
  if (options.thumbhash) {
    try {
      const { hash, dataUrl } = await generateThumbHash(input)
      // const [width, height] = options.thumbhashSize.split('x').map(Number)

      const thumbPath = `${output}.thumb.png`
      const hashPath = `${output}.thumb.hash`

      await writeFile(thumbPath, new Uint8Array(Buffer.from(dataUrl.split(',')[1], 'base64')))
      await writeFile(hashPath, hash)

      console.log(`Generated ThumbHash: ${thumbPath}`)
    }
    catch (error: any) {
      console.error(`Error generating ThumbHash: ${error.message}`)
    }
  }

  // Generate responsive images if requested
  if (options.responsive) {
    const sizes = options.responsiveSizes?.split(',').map(Number) || [320, 768, 1024, 1920]
    const ext = options.format || input.split('.').pop()

    for (const width of sizes) {
      const responsivePath = `${output.replace(`.${ext}`, '')}-${width}.${ext}`
      await process({
        ...options,
        input,
        output: responsivePath,
        resize: `${width}x`,
      })
    }
  }

  console.log(`
    Processed ${result.inputPath} -> ${result.outputPath}
    - Input size: ${formatBytes(result.inputSize)}
    - Output size: ${formatBytes(result.outputSize)}
    - Saved: ${formatBytes(result.saved)} (${result.savedPercentage.toFixed(2)}%)
  `)

  return result
}

cli
  .command('serve [directory]', 'Start development server with image optimization')
  .option('-p, --port <number>', 'Port number', { default: 3000 })
  .option('-H, --host <host>', 'Host to bind to', { default: 'localhost' })
  .option('--cache', 'Enable caching', { default: true })
  .action(async (directory = '.', options?: ServeCommandOptions) => {
    try {
      const server = Bun.serve({
        port: options?.port || 3000,
        hostname: options?.host || 'localhost',
        fetch: async (req) => {
          const url = new URL((req as unknown as { url: string }).url)
          const path = join(directory, url.pathname)

          // Check if path matches image extension
          if (!path.match(/\.(jpg|jpeg|png|webp|avif|gif|svg)$/i)) {
            // Try to serve the file directly
            const file = Bun.file(path)
            const exists = await file.exists()

            if (exists) {
              const response = new Response(file)

              // Add cache headers if enabled
              if (options?.cache) {
                ;(response.headers as any).set('Cache-Control', 'public, max-age=31536000')
              }

              return response
            }

            return new Response('Not Found', { status: 404 })
          }

          try {
            // Parse query parameters for image processing
            const searchParams = url.searchParams
            const quality = searchParams.get('quality') ? Number(searchParams.get('quality')) : 80
            const format = searchParams.get('format') as 'jpeg' | 'png' | 'webp' | 'avif' | undefined
            const resize = searchParams.get('size') || undefined

            // Process the image
            const result = await process({
              input: path,
              quality,
              format,
              resize,
            })

            // Create a response with the processed image
            const response = new Response(Bun.file(result.outputPath))

            // Set content type based on format
            const outputFormat = format || path.split('.').pop() || 'jpeg'
            ;(response.headers as any).set('Content-Type', `image/${outputFormat}`)

            // Add cache headers if enabled
            if (options?.cache) {
              ;(response.headers as any).set('Cache-Control', 'public, max-age=31536000')
            }

            return response
          }
          catch (error) {
            console.error(`Error processing image: ${error instanceof Error ? error.message : String(error)}`)
            return new Response('Error processing image', { status: 500 })
          }
        },
      })

      console.log(`Server running at http://${server.hostname}:${server.port}`)

      // Handle cleanup on exit
      proc.on('SIGINT', () => {
        console.log('Shutting down server...')
        server.stop()
        proc.exit(0)
      })
    }
    catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      proc.exit(1)
    }
  })

cli
  .command('completion', 'Generate shell completion script')
  .action(() => {
    // TODO: Implement shell completion generation
    console.log('Shell completion not implemented yet')
  })

cli
  .command('app-icon <input>', 'Generate app icons for macOS, iOS and Android')
  .alias('icon')
  .option('-o, --output-dir <dir>', 'Output directory for app icons', { default: 'assets/app-icons' })
  .option('-p, --platform <platform>', 'Target platform (macos, ios, android, all)', { default: 'all' })
  .option('-b, --background <color>', 'Colour under any transparency, making every icon opaque')
  .option('-v, --verbose', 'Enable verbose logging')
  .example('imgx app-icon app-icon.png')
  .example('imgx app-icon logo.png -o ./src/assets -p macos')
  .action(async (input: string, options?: AppIconCommandOptions) => {
    if (!input) {
      cli.outputHelp()
      return
    }

    try {
      const results = await generateAppIcons(input, {
        outputDir: options?.outputDir,
        platform: options?.platform,
        background: options?.background,
      })

      console.log(`Generated app icons for ${results.map(r => r.platform).join(', ')}:`)

      for (const result of results) {
        console.log(`\n${result.platform.toUpperCase()}:`)
        console.log(`- Output directory: ${options?.outputDir || 'assets/app-icons'}/${result.platform === 'android' ? 'android' : 'AppIcon.appiconset'}`)
        console.log(`- Generated ${result.sizes.length} icon sizes`)

        if (options?.verbose) {
          for (const size of result.sizes) {
            console.log(`  - ${size.filename} (${size.size}x${size.size}px)`)
          }
        }
      }
    }
    catch (error) {
      console.error(`Error generating app icons: ${error instanceof Error ? error.message : String(error)}`)
      proc.exit(1)
    }
  })

cli.version(version)
cli.help()
cli.parse()
