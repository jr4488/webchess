import { createHash } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP, type Socket } from 'node:net'
import { networkInterfaces } from 'node:os'

import type {
  ResearchFetchFailure,
  ResearchRetrievedFact,
  ResearchSource,
} from '../../lib/research'
import {
  RESEARCH_PAGE_FETCH_CHARACTER_LIMIT,
} from '../../lib/research'

export const DIRECT_PAGE_FETCH_VERSION =
  'webchess-direct-page-fetch-v1' as const
export const DIRECT_PAGE_EXTRACTOR_VERSION =
  'webchess-readable-text-v1' as const
export const DIRECT_PAGE_DIGEST_ALGORITHM =
  'sha256-utf8-accepted-text-v1' as const
export const DIRECT_PAGE_RAW_DIGEST_ALGORITHM =
  'sha256-raw-response-bytes-v1' as const
export const DIRECT_PAGE_FETCH_TIMEOUT_MS = 20_000
export const DIRECT_PAGE_MAX_REDIRECTS = 3
export const DIRECT_PAGE_MAX_RAW_BYTES = 1_048_576
export const DIRECT_PAGE_REQUEST_HEADERS = Object.freeze({
  accept: 'text/html, application/xhtml+xml, text/plain;q=0.9',
  'accept-encoding': 'identity',
  connection: 'close',
  'user-agent': 'WebChess-Research/2.2 (+local bounded fetch)',
} as const)

type AllowedContentType = ResearchRetrievedFact['contentType']

const ALLOWED_CONTENT_TYPES = new Set<AllowedContentType>([
  'application/xhtml+xml',
  'text/html',
  'text/plain',
])

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

const INJECTION_PATTERNS = [
  {
    code: 'instruction_override_language',
    pattern:
      /\b(?:disregard|forget|ignore|override)\b.{0,100}\b(?:instruction|prompt|rule|system|developer)\b/iu,
  },
  {
    code: 'role_impersonation_language',
    pattern:
      /\b(?:assistant|developer|system|tool)\s*(?:message|prompt|role)?\s*:/iu,
  },
  {
    code: 'model_control_token',
    pattern: /<\|(?:assistant|developer|end|system|tool)[^>]*\|>/iu,
  },
  {
    code: 'prompt_injection_language',
    pattern:
      /\b(?:prompt\s+injection|hidden\s+instruction|jailbreak|do\s+not\s+trust\s+the\s+previous)\b/iu,
  },
] as const

export interface ResolvedAddress {
  readonly address: string
  readonly family: 4 | 6
}

export interface RawPageResponse {
  readonly body: Uint8Array
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
  readonly rawHeaders: readonly string[]
  readonly remoteAddress: string
  readonly status: number
}

export interface DirectPageFetchDependencies {
  readonly localAddresses: () => readonly string[]
  readonly lookup: (
    hostname: string,
    signal: AbortSignal,
  ) => Promise<readonly ResolvedAddress[]>
  readonly now: () => number
  readonly request: (input: {
    readonly address: ResolvedAddress
    readonly signal: AbortSignal
    readonly timeoutMs: number
    readonly url: URL
  }) => Promise<RawPageResponse>
}

export interface DirectPageFetchResult {
  readonly fact: ResearchRetrievedFact
  readonly injectionSignalsDetected: readonly string[]
}

interface FetchFailureDetails {
  readonly acceptedCharacterLength?: number
  readonly finalUrl?: string | null
  readonly httpStatus?: number | null
  readonly injectionSignalsDetected?: readonly string[]
  readonly rawByteLength?: number
  readonly rawContentDigest?: string | null
  readonly redirectChain?: readonly string[]
  readonly truncated?: boolean
}

export class DirectPageFetchError extends Error {
  readonly failureCode: string
  readonly status: ResearchFetchFailure['status']
  readonly details: FetchFailureDetails

  constructor(
    failureCode: string,
    status: ResearchFetchFailure['status'],
    details: FetchFailureDetails = {},
  ) {
    super(failureCode)
    this.name = 'DirectPageFetchError'
    this.failureCode = failureCode
    this.status = status
    this.details = details
  }
}

