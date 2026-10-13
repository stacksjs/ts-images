import type { Buffer } from 'node:buffer'

export interface ImgxConfig {
  verbose: boolean | string[]
  cache: boolean
  cacheDir: string
  concurrent: number
  skipOptimized: boolean

  // Default settings for image processing
  quality?: number
  format?: 'jpeg' | 'png' | 'webp' | 'avif'
  progressive?: boolean
  preserveMetadata?: boolean

  // App icon generation settings
  appIcon?: {
    outputDir?: string
    platform?: 'macos' | 'ios' | 'android' | 'all'
  }

  // Responsive image generation settings
  responsive?: {
    sizes?: number[]
    formats?: Array<'webp' | 'avif' | 'jpeg' | 'png'>
    quality?: number
    generateSrcset?: boolean
    filenameTemplate?: string
  }

  // Sprite sheet generation settings
  sprites?: {
    padding?: number
    maxWidth?: number
    prefix?: string
    format?: 'png' | 'webp'
    quality?: number
    scale?: number
  }

  // Placeholder generation settings
  placeholders?: {
    width?: number
    height?: number
    quality?: number
    format?: 'webp' | 'jpeg' | 'png'
    blurLevel?: number
    base64Encode?: boolean
    useThumbhash?: boolean
    strategy?: 'blur' | 'pixelate' | 'thumbhash' | 'dominant-color'
    saturation?: number
    cssFilter?: boolean
  }

  // Batch processing settings
  batch?: {
    formats?: Array<'webp' | 'avif' | 'jpeg' | 'png'>
    quality?: number | Record<string, number>
    resize?: { width?: number, height?: number }
    recursive?: boolean
    filter?: string // Regex pattern string
    skipExisting?: boolean
    concurrency?: number
    preserveStructure?: boolean
    filenameTemplate?: string
    preserveMetadata?: boolean
    optimizationPreset?: 'web' | 'quality' | 'performance'
  }

  // Image optimization settings
  optimization?: {
    quality?: number
    lossless?: boolean
    progressive?: boolean
    effort?: number
    preserveMetadata?: boolean

    // Format-specific optimization settings
    jpeg?: {
      quality?: number
      progressive?: boolean
      optimizeCoding?: boolean
      mozjpeg?: boolean
      chromaSubsampling?: string
    }
    png?: {
      quality?: number
      progressive?: boolean
      compressionLevel?: number
      effort?: number
      palette?: boolean
      adaptiveFiltering?: boolean
    }
    webp?: {
      quality?: number
      lossless?: boolean
      effort?: number
      smartSubsample?: boolean
    }
    avif?: {
      quality?: number
      lossless?: boolean
      effort?: number
    }
  }

  // Format conversion settings
  conversion?: {
    quality?: number
    lossless?: boolean
    progressive?: boolean
    filenamePrefix?: string
    filenameSuffix?: string
    preserveMetadata?: boolean
    optimizationLevel?: number
    effort?: number
    chromaSubsampling?: string
    smartSubsample?: boolean
  }

  // Social image generation settings
  social?: {
    quality?: number
    customSizes?: Record<string, { width: number, height: number }>
  }

  // Image transformation settings
  transformations?: {
    presets?: Record<string, Array<{
      type: 'resize' | 'rotate' | 'flip' | 'flop' | 'blur' | 'sharpen' | 'grayscale'
      options?: Record<string, any>
    }>>
  }

  // Watermarking settings
  watermark?: {
    defaultText?: string
    defaultImage?: string
    position?: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    opacity?: number
    margin?: number
    scale?: number
    textOptions?: {
      font?: string
      fontSize?: number
      color?: string
      background?: string
      padding?: number
    }
  }

