import type { PexelsPhoto, PexelsVideo } from '../../src/main/services/pexels/pexels-types.ts'

/**
 * Replaces globalThis.fetch with a router, so a test sees every request the app makes
 * and nothing reaches the real internet. LLM replies are scripted per test; Commons
 * searches answer from fixtures; media URLs answer with a small body.
 */

export interface RecordedRequest {
  url: URL
  method: string
  headers: Record<string, string>
  json?: unknown
}

export interface ToolCallSpec {
  name: string
  args: unknown
}

/** One part of a message that carries images, as OpenAI Chat Completions takes it. */
export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } }

/** An OpenAI chat completion request body, as the app sent it. */
export interface LlmRequestBody {
  model: string
  messages: Array<{
    role: string
    /** A string, or parts when the message carries images. */
    content: string | LlmContentPart[] | null
    name?: string
    tool_call_id?: string
    tool_calls?: unknown[]
  }>
  tools?: unknown[]
  [key: string]: unknown
}

export type LlmReply =
  | { kind: 'tools'; calls: ToolCallSpec[]; content?: string | null }
  | { kind: 'text'; content: string }
  | { kind: 'error'; status: number; message: string }

type QueuedReply = LlmReply | ((request: LlmRequestBody) => LlmReply)

export interface ScriptedLlm {
  /** The next reply calls these tools. */
  tools(calls: ToolCallSpec[]): ScriptedLlm
  /** The next reply is plain text with no tool calls. */
  text(content: string): ScriptedLlm
  /** The next reply is an HTTP error with an OpenAI-shaped error body. */
  error(status: number, message: string): ScriptedLlm
  /** The next reply is computed from the request, for tests that react to tool results. */
  dynamic(reply: (request: LlmRequestBody) => LlmReply): ScriptedLlm
  /** Replies still waiting to be used. */
  remaining(): number
}

export interface FakePexels {
  /** Results for a photo search with this exact query. Other queries find nothing. */
  photos(query: string, results: PexelsPhoto[]): FakePexels
  /** Results for a video search with this exact query. Other queries find nothing. */
  videos(query: string, results: PexelsVideo[]): FakePexels
  /** Sent as X-Ratelimit-* headers on every Commons API answer. `resetAt` is in epoch seconds. */
  quota: { limit: number; remaining: number; resetAt: number }
  /** The next search answers with this status instead of results. */
  failNextSearch(status: number): FakePexels
  /** The next media file request answers with this status instead of the file. */
  failNextMedia(status: number): FakePexels
}

export interface FakeNetwork {
  requests: RecordedRequest[]
  /**
   * Requests no route or script covered. They are answered with HTTP 400 so the app
   * stops instead of backing off; a passing test asserts this is empty.
   */
  problems: string[]
  /** Chat completion requests only, in order. */
  llmRequests(): LlmRequestBody[]
  /** Requests to Wikimedia Commons API only, in order. */
  pexelsRequests(): RecordedRequest[]
  /** Requests for media files only, in order. */
  mediaRequests(): RecordedRequest[]
  llm: ScriptedLlm
  pexels: FakePexels
  restore(): void
}

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const MEDIA_BODY = new Uint8Array(1024).fill(7)

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: { message, type: 'invalid_request_error' } }, status)
}