function ipv4Number(address: string): number | null {
  if (isIP(address) !== 4) return null
  const parts = address.split('.').map(Number)
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null
  }
  return parts.reduce((value, part) => value * 256 + part, 0) >>> 0
}

function ipv4InCidr(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (value & mask) === (base & mask)
}

function isGlobalIpv4(address: string): boolean {
  const value = ipv4Number(address)
  if (value === null) return false
  const blocked: readonly [number, number][] = [
    [0x00000000, 8],
    [0x0a000000, 8],
    [0x64400000, 10],
    [0x7f000000, 8],
    [0xa9fe0000, 16],
    [0xac100000, 12],
    [0xc0000000, 24],
    [0xc0000200, 24],
    [0xc01fc400, 24],
    [0xc034c100, 24],
    [0xc0586300, 24],
    [0xc0a80000, 16],
    [0xc0af3000, 24],
    [0xc6120000, 15],
    [0xc6336400, 24],
    [0xcb007100, 24],
    [0xe0000000, 3],
  ]
  return !blocked.some(([base, prefix]) => ipv4InCidr(value, base, prefix))
}

function ipv6Value(address: string): bigint | null {
  const withoutZone = address.toLowerCase().split('%', 1)[0] ?? ''
  if (isIP(withoutZone) !== 6) return null

  const embeddedIpv4 = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(withoutZone)?.[1]
  let normalized = withoutZone
  if (embeddedIpv4) {
    const value = ipv4Number(embeddedIpv4)
    if (value === null) return null
    normalized = withoutZone.slice(0, -embeddedIpv4.length) +
      `${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`
  }

  const halves = normalized.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null
  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ]
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))
  ) {
    return null
  }
  return groups.reduce(
    (value, group) => (value << 16n) | BigInt(`0x${group}`),
    0n,
  )
}

function ipv6InCidr(value: bigint, base: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix)
  return (value >> shift) === (base >> shift)
}

function ipv6Literal(value: string): bigint {
  const parsed = ipv6Value(value)
  if (parsed === null) throw new Error(`Invalid constant IPv6 address: ${value}`)
  return parsed
}

const IPV6_GLOBAL_BASE = ipv6Literal('2000::')
const IPV6_SPECIAL_RANGES: readonly [bigint, number][] = [
  [ipv6Literal('64:ff9b::'), 96],
  [ipv6Literal('64:ff9b:1::'), 48],
  [ipv6Literal('100::'), 64],
  [ipv6Literal('100:0:0:1::'), 64],
  [ipv6Literal('2001::'), 23],
  [ipv6Literal('2001:db8::'), 32],
  [ipv6Literal('2002::'), 16],
  [ipv6Literal('2620:4f:8000::'), 48],
  [ipv6Literal('3fff::'), 20],
  [ipv6Literal('5f00::'), 16],
]

function isGlobalIpv6(address: string): boolean {
  const value = ipv6Value(address)
  if (value === null) return false
  // Reject every IPv4-mapped address. It is safer than trying to preserve a
  // second representation of an address already covered by A records.
  if (ipv6InCidr(value, 0xffffn << 32n, 96)) return false
  if (!ipv6InCidr(value, IPV6_GLOBAL_BASE, 3)) return false
  return !IPV6_SPECIAL_RANGES.some(([base, prefix]) =>
    ipv6InCidr(value, base, prefix))
}

export function isGlobalUnicastAddress(address: ResolvedAddress): boolean {
  return address.family === 4
    ? isGlobalIpv4(address.address)
    : address.family === 6 && isGlobalIpv6(address.address)
}

function sameAddress(left: string, right: string): boolean {
  const leftFamily = isIP(left)
  const rightFamily = isIP(right)
  if (leftFamily !== rightFamily) return false
  if (leftFamily === 4) return ipv4Number(left) === ipv4Number(right)
  if (leftFamily === 6) return ipv6Value(left) === ipv6Value(right)
  return false
}

