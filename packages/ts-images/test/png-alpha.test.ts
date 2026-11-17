import { expect, it } from 'bun:test'
import { decode, encode } from '../src/codecs'
import { createImageData } from '../src/core/image-data'

it('writes RGB PNGs when the image explicitly has no alpha channel', async () => {
  const image = createImageData(2, 1, { hasAlpha: false })
  image.data.set([12, 34, 56, 255, 78, 90, 123, 255])
  const bytes = await encode(image, 'png')
  expect(bytes[25]).toBe(2)
  expect(Array.from((await decode(bytes)).data)).toEqual(Array.from(image.data))
})

it('preserves requested RGBA channels and partially transparent pixels', async () => {
  const image = createImageData(2, 1, { hasAlpha: true })
  image.data.set([12, 34, 56, 0, 78, 90, 123, 128])
  const bytes = await encode(image, 'png')
  expect(bytes[25]).toBe(6)
  expect(Array.from((await decode(bytes)).data)).toEqual(Array.from(image.data))
})
