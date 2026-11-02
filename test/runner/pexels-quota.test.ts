import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { PexelsClient } from '../../src/main/services/pexels/pexels-client.ts'
import { PexelsSearchCache } from '../../src/main/services/pexels/pexels-search-cache.ts'

const originalFetch = globalThis.fetch

describe('runner media search uses Wikimedia Commons without a media API key', () => {
  beforeEach(() => PexelsSearchCache.clear())
  afterEach(() => {
    globalThis.fetch = originalFetch
    PexelsSearchCache.clear()
  })

  it('searches Commons and preserves creator and license metadata', async () => {
    const requested: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested.push(String(input))
      return new Response(JSON.stringify({
        query: {
          pages: [{
            pageid: 123,
            title: 'File:Example.jpg',
            imageinfo: [{
              url: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Example.jpg',
              thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Example.jpg/640px-Example.jpg',
              width: 1920,
              height: 1080,
              mime: 'image/jpeg',
              extmetadata: {
                Artist: { value: 'Example creator' },
                LicenseShortName: { value: 'CC BY-SA 4.0' },
                LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
                ImageDescription: { value: 'An example image' }
              }
            }]
          }]
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof globalThis.fetch

    const result = await PexelsClient.searchPhotos({ query: 'example' })
    assert.equal(result.photos.length, 1)
    assert.equal(result.photos[0].photographer, 'Example creator')
    assert.equal(result.photos[0].commonsLicense, 'CC BY-SA 4.0')
    assert.equal(result.photos[0].url, 'https://commons.wikimedia.org/wiki/File:Example.jpg')
    assert.match(requested[0], /commons\.wikimedia\.org\/w\/api\.php/)
    assert.match(requested[0], /filetype%3Abitmap|filetype:bitmap/)
    assert.equal(PexelsClient.isQuotaExhausted(), false)
  })
})
