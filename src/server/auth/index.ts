import 'server-only'

export { isClerkConfigured, isProtectedPagePath } from './config'
export { LOCAL_E2E_AUTH_HEADER, resolveLocalE2EUser } from './e2e'
export {
  LOCAL_HOSTED_SESSION_COOKIE,
  isLocalHostedSignInAvailable,
  resolveLocalHostedUser,
} from './local-session'
export {
  LOCAL_OPENCLAW_AUTH_HEADER,
  LOCAL_OPENCLAW_AUTH_VALUE,
  resolveLocalOpenClawUser,
} from './openclaw'
export { verifySameOriginMutation } from './origin'
export {
  authenticationUnavailableJson,
  forbiddenOriginJson,
  unauthorizedJson,
} from './responses'
export {
  buildSignInPath,
  buildSignUpPath,
  DEFAULT_RETURN_URL,
  sanitizeReturnUrl,
} from './return-url'
export {
  getAuthenticatedUser,
  getRequestAuth,
  requireApiUser,
  requirePageUser,
} from './session'
export type {
  AuthenticatedUser,
  AuthSource,
  RequestAuth,
} from './types'
