import { ipcMain, dialog, shell, app } from 'electron'
import { SettingsStore } from '../services/storage/settings-store.ts'
import { SecureSecrets } from '../services/storage/secure-secrets.ts'
import { LlmProviderFactory } from '../services/llm/llm-provider.ts'
import { resetLlmCircuit } from '../services/llm/llm-fetch.ts'
import { z } from 'zod'

const SettingsUpdateSchema = z.object({
  llmProvider: z.enum(['openai', 'openrouter', 'gemini']).optional(),
  modelId: z.string().optional(),
  modelIdByProvider: z
    .object({
      openai: z.string().optional(),
      openrouter: z.string().optional(),
      gemini: z.string().optional()
    })
    .optional(),
  downloadFolder: z.string().optional(),
  maxConcurrentDownloads: z.number().min(1).max(10).optional(),
  maxAgentIterations: z.number().min(5).max(50).optional(),
  requestTimeoutSeconds: z.number().min(10).max(600).optional(),
  requestsPerMinute: z.number().min(0).max(300).optional(),
  skipExplicitQueries: z.boolean().optional(),
  requireApprovalBeforeDownload: z.boolean().optional(),
  avoidPeopleAndFaces: z.boolean().optional(),
  isOnboarded: z.boolean().optional(),
  theme: z.enum(['flat-black', 'flat-white']).optional(),
  hideEstimatedCost: z.boolean().optional(),
  agentEngine: z.enum(['loop', 'pipeline']).optional(),
  rankWithThumbnails: z.boolean().optional(),
  autoCheckForUpdates: z.boolean().optional(),
  // Keys are sent in the update payload but stored securely in Keychain, not in settings.json
  openaiKey: z.string().optional(),
  geminiKey: z.string().optional(),
  openrouterKey: z.string().optional(),
  // Blank key fields mean "leave unchanged", so deleting a stored key is its own request.
  removeSecrets: z
    .array(z.enum(['openaiKey', 'geminiKey', 'openrouterKey']))
    .optional()
})

const ProviderTestRequestSchema = z.object({
  provider: z.enum(['openai', 'openrouter', 'gemini']),
  apiKey: z.string(),
  modelId: z.string()
})

const MASKED_SECRET = '••••••••••••••••'

function isMaskedSecret(value: string): boolean {
  return value === MASKED_SECRET
}

async function getPublicSettingsWithSecretStatus(): Promise<Record<string, unknown>> {
  const settings = await SettingsStore.getSettings()

  const openaiKey = await SecureSecrets.hasSecret('openaiKey')
  const geminiKey = await SecureSecrets.hasSecret('geminiKey')
  const openrouterKey = await SecureSecrets.hasSecret('openrouterKey')

  return {
    ...settings,
    openaiKey: openaiKey ? MASKED_SECRET : '',
    geminiKey: geminiKey ? MASKED_SECRET : '',
    openrouterKey: openrouterKey ? MASKED_SECRET : '',
  }
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:getPublicSettings', async () => {
    return await getPublicSettingsWithSecretStatus()
  })

  ipcMain.handle('settings:updateSettings', async (_, rawInput) => {
    const input = SettingsUpdateSchema.parse(rawInput)

    // Only write secrets when a real (non-empty, non-masked) value is provided.
    // Blank/whitespace means "leave unchanged" — never overwrite or delete a stored key.
    const applySecret = async (
      key: 'openaiKey' | 'geminiKey' | 'openrouterKey',
      value: string | undefined
    ): Promise<void> => {
      if (value === undefined || isMaskedSecret(value)) return
      const trimmed = value.trim()
      if (!trimmed) return
      await SecureSecrets.setSecret(key, trimmed)
    }

    for (const key of input.removeSecrets ?? []) {
      await SecureSecrets.setSecret(key, '')
    }

    await applySecret('openaiKey', input.openaiKey)
    await applySecret('geminiKey', input.geminiKey)
    await applySecret('openrouterKey', input.openrouterKey)

    const publicSettings = Object.fromEntries(
      Object.entries({
        llmProvider: input.llmProvider,
        modelId: input.modelId?.trim(),
        modelIdByProvider: input.modelIdByProvider,
        downloadFolder: input.downloadFolder,
        maxConcurrentDownloads: input.maxConcurrentDownloads,
        maxAgentIterations: input.maxAgentIterations,
        requestTimeoutSeconds: input.requestTimeoutSeconds,
        requestsPerMinute: input.requestsPerMinute,
        skipExplicitQueries: input.skipExplicitQueries,
        requireApprovalBeforeDownload: input.requireApprovalBeforeDownload,
        avoidPeopleAndFaces: input.avoidPeopleAndFaces,
        isOnboarded: input.isOnboarded,
        theme: input.theme,
        hideEstimatedCost: input.hideEstimatedCost,
        agentEngine: input.agentEngine,
        rankWithThumbnails: input.rankWithThumbnails,
        autoCheckForUpdates: input.autoCheckForUpdates
      }).filter(([, value]) => value !== undefined)
    )
    await SettingsStore.updateSettings(publicSettings)
    return await getPublicSettingsWithSecretStatus()
  })

  ipcMain.handle('settings:testProvider', async (_, rawInput) => {
    const providerRequest = ProviderTestRequestSchema.parse(rawInput)
    const { provider, modelId } = providerRequest
    let { apiKey } = providerRequest
    if (apiKey === 'CURRENT_KEY_ON_DISK') {
      apiKey = await SecureSecrets.getSecret(`${provider}Key`)
    }
    apiKey = (apiKey || '').trim()
    if (!apiKey) {
      return {
        success: false,
        message: `${provider.toUpperCase()} API key is missing. Please enter an API key.`
      }
    }
    // Reset circuit breaker so testing a key doesn't fail on a stale open breaker
    resetLlmCircuit()
    const client = LlmProviderFactory.getProvider(provider)
    return await client.testConnection({ apiKey }, modelId?.trim())
  })


  ipcMain.handle('settings:chooseDownloadFolder', async () => {
    // Electron 43 stopped remembering the last folder, so open at the current download folder.
    const current = await SettingsStore.getSettings().then(
      (settings) => settings.downloadFolder,
      () => undefined
    )
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      ...(current ? { defaultPath: current } : {})
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('settings:openAppDataFolder', async () => {
    const appDataPath = app.getPath('userData')
    const openError = await shell.openPath(appDataPath)
    if (openError) {
      throw new Error(`Failed to open app data folder: ${openError}`)
    }
  })
}
