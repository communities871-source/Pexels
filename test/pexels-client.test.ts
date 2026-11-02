import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { PexelsRateLimitTracker } from '../src/main/services/pexels/pexels-rate-limit.ts'
import { validateDownloadUrl } from '../src/main/services/pexels/download-url-validation.ts'
import { buildManifestAttribution } from '../src/main/services/pexels/pexels-attribution.ts'
import { PexelsSearchCache } from '../src/main/services/pexels/pexels-search-cache.ts'
import {
  PexelsPhotoSearchResultSchema,
  PexelsVideoSearchResultSchema
} from '../src/main/services/pexels/pexels-types.ts'

beforeEach(() => {
  PexelsRateLimitTracker.clear()
})

afterEach(() => {
  PexelsRateLimitTracker.clear()
})

describe('Legacy quota tracker compatibility', () => {
  it('updates from valid HTTP rate limit headers', () => {
    const headers = new Headers({
      'X-Ratelimit-Limit': '200',
      'X-Ratelimit-Remaining': '150',
      'X-Ratelimit-Reset': '1700000000'
    })
    const snapshot = PexelsRateLimitTracker.updateFromHeaders(headers)
    assert.equal(snapshot?.limit, 200)
    assert.equal(snapshot?.remaining, 150)
    assert.equal(snapshot?.resetAt, 1700000000)
    assert.equal(PexelsRateLimitTracker.isExhausted(), false)
    assert.equal(PexelsRateLimitTracker.isLow(), false)
  })

  it('detects low quota (remaining <= 10)', () => {
    const headers = new Headers({
      'X-Ratelimit-Limit': '200',
      'X-Ratelimit-Remaining': '8',
      'X-Ratelimit-Reset': '1700000000'
    })
    PexelsRateLimitTracker.updateFromHeaders(headers)
    assert.equal(PexelsRateLimitTracker.isLow(), true)
    assert.equal(PexelsRateLimitTracker.isExhausted(), false)
  })

  it('detects exhausted quota (remaining <= 0)', () => {
    const headers = new Headers({
      'X-Ratelimit-Limit': '200',
      'X-Ratelimit-Remaining': '0',
      'X-Ratelimit-Reset': String(Math.floor(Date.now() / 1000) + 120)
    })
    PexelsRateLimitTracker.updateFromHeaders(headers)
    assert.equal(PexelsRateLimitTracker.isExhausted(), true)
  })

  it('aborts waitForQuota immediately if abort signal is already fired or fires during wait', async () => {
    const headers = new Headers({
      'X-Ratelimit-Limit': '200',
      'X-Ratelimit-Remaining': '0',
      'X-Ratelimit-Reset': String(Math.floor(Date.now() / 1000) + 60)
    })
    PexelsRateLimitTracker.updateFromHeaders(headers)

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 10)

    const started = Date.now()
    await assert.rejects(
      () => PexelsRateLimitTracker.waitForQuota(undefined, controller.signal),
      (err: unknown) => err instanceof Error && err.message.includes('aborted')
    )
    assert.ok(Date.now() - started < 500)
  })
})

describe('Wikimedia Commons download URL validation', () => {
  it('accepts Commons media file hosts', () => {
    assert.doesNotThrow(() => validateDownloadUrl('https://upload.wikimedia.org/wikipedia/commons/a/a1/photo.jpg'))
    assert.doesNotThrow(() => validateDownloadUrl('https://commons.wikimedia.org/wiki/File:Example.ogv'))
  })

  it('rejects non-HTTPS protocols', () => {
    assert.throws(() => validateDownloadUrl('http://upload.wikimedia.org/photo.jpg'), /HTTPS required/)
    assert.throws(() => validateDownloadUrl('file:///tmp/photo.jpg'), /HTTPS required/)
  })

  it('rejects unauthorized hosts and private IP addresses', () => {
    assert.throws(() => validateDownloadUrl('https://evil-attacker.com/malicious.mp4'), /not an allowed Wikimedia Commons host/)
    assert.throws(() => validateDownloadUrl('https://localhost/image.png'), /not an allowed Wikimedia Commons host/)
    assert.throws(() => validateDownloadUrl('https://192.168.1.1/video.mp4'), /not an allowed Wikimedia Commons host/)
  })
})

describe('Wikimedia Commons manifest attribution', () => {
  it('records each asset page, creator, and license', () => {
    const attr = buildManifestAttribution([{
      id: 'photo_101',
      type: 'photo',
      pexelsId: 101,
      url: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
      photographer: 'Jane Doe',
      photographerUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
    }])
    assert.equal(attr.source.name, 'Wikimedia Commons')
    assert.equal(attr.assets.length, 1)
    assert.equal(attr.assets[0].commonsUrl, 'https://commons.wikimedia.org/wiki/File:Example.jpg')
    assert.equal(attr.assets[0].license, 'CC BY-SA 4.0')
    assert.equal(attr.assets[0].creditLine, 'Jane Doe — CC BY-SA 4.0')
  })
})