  // SVG optimization settings
  svg?: {
    prettify?: boolean
    precision?: number
    multipass?: boolean
    removeComments?: boolean
    removeMetadata?: boolean
    removeViewBox?: boolean
    removeDimensions?: boolean
    removeHiddenElements?: boolean
    removeEmptyAttrs?: boolean
    removeEmptyContainers?: boolean
    removeUnusedNS?: boolean
    cleanupIDs?: boolean
    cleanupNumericValues?: boolean
    cleanupListOfValues?: boolean
    collapseGroups?: boolean
    convertColors?: boolean
    convertPathData?: boolean
    convertShapeToPath?: boolean
    convertStyleToAttrs?: boolean
    convertTransform?: boolean
    inlineStyles?: boolean
    minifyStyles?: boolean
    mergePaths?: boolean
    prefixIds?: boolean | string
    prefixClassNames?: boolean | string
    removeXMLNS?: boolean
    removeOffCanvasPaths?: boolean
    reusePaths?: boolean
    sortAttrs?: boolean
    sortDefsChildren?: boolean
    removeDoctype?: boolean
    removeXMLProcInst?: boolean
    removeTitle?: boolean
    removeDesc?: boolean
    removeScriptElement?: boolean
    removeStyleElement?: boolean
  }
}

export type ImgxOptions = Partial<ImgxConfig>

export interface ImageOptions {
  quality?: number
  resize?: string | { width?: number, height?: number }
  format?: 'jpeg' | 'png' | 'webp' | 'avif'
  progressive?: boolean
  preserveMetadata?: boolean
}

export interface SvgOptions {
  cleanup?: boolean
  prettify?: boolean
  removeComments?: boolean
  removeDimensions?: boolean
  removeViewBox?: boolean
}

/**
 * Enhanced SVG optimization options
 */
export interface SvgOptimizeOptions {
  output?: string
  prettify?: boolean
  precision?: number
  multipass?: boolean
  removeComments?: boolean
  removeMetadata?: boolean
  removeViewBox?: boolean
  removeDimensions?: boolean
  removeHiddenElements?: boolean
  removeEmptyAttrs?: boolean
  removeEmptyContainers?: boolean
  removeUnusedNS?: boolean
  cleanupIDs?: boolean
  cleanupNumericValues?: boolean
  cleanupListOfValues?: boolean
  collapseGroups?: boolean
  convertColors?: boolean
  convertPathData?: boolean
  convertShapeToPath?: boolean
  convertStyleToAttrs?: boolean
  convertTransform?: boolean
  inlineStyles?: boolean
  minifyStyles?: boolean
  mergePaths?: boolean
  prefixIds?: boolean | string
  prefixClassNames?: boolean | string
  removeXMLNS?: boolean
  removeOffCanvasPaths?: boolean
  reusePaths?: boolean
  sortAttrs?: boolean
  sortDefsChildren?: boolean
  removeDoctype?: boolean
  removeXMLProcInst?: boolean
  removeTitle?: boolean
  removeDesc?: boolean
  removeScriptElement?: boolean
  removeStyleElement?: boolean
  stats?: boolean
}

/**
 * Result of SVG optimization
 */
export interface SvgOptimizeResult {
  inputPath: string
  outputPath: string
  inputSize: number
  outputSize: number
  saved: number
  savedPercentage: number
  content: string
  prettified: boolean
  multipass: boolean
  stats?: any
}

export interface OptimizeResult {
  inputPath: string
  outputPath: string
  inputSize: number
  outputSize: number
  saved: number
  savedPercentage: number
  error?: Error
}

export interface ProcessOptions extends ImageOptions, SvgOptions {
  input: string | Buffer
  output?: string
  isSvg?: boolean
}

export type ProcessFunction = (_options: ProcessOptions) => Promise<OptimizeResult>

export interface ScanOptions {
  /**
   * The root directory to start matching from. Defaults to `process.cwd()`
   */
  cwd?: string

  /**
   * Allow patterns to match entries that begin with a period (`.`).
   *
   * @default false
   */
  dot?: boolean

  /**
   * Return the absolute path for entries.
   *
   * @default false
   */
  absolute?: boolean