export function installFakeNetwork(): FakeNetwork {
  const originalFetch = globalThis.fetch
  const requests: RecordedRequest[] = []
  const problems: string[] = []
  const queue: QueuedReply[] = []
  const photoResults = new Map<string, PexelsPhoto[]>()
  const videoResults = new Map<string, PexelsVideo[]>()
  let failNextSearchStatus: number | null = null
  let failNextMediaStatus: number | null = null
  let callCounter = 0

  const llm: ScriptedLlm = {
    tools(calls) {
      queue.push({ kind: 'tools', calls })
      return llm
    },
    text(content) {
      queue.push({ kind: 'text', content })
      return llm
    },
    error(status, message) {
      queue.push({ kind: 'error', status, message })
      return llm
    },
    dynamic(reply) {
      queue.push(reply)
      return llm
    },
    remaining: () => queue.length
  }

  const pexels: FakePexels = {
    photos(query, results) {
      photoResults.set(query, results)
      return pexels
    },
    videos(query, results) {
      videoResults.set(query, results)
      return pexels
    },
    quota: { limit: 20000, remaining: 19000, resetAt: Math.floor(Date.now() / 1000) + 86400 },
    failNextSearch(status) {
      failNextSearchStatus = status
      return pexels
    },
    failNextMedia(status) {
      failNextMediaStatus = status
      return pexels
    }
  }

  const problem = (message: string): Response => {
    problems.push(message)
    return errorResponse(400, message)
  }

  const answerLlm = (body: LlmRequestBody): Response => {
    const next = queue.shift()
    if (!next) {
      return problem(
        `The scripted LLM has no reply left for this request: ${JSON.stringify(body.messages.slice(-2))}`
      )
    }
    const reply = typeof next === 'function' ? next(body) : next
    if (reply.kind === 'error') return errorResponse(reply.status, reply.message)

    const calls = reply.kind === 'tools' ? reply.calls : []
    const content = reply.kind === 'text' ? reply.content : (reply.content ?? null)
    return jsonResponse({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      model: body.model,
      choices: [
        {
          index: 0,
          finish_reason: calls.length > 0 ? 'tool_calls' : 'stop',
          message: {
            role: 'assistant',
            content,
            tool_calls:
              calls.length > 0
                ? calls.map((call) => ({
                    id: `call_${++callCounter}`,
                    type: 'function',
                    function: { name: call.name, arguments: JSON.stringify(call.args) }
                  }))
                : undefined
          }
        }
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
    })
  }

  const commonsFile = (
    item: PexelsPhoto | PexelsVideo,
    type: 'photo' | 'video'
  ): {
    pageid: number
    title: string
    imageinfo: Array<{
      url: string
      thumburl: string
      width: number
      height: number
      mime: string
      extmetadata: Record<string, { value: string }>
    }>
  } => {
    const title = `File:${type}-${item.id}.${type === 'photo' ? 'jpg' : 'webm'}`
    const ext = type === 'photo' ? 'jpg' : 'webm'
    const mime = type === 'photo' ? 'image/jpeg' : 'video/webm'
    const artist = type === 'photo'
      ? (item as PexelsPhoto).photographer || 'Wikimedia Commons contributor'
      : (item as PexelsVideo).user?.name || 'Wikimedia Commons contributor'
    const duration = type === 'video' ? (item as PexelsVideo).duration || 0 : 0
    const length = `${Math.floor(duration / 3600)}:${String(Math.floor(duration % 3600 / 60)).padStart(2, '0')}:${String(duration % 60).padStart(2, '0')}`
    const fileUrl = `https://upload.wikimedia.org/wikipedia/commons/a/a1/${type}-${item.id}.${ext}`
    return {
      pageid: item.id,
      title,
      imageinfo: [{
        url: type === 'video' && !(item as PexelsVideo).video_files.length ? '' : fileUrl,
        thumburl: type === 'photo'
          ? `https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/${type}-${item.id}.${ext}/1880px-${type}-${item.id}.${ext}`
          : `https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/${type}-${item.id}.${ext}/640px-${type}-${item.id}.${ext}.jpg`,
        width: item.width,
        height: item.height,
        mime,
        extmetadata: {
          Artist: { value: artist },
          LicenseShortName: { value: 'CC BY-SA 4.0' },
          LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
          ImageDescription: { value: title },
          Length: { value: length }
        }
      }]
    }
  }

  const answerCommons = (url: URL): Response => {
    if (failNextSearchStatus !== null && url.searchParams.has('generator')) {
      const status = failNextSearchStatus
      failNextSearchStatus = null
      return jsonResponse({ error: { info: 'Simulated Commons API failure' } }, status)
    }

    if (url.searchParams.has('generator')) {
      const rawQuery = url.searchParams.get('gsrsearch') || ''
      const isVideo = /filetype:video$/i.test(rawQuery)
      const query = rawQuery.replace(/\s+filetype:(?:bitmap|video)$/i, '').trim()
      const found = isVideo ? (videoResults.get(query) || []) : (photoResults.get(query) || [])
      const pages = found.map((item) => commonsFile(item, isVideo ? 'video' : 'photo'))
      return jsonResponse({ query: { pages } })
    }

    const pageId = Number(url.searchParams.get('pageids'))
    if (Number.isFinite(pageId) && pageId > 0) {
      const photo = [...photoResults.values()].flat().find((item) => item.id === pageId)
      const video = [...videoResults.values()].flat().find((item) => item.id === pageId)
      const item = photo || video
      if (!item) return jsonResponse({ query: { pages: [] } }, 200)
      return jsonResponse({ query: { pages: [commonsFile(item, photo ? 'photo' : 'video')] } })
    }

    return problem(`Unexpected Wikimedia Commons API request: ${url.href}`)
  }

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method || 'GET').toUpperCase()
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const json = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
    requests.push({ url, method, headers, json })

    if (init?.signal?.aborted) {
      throw new DOMException('This operation was aborted', 'AbortError')
    }

    if (url.href === OPENAI_CHAT_URL && method === 'POST') {
      return answerLlm(json as LlmRequestBody)
    }
    if (url.hostname === 'commons.wikimedia.org' && method === 'GET') {
      return answerCommons(url)
    }
    if (url.hostname === 'upload.wikimedia.org') {
      if (failNextMediaStatus !== null) {
        const status = failNextMediaStatus
        failNextMediaStatus = null
        return new Response('Not found', { status })
      }
      return new Response(MEDIA_BODY, {
        status: 200,
        headers: {
          'content-type': /\.(?:webm|ogv)$/i.test(url.pathname) ? 'video/webm' : 'image/jpeg',
          'content-length': String(MEDIA_BODY.length)
        }
      })
    }
    return problem(`Unexpected network request: ${url.href}`)
  }) as typeof globalThis.fetch

  return {
    requests,
    problems,
    llmRequests: () =>
      requests.filter((r) => r.url.href === OPENAI_CHAT_URL).map((r) => r.json as LlmRequestBody),
    pexelsRequests: () => requests.filter((r) => r.url.hostname === 'commons.wikimedia.org'),
    mediaRequests: () =>
      requests.filter(
        (r) => r.url.hostname === 'upload.wikimedia.org'
      ),
    llm,
    pexels,
    restore() {
      globalThis.fetch = originalFetch
    }
  }
}