const SPECIAL_HOST_SUFFIXES = [
  '.example',
  '.home',
  '.internal',
  '.invalid',
  '.lan',
  '.local',
  '.localhost',
  '.onion',
  '.test',
] as const

export function normalizePublicHttpsUrl(value: string): URL | null {
  if (value.length < 12 || value.length > 2_048) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '')
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    (parsed.port !== '' && parsed.port !== '443') ||
    hostname.length < 4 ||
    hostname.length > 253 ||
    !hostname.includes('.') ||
    isIP(hostname.replace(/^\[|\]$/gu, '')) !== 0 ||
    hostname === 'localhost' ||
    SPECIAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return null
  }
  parsed.hostname = hostname
  parsed.hash = ''
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(?:fbclid|gclid|mc_[a-z]+|utm_[a-z]+)$/iu.test(key)) {
      parsed.searchParams.delete(key)
    }
  }
  if (`${parsed.pathname}${parsed.search}`.length > 2_000) return null
  return parsed
}

function responseHeaderValues(
  response: RawPageResponse,
  name: string,
): readonly string[] {
  const values: string[] = []
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    if (response.rawHeaders[index]?.toLowerCase() === name) {
      values.push(response.rawHeaders[index + 1] ?? '')
    }
  }
  if (values.length > 0) return values
  const fallback = response.headers[name]
  if (Array.isArray(fallback)) return fallback
  return typeof fallback === 'string' ? [fallback] : []
}

function singleResponseHeader(
  response: RawPageResponse,
  name: string,
  required = false,
): string | null {
  const values = responseHeaderValues(response, name)
  if (values.length === 0 && !required) return null
  if (values.length !== 1 || !values[0]?.trim()) {
    throw new DirectPageFetchError(
      `page_fetch_${name.replaceAll('-', '_')}_refused`,
      'refused',
      {
        httpStatus: response.status,
        rawByteLength: response.body.byteLength,
      },
    )
  }
  return values[0].trim()
}

function decodeEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }
  return value.replace(
    /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/giu,
    (entity, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
      const codePoint = decimal
        ? Number.parseInt(decimal, 10)
        : hex
          ? Number.parseInt(hex, 16)
          : null
      if (codePoint !== null) {
        if (
          !Number.isSafeInteger(codePoint) ||
          codePoint < 9 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return ' '
        }
        return String.fromCodePoint(codePoint)
      }
      return name ? named[name.toLowerCase()] ?? entity : entity
    },
  )
}

const INERT_HTML_ELEMENTS = new Set([
  'embed',
  'form',
  'head',
  'iframe',
  'noscript',
  'object',
  'script',
  'style',
  'svg',
  'template',
  'textarea',
])

const HTML_BLOCK_ELEMENTS = new Set([
  'article',
  'br',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'main',
  'p',
  'section',
  'tr',
])

function tagEnd(body: string, start: number): number {
  let quote: '"' | "'" | null = null
  for (let index = start; index < body.length; index += 1) {
    const character = body[index]
    if (quote) {
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '>') return index
  }
  return -1
}

/**
 * A deliberately non-rendering HTML tokenizer. It never evaluates script,
 * resolves entities beyond a small built-in set, loads subresources, follows
 * meta refresh, or processes DTD/external entities.
 */
