import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { fetchValidatedDownload } from '../src/main/services/pexels/download-url-validation.ts'

const originalFetch = globalThis.fetch

describe('Download redirect validation', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  const redirectTo = (location: string): Response =>
    ({ status: 302, headers: new Headers({ location }), body: null }) as unknown as Response
  const ok = (): Response =>
    ({ status: 200, headers: new Headers(), body: null }) as unknown as Response

  it('follows redirects between allowed hosts without auto-following', async () => {
    const requested: string[] = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      requested.push(url)
      assert.equal(init?.redirect, 'manual')
      return requested.length === 1 ? redirectTo('https://upload.wikimedia.org/final.mp4') : ok()
    }) as typeof globalThis.fetch

    const response = await fetchValidatedDownload('https://upload.wikimedia.org/start.jpg')
    assert.equal(response.status, 200)
    assert.deepEqual(requested, [
      'https://upload.wikimedia.org/start.jpg',
      'https://upload.wikimedia.org/final.mp4'
    ])
  })

  it('never requests a redirect target outside the allowlist', async () => {
    const requested: string[] = []
    globalThis.fetch = (async (url: string) => {
      requested.push(url)
      return redirectTo('https://169.254.169.254/latest/meta-data/')
    }) as typeof globalThis.fetch

    await assert.rejects(
      () => fetchValidatedDownload('https://upload.wikimedia.org/start.jpg'),
      /not an allowed Wikimedia Commons host/
    )
    assert.deepEqual(requested, ['https://upload.wikimedia.org/start.jpg'])
  })

  it('gives up on redirect loops', async () => {
    globalThis.fetch = (async () =>
      redirectTo('https://upload.wikimedia.org/loop.jpg')) as typeof globalThis.fetch

    await assert.rejects(
      () => fetchValidatedDownload('https://upload.wikimedia.org/loop.jpg'),
      /redirected more than/
    )
  })
})