describe('Pexels Search Cache', () => {
  it('builds deterministic sorted cache keys', () => {
    const key1 = PexelsSearchCache.buildKey('photo', {
      query: 'dog',
      orientation: 'landscape',
      page: 1
    })
    const key2 = PexelsSearchCache.buildKey('photo', {
      page: 1,
      query: 'dog',
      orientation: 'landscape'
    })
    assert.equal(key1, key2)
  })

  it('stores and retrieves cached search responses', () => {
    const testData = { total_results: 5, page: 1, per_page: 15, photos: [] }
    const key = PexelsSearchCache.buildKey('photo', { query: 'sunflower' })
    PexelsSearchCache.set(key, testData)

    const retrieved = PexelsSearchCache.get(key)
    assert.deepEqual(retrieved, testData)
  })
})

describe('Internal media adapter schemas', () => {
  it('validates and parses photo search payloads', () => {
    const rawPhotoResponse = {
      total_results: 1,
      page: 1,
      per_page: 15,
      photos: [
        {
          id: 12345,
          width: 4000,
          height: 3000,
          url: 'https://www.pexels.com/photo/12345/',
          photographer: 'Photographer Name',
          photographer_url: 'https://www.pexels.com/@photographer',
          photographer_id: 999,
          avg_color: '#4A5568',
          src: {
            original: 'https://images.pexels.com/photos/12345/original.jpg',
            large2x: 'https://images.pexels.com/photos/12345/large2x.jpg',
            large: 'https://images.pexels.com/photos/12345/large.jpg',
            medium: 'https://images.pexels.com/photos/12345/medium.jpg',
            small: 'https://images.pexels.com/photos/12345/small.jpg',
            portrait: 'https://images.pexels.com/photos/12345/portrait.jpg',
            landscape: 'https://images.pexels.com/photos/12345/landscape.jpg',
            tiny: 'https://images.pexels.com/photos/12345/tiny.jpg'
          },
          alt: 'A beautiful scenic shot'
        }
      ]
    }

    const parsed = PexelsPhotoSearchResultSchema.parse(rawPhotoResponse)
    assert.equal(parsed.photos.length, 1)
    assert.equal(parsed.photos[0].id, 12345)
    assert.equal(parsed.photos[0].photographer, 'Photographer Name')
  })

  it('validates and parses video search payloads', () => {
    const rawVideoResponse = {
      total_results: 1,
      page: 1,
      per_page: 10,
      videos: [
        {
          id: 67890,
          width: 1920,
          height: 1080,
          url: 'https://www.pexels.com/video/67890/',
          image: 'https://images.pexels.com/videos/67890/preview.jpg',
          duration: 12,
          user: {
            id: 888,
            name: 'Creator Name',
            url: 'https://www.pexels.com/@creator'
          },
          video_files: [
            {
              id: 111,
              quality: 'hd',
              file_type: 'video/mp4',
              width: 1920,
              height: 1080,
              link: 'https://videos.pexels.com/video-files/67890/hd.mp4'
            }
          ]
        }
      ]
    }

    const parsed = PexelsVideoSearchResultSchema.parse(rawVideoResponse)
    assert.equal(parsed.videos.length, 1)
    assert.equal(parsed.videos[0].id, 67890)
    assert.equal(parsed.videos[0].duration, 12)
    assert.equal(parsed.videos[0].video_files[0].quality, 'hd')
  })

  it('validates and parses video search payloads with null quality and optional fields', () => {
    const rawVideoResponseWithNulls = {
      total_results: 1,
      page: 1,
      per_page: 15,
      videos: [
        {
          id: 99999,
          width: 1920,
          height: 1080,
          url: 'https://www.pexels.com/video/99999/',
          image: null,
          user: null,
          video_files: [
            {
              id: 222,
              quality: null,
              file_type: null,
              width: null,
              height: null,
              fps: null,
              link: 'https://videos.pexels.com/video-files/99999/stream.mp4'
            }
          ]
        }
      ]
    }

    const parsed = PexelsVideoSearchResultSchema.parse(rawVideoResponseWithNulls)
    assert.equal(parsed.videos.length, 1)
    assert.equal(parsed.videos[0].id, 99999)
    assert.equal(parsed.videos[0].video_files[0].quality, null)
    assert.equal(
      parsed.videos[0].video_files[0].link,
      'https://videos.pexels.com/video-files/99999/stream.mp4'
    )
  })
})

