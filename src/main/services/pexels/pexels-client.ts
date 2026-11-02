import { ApiCircuitBreaker, ApiError, fetchWithRetry } from '../http/api-errors.ts'
import {
  type PexelsPhotoSearchInput,
  type PexelsPhotoSearchResult,
  type PexelsPhoto,
  type PexelsVideoSearchInput,
  type PexelsVideoSearchResult,
  type PexelsVideo
} from './pexels-types.ts'
import { PexelsSearchCache } from './pexels-search-cache.ts'

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const commonsCircuit = new ApiCircuitBreaker(5, 60_000)

type CommonsPage = {
  pageid: number
  title: string
  imageinfo?: Array<{
    url?: string
    thumburl?: string
    width?: number
    height?: number
    mime?: string
    mediatype?: string
    extmetadata?: Record<string, { value?: string; source?: string; hidden?: string }>
  }>
}
type CommonsResponse = {
  query?: { searchinfo?: { totalhits?: number }; pages?: Record<string, CommonsPage> }
  error?: { info?: string }
}

export class PexelsClient {
  public static resetCircuit(): void { commonsCircuit.reset() }
  public static resetQuota(): void {}
  public static isQuotaExhausted(): boolean { return false }
  public static isQuotaLow(): boolean { return false }
  public static getQuotaSnapshot(): null { return null }

  private static async searchCommons(query: string, type: 'photo' | 'video', page = 1, perPage = 15, signal?: AbortSignal): Promise<CommonsPage[]> {
    commonsCircuit.ensureClosed('Wikimedia Commons API')
    const url = new URL(COMMONS_API)
    url.searchParams.set('action', 'query')
    url.searchParams.set('format', 'json')
    url.searchParams.set('formatversion', '2')
    url.searchParams.set('generator', 'search')
    url.searchParams.set('gsrnamespace', '6')
    url.searchParams.set('gsrsearch', `${query} filetype:${type === 'photo' ? 'bitmap' : 'video'}`)
    url.searchParams.set('gsrlimit', String(Math.min(50, perPage)))
    url.searchParams.set('gsroffset', String((Math.max(1, page) - 1) * Math.min(50, perPage)))
    url.searchParams.set('prop', 'imageinfo')
    url.searchParams.set('iiprop', 'url|size|mime|mediatype|extmetadata')
    url.searchParams.set('iiextmetadatafilter', 'Artist|LicenseShortName|LicenseUrl|ImageDescription|Length')
    url.searchParams.set('iiurlwidth', '640')
    url.searchParams.set('origin', '*')
    const response = await fetchWithRetry(url.toString(), {
      label: 'Wikimedia Commons search',
      maxRetries: 3,
      init: {
        signal,
        headers: { 'User-Agent': 'StockFinderAI/1.0 (Wikimedia Commons media search)' }
      },
      isAborted: () => Boolean(signal?.aborted)
    })
    if (!response.ok) {
      throw new ApiError(`Wikimedia Commons API error: HTTP ${response.status}`, response.status >= 500 ? 'transient' : 'permanent', response.status)
    }
    const data = await response.json() as CommonsResponse
    if (data.error) throw new ApiError(data.error.info || 'Wikimedia Commons search failed', 'transient')
    commonsCircuit.recordSuccess()
    return Object.values(data.query?.pages || {}).filter((page) => {
      const info = page.imageinfo?.[0]
      if (!info?.url || !info.width || !info.height) return false
      return type === 'video'
        ? info.mediatype === 'VIDEO' || Boolean(info.mime && /^(video\/|application\/(ogg|x-ogg))/.test(info.mime))
        : info.mediatype === 'BITMAP' || Boolean(info.mime?.startsWith('image/'))
    })
  }

  private static filePageUrl(title: string): string {
    const encodedTitle = encodeURIComponent(title.replace(/ /g, '_')).replace(/%3A/i, ':')
    return `https://commons.wikimedia.org/wiki/${encodedTitle}`
  }

  private static photoFromPage(page: CommonsPage): PexelsPhoto {
    const info = page.imageinfo![0]
    const original = info.url!
    const preview = info.thumburl || original
    return {
      id: page.pageid,
      width: info.width || 0,
      height: info.height || 0,
      url: this.filePageUrl(page.title),
      photographer: page.imageinfo?.[0]?.extmetadata?.Artist?.value?.replace(/<[^>]*>/g, '').trim() || 'Wikimedia Commons contributor',
      photographer_url: this.filePageUrl(page.title),
      src: { original, large2x: preview, large: preview, medium: preview, small: preview, portrait: preview, landscape: preview, tiny: preview },
      alt: page.title.replace(/^File:/, ''),
      commonsLicense: page.imageinfo?.[0]?.extmetadata?.LicenseShortName?.value?.replace(/<[^>]*>/g, '').trim() || 'License not identified',
      commonsLicenseUrl: page.imageinfo?.[0]?.extmetadata?.LicenseUrl?.value || '',
      commonsDescription: page.imageinfo?.[0]?.extmetadata?.ImageDescription?.value?.replace(/<[^>]*>/g, '').trim() || ''
    }
  }