function extractVisibleHtml(body: string): { text: string; title: string | null } {
  const output: string[] = []
  const titleOutput: string[] = []
  const inertStack: string[] = []
  let inTitle = false
  let index = 0
  while (index < body.length) {
    if (body.startsWith('<!--', index)) {
      const end = body.indexOf('-->', index + 4)
      if (end < 0) break
      index = end + 3
      continue
    }
    if (body[index] !== '<') {
      const next = body.indexOf('<', index)
      const text = body.slice(index, next < 0 ? body.length : next)
      if (inTitle) titleOutput.push(text)
      if (inertStack.length === 0) output.push(text)
      index = next < 0 ? body.length : next
      continue
    }
    const end = tagEnd(body, index + 1)
    if (end < 0) break
    const raw = body.slice(index + 1, end).trim()
    const closing = raw.startsWith('/')
    const name = /^\/?\s*([a-z][a-z0-9:-]*)/iu.exec(raw)?.[1]?.toLowerCase() ?? ''
    if (name === 'title') inTitle = !closing
    if (INERT_HTML_ELEMENTS.has(name)) {
      if (closing) {
        const last = inertStack.lastIndexOf(name)
        if (last >= 0) inertStack.splice(last, 1)
      } else if (!raw.endsWith('/')) {
        inertStack.push(name)
      }
    }
    if (inertStack.length === 0 && HTML_BLOCK_ELEMENTS.has(name)) {
      output.push('\n')
    }
    index = end + 1
  }
  return {
    text: decodeEntities(output.join('')),
    title: titleOutput.length > 0
      ? decodeEntities(titleOutput.join(''))
      : null,
  }
}

function readableText(body: string, contentType: string): {
  readonly text: string
  readonly title: string | null
} {
  if (contentType === 'text/plain') {
    return { text: body, title: null }
  }
  return extractVisibleHtml(body)
}

function normalizedExternalText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0)
      return code <= 8 || code === 11 || code === 12 ||
        (code >= 14 && code <= 31) || code === 127
        ? ' '
        : character
    })
    .join('')
}

