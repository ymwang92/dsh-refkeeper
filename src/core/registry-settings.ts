export const REGISTRY_IDS = [
  'crossref',
  'datacite',
  'openalex',
  'arxiv',
  'pubmed',
  'openlibrary',
] as const

export type RegistryId = (typeof REGISTRY_IDS)[number]

export type RegistryBaseUrls = Readonly<Record<RegistryId, string>>

export const DEFAULT_REGISTRY_BASE_URLS: RegistryBaseUrls = {
  crossref: 'https://api.crossref.org',
  datacite: 'https://api.datacite.org',
  openalex: 'https://api.openalex.org',
  arxiv: 'https://export.arxiv.org',
  pubmed: 'https://eutils.ncbi.nlm.nih.gov',
  openlibrary: 'https://openlibrary.org',
}

export interface RegistrySettings {
  readonly registryBaseUrls: RegistryBaseUrls
  readonly mailto: string
  readonly privateMode: boolean
}

export interface RegistrySettingsInput {
  readonly registryBaseUrls?: Readonly<Partial<Record<RegistryId, unknown>>>
  readonly mailto?: unknown
  readonly privateMode?: unknown
}

export interface NormalizedRegistrySettings {
  readonly settings: RegistrySettings
  readonly warnings: readonly string[]
  /** Overrides accepted from the saved/user-supplied input, excluding defaults. */
  readonly customRegistryIds: readonly RegistryId[]
}

function normalizeBaseUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '') return undefined
  try {
    const parsed = new URL(text)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    if (parsed.hostname === '' || parsed.username !== '' || parsed.password !== '') return undefined
    if (parsed.search !== '' || parsed.hash !== '') return undefined
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return undefined
  }
}

export function normalizeRegistrySettings(input: unknown): NormalizedRegistrySettings {
  const candidate = typeof input === 'object' && input !== null
    ? input as RegistrySettingsInput
    : {}
  const rawBases = typeof candidate.registryBaseUrls === 'object' && candidate.registryBaseUrls !== null
    ? candidate.registryBaseUrls
    : {}
  const warnings: string[] = []
  const customRegistryIds: RegistryId[] = []
  const registryBaseUrls = { ...DEFAULT_REGISTRY_BASE_URLS }

  for (const id of REGISTRY_IDS) {
    const rawValue = rawBases[id]
    if (rawValue === undefined || rawValue === null || rawValue === '') continue
    const normalized = normalizeBaseUrl(rawValue)
    if (normalized === undefined) {
      warnings.push(`invalid-registry-base-url:${id}`)
      continue
    }
    registryBaseUrls[id] = normalized
    if (normalized !== DEFAULT_REGISTRY_BASE_URLS[id]) customRegistryIds.push(id)
  }

  const mailto = typeof candidate.mailto === 'string' ? candidate.mailto.trim() : ''
  const privateMode = candidate.privateMode === true

  return {
    settings: { registryBaseUrls, mailto, privateMode },
    warnings,
    customRegistryIds,
  }
}

export function registrySettingsToInput(settings: RegistrySettings): RegistrySettingsInput {
  return {
    registryBaseUrls: settings.registryBaseUrls,
    mailto: settings.mailto,
    privateMode: settings.privateMode,
  }
}
