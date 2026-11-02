import type { PublicSettings } from '@renderer/lib/store'
import { PRESET_STYLES } from './constants'

export function isPresetStyle(style: string): boolean {
  return PRESET_STYLES.some((preset) => preset.value === style)
}

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0
}

export function estimateReadSeconds(wordCount: number): number {
  return Math.max(1, Math.round((wordCount / 140) * 60))
}

export function starterTitle(label: string): string {
  return label.replace(/^[^a-zA-Z0-9]+/, '')
}

export function resolveFinalTitle(title: string, idea: string): string {
  return (
    title.trim() ||
    (idea.trim().length > 40 ? `${idea.trim().slice(0, 40)}…` : idea.trim()) ||
    'New Video Pack'
  )
}

export function getActiveProvider(settings: PublicSettings | null): PublicSettings['llmProvider'] {
  return settings?.llmProvider || 'openai'
}

export function getActiveProviderKey(settings: PublicSettings | null): string {
  return (settings && settings[`${getActiveProvider(settings)}Key`]) || ''
}

export type MissingCredentials = 'llm' | null

export function getMissingCredentials(settings: PublicSettings | null): MissingCredentials {
  return getActiveProviderKey(settings) ? null : 'llm'
}

export function describeMissingCredentials(
  missing: Exclude<MissingCredentials, null>,
  provider: string
): string {
  return `Active LLM Provider (${provider.toUpperCase()}) API Key is missing.`
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60]
]

/** "3 hours ago", "yesterday", "just now". */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000
  if (!Number.isFinite(seconds)) return ''
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}