  /**
   * Indicates whether to traverse descendants of symbolic link directories.
   *
   * @default false
   */
  followSymlinks?: boolean

  /**
   * Throw an error when symbolic link is broken
   *
   * @default false
   */
  throwErrorOnBrokenSymlink?: boolean

  /**
   * Return only files.
   *
   * @default true
   */
  onlyFiles?: boolean
}

export interface GetFilesOptions extends ScanOptions {
  patterns?: string[]
  ignore?: string[]
  maxDepth?: number
}

export interface AppIconSize {
  size: number
  scale: 1 | 2
  idiom: string
  filename: string
}

export interface AppIconResult {
  platform: string
  sizes: Array<{ size: number, path: string, filename: string }>
  contentsJson?: string
}

// New types for placeholder generation
export interface PlaceholderOptions {
  width?: number
  height?: number
  quality?: number
  format?: 'webp' | 'jpeg' | 'png'
  blurLevel?: number
  base64Encode?: boolean
  thumbhash?: boolean
  outputPath?: string
  strategy?: 'blur' | 'pixelate' | 'thumbhash' | 'dominant-color'
  saturation?: number
  cssFilter?: boolean
}

export interface PlaceholderResult {
  dataURL: string
  width: number
  height: number
  aspectRatio: number
  originalWidth: number
  originalHeight: number
  strategy: string
  dominantColor?: string
  css?: string
}

// New types for format conversion
export interface ConversionOptions {
  outputDir?: string
  quality?: number
  lossless?: boolean
  progressive?: boolean
  filenamePrefix?: string
  filenameSuffix?: string
  resize?: {
    width?: number
    height?: number
    fit?: 'contain' | 'cover' | 'fill' | 'inside' | 'outside'
  }
  preserveMetadata?: boolean
  chromaSubsampling?: string
  optimizationLevel?: number
  effort?: number
  smartSubsample?: boolean
}

export interface ConversionResult {
  inputPath: string
  outputPath: string
  format: string
  width: number
  height: number
  originalSize: number
  convertedSize: number
  saved: number
  savedPercentage: number
}

// New types for batch processing
export interface BatchProcessingOptions {
  outputDir?: string
  formats?: ('webp' | 'avif' | 'jpeg' | 'png')[]
  quality?: number | Record<string, number>
  resize?: { width?: number, height?: number }
  recursive?: boolean
  filter?: RegExp
  skipExisting?: boolean
  concurrency?: number
  preserveStructure?: boolean
  filenameTemplate?: string
  preserveMetadata?: boolean
  optimizationPreset?: 'web' | 'quality' | 'performance'
  transformations?: Array<{
    type: 'resize' | 'rotate' | 'flip' | 'flop' | 'blur' | 'sharpen' | 'grayscale'
    options?: Record<string, any>
  }>
  progressCallback?: (progress: {
    completed: number
    total: number
    percentage: number
    currentFile: string
    success: boolean
  }) => void
}

export interface BatchProcessingResult {
  summary: {
    totalFiles: number
    successCount: number
    errorCount: number
    originalSize: number
    optimizedSize: number
    saved: number
    savedPercentage: number
    timeElapsed: number
  }
  results: Array<{
    input: string
    outputs: Array<{
      path: string
      format: string
      size: number
      saved: number
    }>
    success: boolean
    error?: string
  }>
}

// New types for watermarking
export interface WatermarkOptions {
  output?: string
  text?: string
  image?: string | Buffer
  position?: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  margin?: number
  opacity?: number
  scale?: number
  rotate?: number
  tiled?: boolean
  textOptions?: {
    font?: string
    fontSize?: number
    color?: string
    background?: string
    padding?: number
    width?: number
  }
}

export interface WatermarkResult {
  inputPath: string
  outputPath: string
  watermarkType: 'text' | 'image'
  dimensions: { width: number, height: number }
}
