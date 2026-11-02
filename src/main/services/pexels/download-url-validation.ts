/**
 * Restrict media downloads to Wikimedia Commons' own HTTPS file hosts.
 * Redirects are checked hop-by-hop to prevent an allowlisted URL escaping elsewhere.
 */
const ALLOWED_DOWNLOAD_HOSTS = new Set(['upload.wikimedia.org', 'commons.wikimedia.org'])

export function validateDownloadUrl(urlStr: string): void {
  let url: URL
  try {
    url = new URL(urlStr)
  } catch {
    throw new Error(`Invalid URL format: ${urlStr}`)
  }
  if (url.protocol !== 'https:') throw new Error(`Unauthorized protocol: ${url.protocol} (HTTPS required)`)
  const hostname = url.hostname.toLowerCase()
  if (!ALLOWED_DOWNLOAD_HOSTS.has(hostname)) {
    throw new Error(`Security Check Failed: Download host is not an allowed Wikimedia Commons host: ${hostname}`)
  }
  if (url.username || url.password || url.port) {
    throw new Error('Security Check Failed: Download URL cannot contain credentials or a custom port.')
  }
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Security Check Failed: Download URL cannot reference private network hosts.')
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[')) {
    throw new Error('Security Check Failed: Direct IP download URLs are not allowed.')
  }
}

const MAX_DOWNLOAD_REDIRECTS = 5

export async function fetchValidatedDownload(url: string, signal?: AbortSignal): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_DOWNLOAD_REDIRECTS; hop++) {
    validateDownloadUrl(current)
    const response = await fetch(current, { signal, redirect: 'manual' })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) return response
    await response.body?.cancel()
    current = new URL(location, current).toString()
  }
  throw new Error(`Download redirected more than ${MAX_DOWNLOAD_REDIRECTS} times: ${url}`)
}
