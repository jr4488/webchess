import * as hostedApi from './webchess-api'
import {
  HOSTED_WEBCHESS_PROVIDER,
  OPENCLAW_WEBCHESS_PROVIDER,
} from './hosted-provider'
import type { HostedProvider } from './hosted-provider'

type WebChessApiClient = Pick<
  typeof hostedApi,
  | 'abandonGame'
  | 'appendWilburObservation'
  | 'createWilburAction'
  | 'createIdempotencyKey'
  | 'divideProblem'
  | 'getCurrentGame'
  | 'getGameLifecycle'
  | 'getOwnedGame'
  | 'recoverDivisionIntent'
  | 'replayGame'
  | 'retryLifecycle'
  | 'runCharlotte'
  | 'runPortia'
  | 'requestGameAnswer'
  | 'startGame'
  | 'submitMove'
  | 'updateWilburAction'
>

export interface WebChessRuntime {
  kind: 'hosted' | 'openclaw'
  api: WebChessApiClient
  provider: Readonly<HostedProvider>
  signInPath: string | null
  restoreActionLabel: string
  restoreDescription: string
  footerAction: {
    href: string
    label: string
  } | null
}

export const HOSTED_WEBCHESS_RUNTIME: Readonly<WebChessRuntime> = Object.freeze({
  kind: 'hosted',
  api: hostedApi,
  provider: HOSTED_WEBCHESS_PROVIDER,
  signInPath: '/sign-in?return_url=%2Fplay',
  restoreActionLabel: 'Restore again',
  restoreDescription:
    'WebChess is replaying the durable move log before play continues.',
  footerAction: {
    href: '/account',
    label: 'Account and usage',
  },
})

export const OPENCLAW_WEBCHESS_RUNTIME: Readonly<WebChessRuntime> = Object.freeze({
  kind: 'openclaw',
  api: hostedApi,
  provider: OPENCLAW_WEBCHESS_PROVIDER,
  signInPath: null,
  restoreActionLabel: 'Check local setup again',
  restoreDescription:
    'WebChess is replaying the durable local move log before play continues.',
  footerAction: null,
})