function injectionSignals(value: string): readonly string[] {
  const signals = new Set<string>()
  if (/[\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    signals.add('bidirectional_control_character')
  }
  const normalized = normalizedExternalText(value).replace(/\s+/gu, ' ')
  for (const candidate of INJECTION_PATTERNS) {
    if (candidate.pattern.test(normalized)) signals.add(candidate.code)
  }
  return [...signals]
}

function cleanExternalText(value: string, title: string | null): {
  readonly signals: readonly string[]
  readonly text: string
  readonly truncated: boolean
} {
  const signals = injectionSignals(`${title ?? ''}\n${value}`)
  if (signals.length > 0) {
    throw new DirectPageFetchError(
      'page_fetch_injection_refused',
      'refused',
      { injectionSignalsDetected: signals },
    )
  }
  const acceptedLines: string[] = []
  for (const line of normalizedExternalText(value).split(/\r?\n/u)) {
    const normalized = line
      .replace(/[ \t]+/gu, ' ')
      .trim()
    if (!normalized) continue
    acceptedLines.push(normalized)
  }
  const cleaned = acceptedLines.join('\n').replace(/\n{3,}/gu, '\n\n').trim()
  if (cleaned.length === 0) {
    throw new DirectPageFetchError(
      'page_fetch_content_refused',
      'refused',
    )
  }
  const truncated = cleaned.length > RESEARCH_PAGE_FETCH_CHARACTER_LIMIT
  const text = cleaned.slice(0, RESEARCH_PAGE_FETCH_CHARACTER_LIMIT).trim()
  if (text.length === 0) {
    throw new DirectPageFetchError(
      'page_fetch_content_refused',
      'refused',
    )
  }
  return { signals, text, truncated }
}

function canonicalTitle(value: string | null, fallback: string): string {
  const title = normalizedExternalText(value ?? '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500)
  return title || normalizedExternalText(fallback)
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500)
}

function acceptedTextDigest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function defaultLookup(
  hostname: string,
  signal: AbortSignal,
): Promise<readonly ResolvedAddress[]> {
  signal.throwIfAborted()
  const result = await dnsLookup(hostname, { all: true, verbatim: true })
  signal.throwIfAborted()
  return result.flatMap((item) =>
    item.family === 4 || item.family === 6
      ? [{ address: item.address, family: item.family }]
      : [])
}

function defaultLocalAddresses(): readonly string[] {
  return Object.values(networkInterfaces()).flatMap((entries) =>
    (entries ?? []).map((entry) => entry.address))
}

function defaultRequest(input: {
  readonly address: ResolvedAddress
  readonly signal: AbortSignal
  readonly timeoutMs: number
  readonly url: URL
}): Promise<RawPageResponse> {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const request = httpsRequest(input.url, {
      agent: false,
      family: input.address.family,
      // Node's native HTTPS client does not consume HTTP(S)_PROXY. A fresh
      // agent plus this fixed allowlist prevents cookies, auth, referrers, or
      // ambient proxy configuration from entering the request.
      headers: DIRECT_PAGE_REQUEST_HEADERS,
      insecureHTTPParser: false,
      lookup: (_hostname, _options, callback) => {
        callback(null, input.address.address, input.address.family)
      },
      maxHeaderSize: 16 * 1024,
      method: 'GET',
      rejectUnauthorized: true,
      servername: input.url.hostname,
      setHost: true,
      signal: input.signal,
    }, (response) => {
      const remoteAddress = response.socket.remoteAddress ?? ''
      if (!sameAddress(remoteAddress, input.address.address)) {
        request.destroy(new DirectPageFetchError(
          'page_fetch_address_mismatch',
          'refused',
        ))
        return
      }
      const baseResponse = {
        body: new Uint8Array(),
        headers: response.headers,
        rawHeaders: response.rawHeaders,
        remoteAddress,
        status: response.statusCode ?? 0,
      } satisfies RawPageResponse
      if (
        REDIRECT_STATUSES.has(baseResponse.status) ||
        baseResponse.status !== 200
      ) {
        settled = true
        resolve(baseResponse)
        response.destroy()
        return
      }
      try {
        const declaredLength = singleResponseHeader(
          baseResponse,
          'content-length',
        )
        if (
          declaredLength &&
          (
            !/^\d+$/u.test(declaredLength) ||
            Number(declaredLength) > DIRECT_PAGE_MAX_RAW_BYTES
          )
        ) {
          throw new DirectPageFetchError(
            'page_fetch_response_too_large',
            'refused',
          )
        }
        singleResponseHeader(baseResponse, 'content-type', true)
        singleResponseHeader(baseResponse, 'content-encoding')
      } catch (error) {
        request.destroy(error instanceof Error ? error : new Error('header refused'))
        return
      }
      const chunks: Buffer[] = []
      let byteLength = 0
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        byteLength += buffer.byteLength
        if (byteLength > DIRECT_PAGE_MAX_RAW_BYTES) {
          request.destroy(new DirectPageFetchError(
            'page_fetch_response_too_large',
            'refused',
            { rawByteLength: byteLength },
          ))
          return
        }
        chunks.push(buffer)
      })
      response.once('error', fail)
      response.once('end', () => {
        if (settled) return
        settled = true
        resolve({
          body: Buffer.concat(chunks),
          headers: response.headers,
          rawHeaders: response.rawHeaders,
          remoteAddress,
          status: response.statusCode ?? 0,
        })
      })
    })
    request.once('socket', (socket: Socket) => {
      socket.once('secureConnect', () => {
        const remoteAddress = socket.remoteAddress ?? ''
        if (!sameAddress(remoteAddress, input.address.address)) {
          request.destroy(new DirectPageFetchError(
            'page_fetch_address_mismatch',
            'refused',
          ))
        }
      })
    })
    request.setTimeout(input.timeoutMs, () => {
      request.destroy(new DirectPageFetchError(
        'page_fetch_timeout',
        'timed_out',
      ))
    })
    request.once('error', fail)
    request.end()
  })
}

const DEFAULT_DEPENDENCIES: DirectPageFetchDependencies = {
  localAddresses: defaultLocalAddresses,
  lookup: defaultLookup,
  now: Date.now,
  request: defaultRequest,
}

async function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new DirectPageFetchError(
      'page_fetch_timeout', 'timed_out'))
    if (signal.aborted) {
      aborted()
      return
    }
    signal.addEventListener('abort', aborted, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', aborted)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', aborted)
        reject(error)
      },
    )
  })
}