  private static videoFromPage(page: CommonsPage): PexelsVideo {
    const info = page.imageinfo![0]
    const original = info.url!
    const preview = info.thumburl || ''
    return {
      id: page.pageid,
      width: info.width || 0,
      height: info.height || 0,
      url: this.filePageUrl(page.title),
      image: preview,
      duration: this.parseDuration(info.extmetadata?.Length?.value),
      commonsLicense: info.extmetadata?.LicenseShortName?.value?.replace(/<[^>]*>/g, '').trim() || 'License not identified',
      commonsLicenseUrl: info.extmetadata?.LicenseUrl?.value || '',
      commonsDescription: info.extmetadata?.ImageDescription?.value?.replace(/<[^>]*>/g, '').trim() || '',
      user: { name: page.imageinfo?.[0]?.extmetadata?.Artist?.value?.replace(/<[^>]*>/g, '').trim() || 'Wikimedia Commons contributor', url: this.filePageUrl(page.title) },
      video_files: [{ link: original, file_type: info.mime || 'video/webm', width: info.width || 0, height: info.height || 0, quality: 'original' }]
    }
  }

  private static filterOrientation(pages: CommonsPage[], orientation?: 'landscape' | 'portrait' | 'square'): CommonsPage[] {
    if (!orientation) return pages
    return pages.filter((page) => {
      const info = page.imageinfo?.[0]
      if (!info?.width || !info.height) return false
      const ratio = info.width / info.height
      if (orientation === 'landscape') return ratio > 1.05
      if (orientation === 'portrait') return ratio < 0.95
      return ratio >= 0.95 && ratio <= 1.05
    })
  }

  public static async searchPhotos(input: PexelsPhotoSearchInput, abortSignal?: AbortSignal): Promise<PexelsPhotoSearchResult> {
    const cacheKey = PexelsSearchCache.buildKey('photo', input as unknown as Record<string, unknown>)
    const cached = PexelsSearchCache.get<PexelsPhotoSearchResult>(cacheKey)
    if (cached) return cached
    const pages = this.filterOrientation(await this.searchCommons(input.query, 'photo', input.page, input.per_page, abortSignal), input.orientation)
    const parsed = { total_results: pages.length, page: input.page || 1, per_page: input.per_page || 15, photos: pages.map((page) => this.photoFromPage(page)) }
    PexelsSearchCache.set(cacheKey, parsed)
    return parsed
  }

  public static async searchVideos(input: PexelsVideoSearchInput, abortSignal?: AbortSignal): Promise<PexelsVideoSearchResult> {
    const cacheKey = PexelsSearchCache.buildKey('video', input as unknown as Record<string, unknown>)
    const cached = PexelsSearchCache.get<PexelsVideoSearchResult>(cacheKey)
    if (cached) return cached
    const pages = this.filterOrientation(await this.searchCommons(input.query, 'video', input.page, input.per_page, abortSignal), input.orientation)
    const parsed = { total_results: pages.length, page: input.page || 1, per_page: input.per_page || 10, videos: pages.map((page) => this.videoFromPage(page)) }
    PexelsSearchCache.set(cacheKey, parsed)
    return parsed
  }

  public static async getPhoto(id: number): Promise<PexelsPhoto> {
    const page = await this.getCommonsPage(id)
    return this.photoFromPage(page)
  }

  public static async getVideo(id: number): Promise<PexelsVideo> {
    const page = await this.getCommonsPage(id)
    return this.videoFromPage(page)
  }

  private static parseDuration(value?: string): number {
    if (!value) return 0
    const clock = value.trim().match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/)
    if (clock) return Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
    const parts = value.match(/(\d+(?:\.\d+)?)\s*(h|hr|hour|m|min|minute|s|sec|second)s?/gi)
    if (!parts) return 0
    return parts.reduce((total, part) => {
      const match = part.match(/(\d+(?:\.\d+)?)\s*(h|hr|hour|m|min|minute|s|sec|second)/i)
      if (!match) return total
      const unit = match[2].toLowerCase()
      const factor = unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1
      return total + Number(match[1]) * factor
    }, 0)
  }

  private static async getCommonsPage(id: number): Promise<CommonsPage> {
    const url = new URL(COMMONS_API)
    url.searchParams.set('action', 'query')
    url.searchParams.set('format', 'json')
    url.searchParams.set('formatversion', '2')
    url.searchParams.set('pageids', String(id))
    url.searchParams.set('prop', 'imageinfo')
    url.searchParams.set('iiprop', 'url|size|mime|mediatype|extmetadata')
    url.searchParams.set('iiextmetadatafilter', 'Artist|LicenseShortName|LicenseUrl|ImageDescription|Length')
    url.searchParams.set('iiurlwidth', '640')
    url.searchParams.set('origin', '*')
    const response = await fetchWithRetry(url.toString(), { label: 'Wikimedia Commons file lookup', maxRetries: 2, init: { headers: { 'User-Agent': 'StockFinderAI/1.0 (Wikimedia Commons media search)' } } })
    if (!response.ok) throw new ApiError(`Wikimedia Commons API error: HTTP ${response.status}`, 'transient', response.status)
    const data = await response.json() as CommonsResponse
    const page = Object.values(data.query?.pages || {})[0]
    if (!page?.imageinfo?.[0]?.url) throw new ApiError('Wikimedia Commons file is no longer available.', 'permanent')
    return page
  }
}
