import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  VIDEO_THUMBNAIL_QUERY,
  thumbnailUrlOf,
  type PexelsCandidate
} from '../src/main/services/pexels/candidates.ts'
import { photoCand, videoCand } from './support/pipeline-context.ts'

/** A candidate as an older build saved it: no field for a thumbnail, whatever the variants hold. */
function withVariants(
  candidate: PexelsCandidate,
  variants: PexelsCandidate['variants']
): PexelsCandidate {
  return { ...candidate, variants }
}

describe('thumbnailUrlOf', () => {
  describe('for a photo', () => {
    it('is the "tiny" size Pexels gives (280 by 200)', () => {
      assert.equal(
        thumbnailUrlOf(withVariants(photoCand(8, 'Sea foam'), [{ label: 'tiny', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/example.jpg/280px-example.jpg' }])),
        'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/example.jpg/280px-example.jpg'
      )
    })

    it('is nothing when the photo has no "tiny" size, as when its record is from an older build', () => {
      const candidate = photoCand(8, 'Sea foam')
      const withoutTiny = withVariants(
        candidate,
        candidate.variants.filter((variant) => variant.label !== 'tiny')
      )
      assert.equal(thumbnailUrlOf(withoutTiny), undefined)
      assert.equal(thumbnailUrlOf(withVariants(candidate, [])), undefined)
    })

    it('is nothing when the "tiny" size is not an image on upload.wikimedia.org', () => {
      const candidate = photoCand(8, 'Sea foam')
      const elsewhere = (url: string): PexelsCandidate =>
        withVariants(candidate, [{ label: 'tiny', url }])
      assert.equal(thumbnailUrlOf(elsewhere('https://example.com/tiny.jpeg')), undefined)
      assert.equal(thumbnailUrlOf(elsewhere('http://images.pexels.com/tiny.jpeg')), undefined)
      assert.equal(
        thumbnailUrlOf(elsewhere('https://images.pexels.com.evil.test/t.jpeg')),
        undefined
      )
      assert.equal(thumbnailUrlOf(elsewhere('data:image/png;base64,AAAA')), undefined)
      assert.equal(thumbnailUrlOf(elsewhere('not a url')), undefined)
    })
  })

  describe('for a video', () => {
    it('is its preview image sized to 280 by 200', () => {
      assert.equal(
        thumbnailUrlOf({ ...videoCand(7, 'waves-on-a-beach'), imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/example.ogv/280px--example.ogv.jpg' }),
        'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/example.ogv/280px--example.ogv.jpg'
      )
      assert.equal(VIDEO_THUMBNAIL_QUERY, 'auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=280')
    })

    it('replaces the sizing Pexels put on the preview image and keeps nothing of it', () => {
      const candidate: PexelsCandidate = {
        ...videoCand(7, 'waves-on-a-beach'),
        imageUrl:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/example.ogv/1200px--example.ogv.jpg?width=1200#frag'
      }
      assert.equal(
        thumbnailUrlOf(candidate),
        'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/example.ogv/1200px--example.ogv.jpg?width=1200'
      )
    })

    it('is nothing when the preview image is missing or is not an image on images.pexels.com', () => {
      const preview = (imageUrl: string): PexelsCandidate => ({
        ...videoCand(7, 'waves-on-a-beach'),
        imageUrl
      })
      assert.equal(thumbnailUrlOf(preview('')), undefined)
      assert.equal(thumbnailUrlOf(preview('https://example.com/preview.jpeg')), undefined)
      assert.equal(thumbnailUrlOf(preview('http://images.pexels.com/preview.jpeg')), undefined)
      assert.equal(thumbnailUrlOf(preview('https://upload.wikimedia.org/preview.jpeg')), undefined)
      assert.equal(
        thumbnailUrlOf(preview('https://images.pexels.com.evil.test/preview.jpeg')),
        undefined
      )
      assert.equal(thumbnailUrlOf(preview('https://user@images.pexels.com/p.jpeg')), undefined)
    })
  })
})
