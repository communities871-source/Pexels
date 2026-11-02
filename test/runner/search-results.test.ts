import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { StartJobInput } from '../../src/main/services/agent/agent-runner.ts'
import { installFakeNetwork, type FakeNetwork } from '../support/fake-network.ts'
import { photo, video } from '../support/pexels-fixtures.ts'
import { resetNetworkState, runJob, searchPhotos, select, submitBeats } from '../support/run-job.ts'
import { ONE_BEAT_SCRIPT } from '../support/scenarios.ts'

describe('runner: what the model gets back from a search', () => {
  let network: FakeNetwork

  beforeEach(() => {
    resetNetworkState()
    network = installFakeNetwork()
  })

  afterEach(() => {
    network.restore()
  })

  /** Scripts one beat that searches photos and videos together, then takes the clip. */
  function scriptBothSearches(
    platform: StartJobInput['platform'] = 'YouTube',
    videoArgs: Record<string, unknown> = {}
  ): void {
    const videoShape = videoArgs.orientation === 'square'
      ? [3000, 3000]
      : platform === 'YouTube' ? [3840, 2160] : [2160, 3840]
    const photoShape = platform === 'YouTube' ? [6000, 4000] : [4000, 6000]
    network.pexels
      .videos('city street', [video(101, 'city-street', [['uhd', videoShape[0], videoShape[1]]])])
      .photos('quiet desk', [photo(201, 'A quiet desk', photoShape[0], photoShape[1])])
    network.llm
      .tools([submitBeats([ONE_BEAT_SCRIPT])])
      .tools([
        {
          name: 'search_pexels_videos',
          args: { beatId: 'beat_1', query: 'city street', ...videoArgs }
        },
        searchPhotos('beat_1', 'quiet desk')
      ])
      .tools([select([{ beatId: 'beat_1', assetType: 'video', pexelsId: 101 }])])
  }

  function orientationOf(path: '/v1/search' | '/v1/videos/search'): string | null {
    const type = path === '/v1/videos/search' ? 'video' : 'photo'
    const toolName = type === 'video' ? 'search_pexels_videos' : 'search_pexels_photos'
    const request = network.llmRequests()[2]
    assert.ok(request, 'the model receives the search results')
    const result = request.messages
      .filter((message) => message.role === 'tool' && message.name === toolName)
      .map((message) => JSON.parse(message.content || '{}') as { results?: Array<{ shape?: string }> })[0]
    return result?.results?.[0]?.shape ?? null
  }

  it('is a short description of each result, with no URLs in it', async () => {
    scriptBothSearches()

    await runJob({ script: ONE_BEAT_SCRIPT })

    assert.deepEqual(network.problems, [])
    const results = network
      .llmRequests()[2]
      .messages.filter((message) => message.role === 'tool')
      .map((message) => message.content || '')
    assert.equal(results.length, 2)
    const [videos, photos] = results.map((content) => JSON.parse(content))
    assert.deepEqual(videos, {
      total_results: 1,
      results: [
        {
          pexelsId: 101,
          about: 'city street',
          shape: 'landscape',
          size: '3840x2160',
          seconds: 12,
          fullHd: true
        }
      ]
    })
    assert.deepEqual(photos, {
      total_results: 1,
      results: [{ pexelsId: 201, about: 'A quiet desk', shape: 'landscape', size: '6000x4000' }]
    })
    for (const content of results) assert.doesNotMatch(content, /https?:\/\//)
  })

  it('still lets the model select a result it only saw as a short description', async () => {
    // The download file is not in what the model saw; the app finds it in its own candidates.
    scriptBothSearches()

    const run = await runJob({ script: ONE_BEAT_SCRIPT })

    assert.equal(run.snapshot.status, 'completed')
    assert.equal(run.manifest.beats[0].assets[0].pexelsId, 101)
  })

  for (const [platform, shape] of [
    ['YouTube', 'landscape'],
    ['Shorts', 'portrait'],
    ['TikTok', 'portrait'],
    ['Instagram Reels', 'portrait']
  ] as Array<[StartJobInput['platform'], string]>) {
    it(`searches ${shape} for ${platform} when the model sets no orientation`, async () => {
      scriptBothSearches(platform)

      await runJob({ script: ONE_BEAT_SCRIPT, platform })

      assert.deepEqual(network.problems, [])
      assert.equal(orientationOf('/v1/videos/search'), shape)
      assert.equal(orientationOf('/v1/search'), shape)
    })
  }

  it('keeps an orientation the model asks for', async () => {
    scriptBothSearches('TikTok', { orientation: 'square' })

    await runJob({ script: ONE_BEAT_SCRIPT, platform: 'TikTok' })

    assert.deepEqual(network.problems, [])
    assert.equal(orientationOf('/v1/videos/search'), 'square')
    assert.equal(orientationOf('/v1/search'), 'portrait', 'the other search still defaults')
  })
})
