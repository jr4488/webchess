const jsonHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
} as const

export function unauthorizedJson(): Response {
  return Response.json(
    {
      error: {
        code: 'authentication_required',
        message: 'Sign in to continue.',
      },
    },
    {
      status: 401,
      headers: jsonHeaders,
    },
  )
}
export function authenticationUnavailableJson(): Response {
  return Response.json(
    {
      error: {
        code: 'authentication_unavailable',
        message: 'Authentication is not configured in this environment.',
      },
    },
    {
      status: 503,
      headers: jsonHeaders,
    },
  )
}

export function forbiddenOriginJson(): Response {
  return Response.json(
    {
      error: {
        code: 'cross_origin_request',
        message: 'This mutation must come from the WebChess origin.',
      },
    },
    {
      status: 403,
      headers: jsonHeaders,
    },
  )
}
