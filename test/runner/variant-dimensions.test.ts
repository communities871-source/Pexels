import assert from 'node:assert/strict'
import { basename } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { installFakeNetwork, type FakeNetwork } from '../support/fake-network.ts'
import { photo, video, videoFileUrl } from '../support/pexels-fixtures.ts'
import {
  resetNetworkState,
  runJob,
  searchPhotos,
  searchVideos,
  select,
  submitBeats
} from '../support/run-job.ts'
import { ONE_BEAT_SCRIPT } from '../support/scenarios.ts'

describe('runner: Commons original media dimensions', () => {
  let network: FakeNetwork

  beforeEach(() => {
    resetNetworkState()
    network = installFakeNetwork()
  })

  afterEach(() => {
    network.restore()
  })

  it('records and names the Commons original video dimensions', async () => {
    // Commons exposes the original video file at its source dimensions.
    const clip = video(101, 'city-street')
    network.pexels.videos('city street', [clip])
    network.llm
      .tools([submitBeats([ONE_BEAT_SCRIPT])])
      .tools([searchVideos('beat_1', 'city street')])
      .tools([
        select([
          {
            beatId: 'beat_1',
            assetType: 'video',
            pexelsId: 101,
            variantUrl: videoFileUrl(clip, 'sd')
          }
        ])
      ])

    const run = await runJob({ script: ONE_BEAT_SCRIPT })

    assert.deepEqual(network.problems, [])
    assert.equal(run.snapshot.status, 'completed')
    const [asset] = run.manifest.beats[0].assets
    assert.deepEqual([asset.width, asset.height], [3840, 2160])
    assert.match(basename(asset.filePath || ''), /3840x2160/)
  })

  it('does the same for a resized photo, whose size is in its URL', async () => {
    // The photo itself is 6000x4000; "large2x" fits it into a 1880x1300 box.
    const still = photo(201, 'A quiet desk')
    network.pexels.photos('quiet desk', [still])
    network.llm
      .tools([submitBeats([ONE_BEAT_SCRIPT])])
      .tools([searchPhotos('beat_1', 'quiet desk')])
      .tools([
        select([
          {
            beatId: 'beat_1',
            assetType: 'photo',
            pexelsId: 201,
            variantUrl: still.src.large2x || ''
          }
        ])
      ])

    const run = await runJob({ script: ONE_BEAT_SCRIPT })

    assert.deepEqual(network.problems, [])
    assert.equal(run.snapshot.status, 'completed')
    const [asset] = run.manifest.beats[0].assets
    assert.deepEqual([asset.width, asset.height], [1880, 1253])
    assert.match(basename(asset.filePath || ''), /1880x1253/)
  })
})
