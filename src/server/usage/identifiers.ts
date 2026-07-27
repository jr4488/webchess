import { hashRateLimitKey, hmacSha256Hex } from '../db/hash'

export function hashDeletedUserKey(secret: string, userId: string): string {
  return hmacSha256Hex(secret, 'webchess-deleted-user-v1', userId)
}

export function hashUserRateKey(secret: string, userId: string): string {
  return hashRateLimitKey(secret, 'user', userId)
}

export function hashIpRateKey(secret: string, ipAddress: string): string {
  return hashRateLimitKey(secret, 'ip', ipAddress.trim().toLowerCase())
}