function failureWithUrl(
  error: unknown,
  requestedUrl: string,
  finalUrl: string | null,
): DirectPageFetchError {
  if (error instanceof DirectPageFetchError) {
    return new DirectPageFetchError(error.failureCode, error.status, {
      ...error.details,
      finalUrl: error.details.finalUrl ?? finalUrl,
    })
  }
  if (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return new DirectPageFetchError(
      'page_fetch_timeout',
      'timed_out',
      { finalUrl: finalUrl ?? requestedUrl },
    )
  }
  return new DirectPageFetchError(
    'page_fetch_failed',
    'failed',
    { finalUrl: finalUrl ?? requestedUrl },
  )
}

function fetchFailure(
  source: Omit<ResearchSource, 'id' | 'createdAt'>,
  error: DirectPageFetchError,
  retrievedAt: string,
): ResearchFetchFailure {
  return {
    citationId: source.citationId,
    requestedUrl: source.url,
    finalUrl: error.details.finalUrl ?? null,
    status: error.status,
    failureCode: error.failureCode,
    httpStatus: error.details.httpStatus ?? null,
    fetchVersion: DIRECT_PAGE_FETCH_VERSION,
    extractor: DIRECT_PAGE_EXTRACTOR_VERSION,
    rawByteLength: error.details.rawByteLength ?? 0,
    rawContentDigest: error.details.rawContentDigest ?? null,
    rawDigestAlgorithm: DIRECT_PAGE_RAW_DIGEST_ALGORITHM,
    acceptedCharacterLength: error.details.acceptedCharacterLength ?? 0,
    truncated: error.details.truncated ?? false,
    contentDigest: null,
    digestAlgorithm: DIRECT_PAGE_DIGEST_ALGORITHM,
    redirectChain: error.details.redirectChain ?? [source.url],
    injectionSignalsDetected: (
      error.details.injectionSignalsDetected ?? []
    ).map((signal) => `fetch_${source.citationId.toLowerCase()}_${signal}`),
    retrievedAt,
  }
}

