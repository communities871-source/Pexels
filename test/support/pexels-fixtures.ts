import type { PexelsPhoto, PexelsVideo } from '../../src/main/services/pexels/pexels-types.ts'

/**
 * Wikimedia Commons-shaped fixtures. The fake Commons API assigns these same
 * canonical upload.wikimedia.org URLs when it turns a fixture into an API page.
 */
const COMMONS_FILE = 'https://upload.wikimedia.org/wikipedia/commons/a/a1'
const COMMONS_THUMB = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1'

/** A photo shaped like a Wikimedia Commons search result. */
export function photo(id: number, alt: string, width = 6000, height = 4000): PexelsPhoto {
  const file = `photo-${id}.jpg`
  const original = `${COMMONS_FILE}/${file}`
  const thumbnail = `${COMMONS_THUMB}/${file}/1880px-${file}`
  return {
    id,
    width,
    height,
    alt,
    url: `https://commons.wikimedia.org/wiki/File:${file}`,
    photographer: 'Test Photographer',
    photographer_url: `https://commons.wikimedia.org/wiki/File:${file}`,
    commonsLicense: 'CC BY-SA 4.0',
    commonsLicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    commonsDescription: alt,
    src: {
      original,
      large2x: thumbnail,
      large: thumbnail,
      medium: thumbnail,
      small: thumbnail,
      portrait: thumbnail,
      landscape: thumbnail,
      tiny: thumbnail
    }
  }
}

export type VideoFileSpec = [quality: 'uhd' | 'hd' | 'sd', width: number, height: number]

/** A video shaped like a Commons result: one original downloadable file. */
export function video(
  id: number,
  slug: string,
  files: VideoFileSpec[] = [['uhd', 3840, 2160]],
  duration = 12
): PexelsVideo {
  const file = `video-${id}.webm`
  const original = `${COMMONS_FILE}/${file}`
  const preview = `${COMMONS_THUMB}/${file}/640px-${file}.jpg`
  const [, width, height] = files[0] || ['uhd', 3840, 2160]
  return {
    id,
    width,
    height,
    duration,
    url: `https://commons.wikimedia.org/wiki/File:${file}`,
    image: preview,
    commonsLicense: 'CC BY-SA 4.0',
    commonsLicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    commonsDescription: slug.replace(/-/g, ' '),
    user: { id: 1, name: 'Test Creator', url: `https://commons.wikimedia.org/wiki/File:${file}` },
    video_files: [{
      id,
      quality: 'original',
      file_type: 'video/webm',
      width,
      height,
      link: original
    }],
    video_pictures: []
  }
}

/** The single downloadable original file of a Commons video fixture. */
export function videoFileUrl(item: PexelsVideo, _quality: 'uhd' | 'hd' | 'sd'): string {
  const file = item.video_files[0]
  if (!file) throw new Error(`Fixture video ${item.id} has no downloadable file`)
  return file.link
}
