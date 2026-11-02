export interface CommonsAssetAttribution {
  assetId: string
  type: 'photo' | 'video'
  commonsId: number
  commonsUrl: string
  creator: string
  creatorUrl?: string
  license: string
  licenseUrl?: string
  description?: string
  creditLine: string
}

export interface CommonsManifestAttribution {
  source: {
    name: 'Wikimedia Commons'
    url: string
    creditText: string
  }
  usageNote: string
  assets: CommonsAssetAttribution[]
}

interface AttributionAssetInput {
  id: string
  type: 'photo' | 'video'
  pexelsId: number
  url: string
  photographer: string
  photographerUrl?: string
  license?: string
  licenseUrl?: string
  description?: string
}

export function buildCommonsAssetUrl(url: string): string {
  return url.startsWith('https://commons.wikimedia.org/')
    ? url
    : 'https://commons.wikimedia.org/'
}

export function buildManifestAttribution(
  assets: AttributionAssetInput[]
): CommonsManifestAttribution {
  const seenIds = new Set<string>()
  const attributionAssets: CommonsAssetAttribution[] = []

  for (const asset of assets) {
    if (!asset.pexelsId || seenIds.has(asset.id)) continue
    seenIds.add(asset.id)
    const creator = asset.photographer || 'Wikimedia Commons contributor'
    const license = asset.license || 'License not identified; verify the file page before reuse'
    attributionAssets.push({
      assetId: asset.id,
      type: asset.type,
      commonsId: asset.pexelsId,
      commonsUrl: buildCommonsAssetUrl(asset.url),
      creator,
      creatorUrl: asset.photographerUrl,
      license,
      licenseUrl: asset.licenseUrl,
      description: asset.description,
      creditLine: `${creator} — ${license}`
    })
  }

  return {
    source: {
      name: 'Wikimedia Commons',
      url: 'https://commons.wikimedia.org/',
      creditText: 'Media sourced from Wikimedia Commons. Each file has its own creator and license.'
    },
    usageNote:
      'Check each file page and its license before reuse. Attribution and license terms vary by file; this manifest records available creator and license metadata.',
    assets: attributionAssets
  }
}