export class SecureDirectPageFetcher {
  constructor(
    private readonly dependencies: DirectPageFetchDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  async fetch(
    source: Omit<ResearchSource, 'id' | 'createdAt'>,
    timeoutMs = DIRECT_PAGE_FETCH_TIMEOUT_MS,
  ): Promise<DirectPageFetchResult> {
    const requested = normalizePublicHttpsUrl(source.url)
    const retrievedAt = new Date(this.dependencies.now()).toISOString()
    if (!requested || requested.toString() !== source.url) {
      throw fetchFailure(source, new DirectPageFetchError(
        'page_fetch_url_refused',
        'refused',
      ), retrievedAt)
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DIRECT_PAGE_FETCH_TIMEOUT_MS) {
      throw fetchFailure(source, new DirectPageFetchError(
        'page_fetch_timeout_invalid',
        'refused',
      ), retrievedAt)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const deadline = this.dependencies.now() + timeoutMs
    let current = requested
    let redirectCount = 0
    let lastRawLength = 0
    let lastRawDigest: string | null = null
    const redirectChain = [requested.toString()]
    const visited = new Set(redirectChain)
    const localAddresses = this.dependencies.localAddresses()

    try {
      while (true) {
        const remainingBeforeDns = deadline - this.dependencies.now()
        if (remainingBeforeDns <= 0) {
          throw new DirectPageFetchError('page_fetch_timeout', 'timed_out', {
            finalUrl: current.toString(),
            rawByteLength: lastRawLength,
            rawContentDigest: lastRawDigest,
          })
        }
        const addresses = await abortable(
          this.dependencies.lookup(current.hostname, controller.signal),
          controller.signal,
        )
        if (
          addresses.length === 0 ||
          addresses.length > 16 ||
          addresses.some((address) =>
            !isGlobalUnicastAddress(address) ||
            localAddresses.some((local) => sameAddress(address.address, local)))
        ) {
          throw new DirectPageFetchError(
            'page_fetch_address_refused',
            'refused',
            {
              finalUrl: current.toString(),
              rawByteLength: lastRawLength,
              rawContentDigest: lastRawDigest,
            },
          )
        }
        const pinned = [...addresses].sort((left, right) =>
          left.family - right.family || left.address.localeCompare(right.address))[0]!
        const remainingBeforeRequest = deadline - this.dependencies.now()
        if (remainingBeforeRequest <= 0) {
          throw new DirectPageFetchError('page_fetch_timeout', 'timed_out', {
            finalUrl: current.toString(),
            rawByteLength: lastRawLength,
            rawContentDigest: lastRawDigest,
          })
        }
        const response = await abortable(
          this.dependencies.request({
            address: pinned,
            signal: controller.signal,
            timeoutMs: remainingBeforeRequest,
            url: current,
          }),
          controller.signal,
        )
        if (!sameAddress(response.remoteAddress, pinned.address)) {
          throw new DirectPageFetchError(
            'page_fetch_address_mismatch',
            'refused',
            { finalUrl: current.toString(), rawByteLength: response.body.byteLength },
          )
        }
        lastRawLength = response.body.byteLength
        lastRawDigest = createHash('sha256')
          .update(response.body)
          .digest('hex')
        if (lastRawLength > DIRECT_PAGE_MAX_RAW_BYTES) {
          throw new DirectPageFetchError(
            'page_fetch_response_too_large',
            'refused',
            { finalUrl: current.toString(), rawByteLength: lastRawLength },
          )
        }

        if (REDIRECT_STATUSES.has(response.status)) {
          const location = singleResponseHeader(response, 'location', true)
          if (!location || redirectCount >= DIRECT_PAGE_MAX_REDIRECTS) {
            throw new DirectPageFetchError(
              'page_fetch_redirect_refused',
              'refused',
              {
                finalUrl: current.toString(),
                httpStatus: response.status,
                rawByteLength: lastRawLength,
                rawContentDigest: lastRawDigest,
              },
            )
          }
          const next = normalizePublicHttpsUrl(new URL(location, current).toString())
          if (!next || next.hostname !== requested.hostname) {
            throw new DirectPageFetchError(
              'page_fetch_redirect_host_refused',
              'refused',
              {
                // The cross-host target was never contacted; finalUrl remains
                // the last response WebChess actually received.
                finalUrl: current.toString(),
                httpStatus: response.status,
                rawByteLength: lastRawLength,
                rawContentDigest: lastRawDigest,
              },
            )
          }
          if (visited.has(next.toString())) {
            throw new DirectPageFetchError(
              'page_fetch_redirect_cycle_refused',
              'refused',
              {
                finalUrl: current.toString(),
                httpStatus: response.status,
                rawByteLength: lastRawLength,
                rawContentDigest: lastRawDigest,
              },
            )
          }
          current = next
          redirectChain.push(next.toString())
          visited.add(next.toString())
          redirectCount += 1
          continue
        }

        if (response.status !== 200) {
          throw new DirectPageFetchError('page_fetch_http_status', 'failed', {
            finalUrl: current.toString(),
            httpStatus: response.status,
            rawByteLength: lastRawLength,
            rawContentDigest: lastRawDigest,
          })
        }
        const contentEncoding = singleResponseHeader(
          response,
          'content-encoding',
        )
        if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
          throw new DirectPageFetchError(
            'page_fetch_content_encoding_refused',
            'refused',
            {
              finalUrl: current.toString(),
              httpStatus: response.status,
              rawByteLength: lastRawLength,
              rawContentDigest: lastRawDigest,
            },
          )
        }
        const declaredLength = singleResponseHeader(response, 'content-length')
        if (
          declaredLength &&
          (/^\d+$/u.test(declaredLength) === false || Number(declaredLength) > DIRECT_PAGE_MAX_RAW_BYTES)
        ) {
          throw new DirectPageFetchError(
            'page_fetch_response_too_large',
            'refused',
            {
              finalUrl: current.toString(),
              httpStatus: response.status,
              rawByteLength: lastRawLength,
              rawContentDigest: lastRawDigest,
            },
          )
        }
        const contentTypeHeader = singleResponseHeader(
          response,
          'content-type',
          true,
        ) ?? ''
        const [contentType, ...parameters] = contentTypeHeader
          .toLowerCase()
          .split(';')
          .map((part) => part.trim())
        if (
          !contentType ||
          !ALLOWED_CONTENT_TYPES.has(contentType as AllowedContentType)
        ) {
          throw new DirectPageFetchError(
            'page_fetch_content_type_refused',
            'refused',
            {
              finalUrl: current.toString(),
              httpStatus: response.status,
              rawByteLength: lastRawLength,
              rawContentDigest: lastRawDigest,
            },
          )
        }
        const charsets = parameters.flatMap((parameter) => {
          const charset = /^charset=(.+)$/u.exec(parameter)?.[1]
            ?.replace(/^"|"$/gu, '')
          return charset ? [charset] : []
        })
        if (charsets.length > 1) {
          throw new DirectPageFetchError(
            'page_fetch_charset_refused',
            'refused',
            {
              finalUrl: current.toString(),
              httpStatus: response.status,
              rawByteLength: lastRawLength,
              rawContentDigest: lastRawDigest,
            },
          )
        }
        const charset = charsets[0]
        if (charset && !['ascii', 'us-ascii', 'utf-8', 'utf8'].includes(charset)) {
          throw new DirectPageFetchError(
            'page_fetch_charset_refused',
            'refused',
            {
              finalUrl: current.toString(),
              httpStatus: response.status,
              rawByteLength: lastRawLength,
              rawContentDigest: lastRawDigest,
            },
          )
        }
        let decoded: string
        try {
          decoded = new TextDecoder('utf-8', { fatal: true }).decode(response.body)
        } catch {
          throw new DirectPageFetchError(
            'page_fetch_utf8_refused',
            'refused',
            {
              finalUrl: current.toString(),
              httpStatus: response.status,
              rawByteLength: lastRawLength,
              rawContentDigest: lastRawDigest,
            },
          )
        }
        const acceptedContentType = contentType as AllowedContentType
        const extracted = readableText(decoded, acceptedContentType)
        const cleaned = cleanExternalText(extracted.text, extracted.title)
        const contentDigest = acceptedTextDigest(cleaned.text)
        return {
          fact: {
            citationId: source.citationId,
            requestedUrl: source.url,
            finalUrl: current.toString(),
            title: canonicalTitle(extracted.title, source.title),
            provider: 'webchess-direct-https',
            fetchVersion: DIRECT_PAGE_FETCH_VERSION,
            retrievedAt,
            httpStatus: response.status,
            contentType: acceptedContentType,
            extractor: DIRECT_PAGE_EXTRACTOR_VERSION,
            rawByteLength: lastRawLength,
            rawContentDigest: lastRawDigest,
            rawDigestAlgorithm: DIRECT_PAGE_RAW_DIGEST_ALGORITHM,
            acceptedCharacterLength: cleaned.text.length,
            contentDigest,
            digestAlgorithm: DIRECT_PAGE_DIGEST_ALGORITHM,
            redirectChain,
            text: cleaned.text,
            truncated: cleaned.truncated,
            untrusted: true,
            contentKind: 'direct_page_text',
          },
          injectionSignalsDetected: cleaned.signals.map(
            (signal) => `fetch_${source.citationId.toLowerCase()}_${signal}`,
          ),
        }
      }
    } catch (error) {
      const normalized = failureWithUrl(
        error,
        source.url,
        current.toString(),
      )
      throw fetchFailure(source, new DirectPageFetchError(
        normalized.failureCode,
        normalized.status,
        {
          rawByteLength: lastRawLength,
          rawContentDigest: lastRawDigest,
          ...normalized.details,
          redirectChain,
        },
      ), retrievedAt)
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function isResearchFetchFailure(value: unknown): value is ResearchFetchFailure {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'failureCode' in value &&
    'requestedUrl' in value,
  )
}
