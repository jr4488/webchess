export type WebChessProviderKind = 'hosted' | 'openclaw'

export interface HostedProvider {
  /**
   * Older component fixtures omit this field, so hosted remains the default.
   */
  kind?: WebChessProviderKind
  label: string
  model: string
  dataControlsUrl: string
  dataControlsLabel?: string
}

/**
 * Public provenance shown beside model-backed work.
 *
 * The model and provider are fixed by the server deployment. They are never
 * accepted from a browser request, and visitors never supply provider keys.
 */
export const HOSTED_WEBCHESS_PROVIDER: Readonly<HostedProvider> = Object.freeze({
  kind: 'hosted',
  label: 'OpenAI API',
  dataControlsUrl: 'https://developers.openai.com/api/docs/guides/your-data',
  dataControlsLabel: 'OpenAI Platform data controls',
  model: 'gpt-5.6-sol',
})

/**
 * The launcher requires an OpenAI account/OAuth model selected in OpenClaw and
 * returns the exact model attribution after each successful request.
 */
export const OPENCLAW_WEBCHESS_PROVIDER: Readonly<HostedProvider> = Object.freeze({
  kind: 'openclaw',
  label: 'your local OpenClaw',
  dataControlsUrl: 'https://docs.openclaw.ai/cli/infer',
  dataControlsLabel: 'How OpenClaw runs model requests',
  model: 'your selected OpenAI account model',
})
