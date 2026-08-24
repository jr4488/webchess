export const WEBCHESS_CASE_BUNDLE_FORMAT = 'webchess-case-bundle/1' as const

export const WEBCHESS_CASE_REDACTION_POLICY =
  'webchess-case-redaction-policy/1' as const

export const WEBCHESS_CASE_CANONICALIZATION =
  'webchess-canonical-json/1' as const

export const WEBCHESS_CASE_PROFILES = [
  'private-full-v1',
  'research-redacted-v1',
  'metadata-only-v1',
] as const

export type WebChessCaseProfile = (typeof WEBCHESS_CASE_PROFILES)[number]

export interface WebChessCaseDownload {
  readonly blob: Blob
  readonly fileName: string
}

export function isWebChessCaseProfile(
  value: unknown,
): value is WebChessCaseProfile {
  return typeof value === 'string' && (
    WEBCHESS_CASE_PROFILES as readonly string[]
  ).includes(value)
}
