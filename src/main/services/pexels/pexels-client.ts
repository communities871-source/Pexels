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
    url.searchParams.set('iiprop', 'url|size|mime')
    url.searchParams.set('iiurlwidth', '640')
    url.searchParams.set('origin', '*')
    const response = await fetchWithRetry(url.toString(), {
      label: 'Wikimedia Commons search',
      maxRetries: 3,
      init: {
        signal,
        headers: { 'Api-User-Agent': 'StockFinderAI/1.0 (Wikimedia Commons media search)' }
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
      return type === 'video' ? Boolean(info.mime?.startsWith('video/')) : Boolean(info.mime?.startsWith('image/'))
    })
  }

  private static photoFromPage(page: CommonsPage): PexelsPhoto {
    const info = page.imageinfo![0]
    const original = info.url!
    const preview = info.thumburl || original
    return {
      id: page.pageid,
      width: info.width || 0,
      height: info.height || 0,
      url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      photographer: 'Wikimedia Commons contributor',
      photographer_url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      src: { original, large2x: preview, large: preview, medium: preview, small: preview, portrait: preview, landscape: preview, tiny: preview },
      alt: page.title.replace(/^File:/, '')
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
      url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      image: preview,
      duration: 0,
      user: { name: 'Wikimedia Commons contributor', url: 'https://commons.wikimedia.org/' },
      video_files: [{ link: original, file_type: info.mime || 'video/webm', width: info.width || 0, height: info.height || 0, quality: 'original' }]
    }
  }

  public static async searchPhotos(input: PexelsPhotoSearchInput, abortSignal?: AbortSignal): Promise<PexelsPhotoSearchResult> {
    const cacheKey = PexelsSearchCache.buildKey('photo', input as unknown as Record<string, unknown>)
    const cached = PexelsSearchCache.get<PexelsPhotoSearchResult>(cacheKey)
    if (cached) return cached
    const pages = await this.searchCommons(input.query, 'photo', input.page, input.per_page, abortSignal)
    const parsed = { total_results: pages.length, page: input.page || 1, per_page: input.per_page || 15, photos: pages.map((page) => this.photoFromPage(page)) }
    PexelsSearchCache.set(cacheKey, parsed)
    return parsed
  }

  public static async searchVideos(input: PexelsVideoSearchInput, abortSignal?: AbortSignal): Promise<PexelsVideoSearchResult> {
    const cacheKey = PexelsSearchCache.buildKey('video', input as unknown as Record<string, unknown>)
    const cached = PexelsSearchCache.get<PexelsVideoSearchResult>(cacheKey)
    if (cached) return cached
    const pages = await this.searchCommons(input.query, 'video', input.page, input.per_page, abortSignal)
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

  private static async getCommonsPage(id: number): Promise<CommonsPage> {
    const url = new URL(COMMONS_API)
    url.searchParams.set('action', 'query')
    url.searchParams.set('format', 'json')
    url.searchParams.set('formatversion', '2')
    url.searchParams.set('pageids', String(id))
    url.searchParams.set('prop', 'imageinfo')
    url.searchParams.set('iiprop', 'url|size|mime')
    url.searchParams.set('iiurlwidth', '640')
    const response = await fetchWithRetry(url.toString(), { label: 'Wikimedia Commons file lookup', maxRetries: 2, init: { headers: { 'Api-User-Agent': 'StockFinderAI/1.0 (Wikimedia Commons media search)' } } })
    if (!response.ok) throw new ApiError(`Wikimedia Commons API error: HTTP ${response.status}`, 'transient', response.status)
    const data = await response.json() as CommonsResponse
    const page = Object.values(data.query?.pages || {})[0]
    if (!page?.imageinfo?.[0]?.url) throw new ApiError('Wikimedia Commons file is no longer available.', 'permanent')
    return page
  }
}
