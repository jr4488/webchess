import { isIP } from 'node:net'

/**
 * Decide whether a host string refers to this machine.
 *
 * Local-only providers gate on this, so it must stay in one place: divergent
 * copies previously disagreed about non-string input. Bracketed IPv6 literals,
 * IPv4-mapped IPv6, and the whole 127.0.0.0/8 range all count as loopback.
 */
export function isLoopbackHost(value) {
  if (typeof value !== 'string') return false

  let host = value.trim().toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1)
  }
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') {
    return true
  }
  if (host.startsWith('::ffff:')) {
    host = host.slice('::ffff:'.length)
  }
  return isIP(host) === 4 && host.split('.')[0] === '127'
}
