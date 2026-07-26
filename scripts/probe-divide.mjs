/**
 * Development probe: authenticate, call /api/divide, and summarise the NDJSON
 * activity frames the server sends back. Not part of the build or test suite.
 */
import { readFileSync } from 'node:fs'

const BASE = process.env.PROBE_BASE ?? 'http://127.0.0.1:5174'
const PROBLEM = process.argv[2]
  ?? 'Should we move our small consultancy to a four day work week next quarter?'

const accessCode = readFileSync('.env', 'utf8')
  .split('\n')
  .find((line) => line.startsWith('WEBCHESS_ACCESS_CODE='))
  ?.slice('WEBCHESS_ACCESS_CODE='.length)
  .trim()

const login = await fetch(`${BASE}/api/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ accessCode }),
})
const session = await login.json()
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
console.log('session:', login.status, session.provider?.id, session.provider?.model)

const response = await fetch(`${BASE}/api/divide`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/x-ndjson, application/json',
    Origin: BASE,
    Cookie: cookie,
    'X-WebChess-CSRF': session.csrfToken,
  },
  body: JSON.stringify({ problem: PROBLEM }),
})
console.log('divide:', response.status, response.headers.get('content-type'))

const counts = new Map()
let reasoningChars = 0
let firstReasoning = ''
let buffer = ''
for await (const chunk of response.body) {
  buffer += new TextDecoder().decode(chunk, { stream: true })
  const lines = buffer.split('\n')
  buffer = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.trim()) continue
    const event = JSON.parse(line)
    const key = event.type === 'phase' ? `phase:${event.phase}` : event.type
    counts.set(key, (counts.get(key) ?? 0) + 1)
    if (event.type === 'reasoning') {
      reasoningChars += event.text.length
      if (!firstReasoning) firstReasoning = `[${event.source}] ${event.text.slice(0, 120)}`
    }
  }
}

console.log('--- frames ---')
for (const [type, n] of counts) console.log(String(n).padStart(4), type)
console.log('--- reasoning chars:', reasoningChars)
if (firstReasoning) console.log(firstReasoning)
