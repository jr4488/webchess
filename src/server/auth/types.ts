export type AuthSource = 'clerk' | 'local-e2e'

export interface AuthenticatedUser {
  userId: string
  source: AuthSource
}

export type RequestAuth =
  | {
      status: 'authenticated'
      user: AuthenticatedUser
    }
  | {
      status: 'signed-out'
    }
  | {
      status: 'unavailable'
    }
