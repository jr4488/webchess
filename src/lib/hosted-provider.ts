export interface HostedProvider {
  label: string
  model: string
  dataControlsUrl: string
}

/**
 * Public provenance shown beside model-backed work.
 *
 * The model and provider are fixed by the server deployment. They are never
 * accepted from a browser request, and visitors never supply provider keys.
 */
export const HOSTED_WEBCHESS_PROVIDER: Readonly<HostedProvider> = Object.freeze({
  label: 'OpenAI API',
  dataControlsUrl: 'https://developers.openai.com/api/docs/guides/your-data',
  model: 'gpt-5.6-sol',
})
