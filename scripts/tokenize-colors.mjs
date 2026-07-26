/**
 * One-shot migration: replace literal colours in styles.css with design tokens.
 *
 * The stylesheet hard-coded the same handful of hues 148 different ways, which
 * made re-theming a whole-file edit. Kept in the repo so the mapping used is
 * auditable, but it is not part of any build.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const RGB_TOKENS = new Map([
  ['255,250,240', 'cream-rgb'],
  ['255,253,247', 'cream-rgb'],
  ['255,252,241', 'cream-rgb'],
  ['255,250,231', 'cream-rgb'],
  ['249,242,226', 'paper-rgb'],
  ['245,238,222', 'paper-rgb'],
  ['243,236,220', 'paper-rgb'],
  ['215,202,174', 'paper-deep-rgb'],
  ['214,169,79', 'gold-rgb'],
  ['207,168,94', 'gold-rgb'],
  ['234,212,161', 'gold-pale-rgb'],
  ['248,235,207', 'gold-pale-rgb'],
  ['107,89,57', 'gold-deep-rgb'],
  ['126,100,64', 'gold-deep-rgb'],
  ['185,82,61', 'vermillion-rgb'],
  ['143,56,45', 'vermillion-rgb'],
  ['23,52,49', 'ink-rgb'],
  ['34,59,52', 'ink-rgb'],
  ['46,57,48', 'ink-rgb'],
  ['77,89,73', 'ink-rgb'],
  ['10,34,32', 'ink-deep-rgb'],
  ['44,31,24', 'shadow-rgb'],
  ['49,40,28', 'shadow-rgb'],
  ['30,31,25', 'shadow-rgb'],
  ['104,76,48', 'shadow-rgb'],
  ['57,115,95', 'jade-rgb'],
])

const HEX_TOKENS = new Map([
  ['#fffaf0', 'cream'],
  ['#fff8e8', 'cream'],
  ['#fff8e9', 'cream'],
  ['#173431', 'ink'],
  ['#102c29', 'ink-deep'],
  ['#39735f', 'jade'],
  ['#eee4d1', 'paper'],
  ['#f3ecdc', 'paper'],
  ['#eee3cd', 'paper'],
  ['#e8dcc5', 'paper-deep'],
  ['#eadfc7', 'paper-deep'],
  ['#49625e', 'ink-soft'],
  ['#536b65', 'ink-faint'],
  ['#a33f31', 'vermillion'],
  ['#8f382d', 'vermillion-dark'],
  ['#d6a94f', 'gold'],
  ['#e7b75e', 'gold'],
  ['#dcae67', 'gold'],
  ['#ead4a1', 'gold-pale'],
  ['#e5d4b4', 'gold-pale'],
  ['#d7caae', 'gold-pale'],
])

const path = process.argv[2] ?? 'src/styles.css'
const source = readFileSync(path, 'utf8')

// The :root block defines the tokens, so rewriting it would make them
// self-referential. Everything after it is fair game.
const rootEnd = source.indexOf('}') + 1
const head = source.slice(0, rootEnd)
let body = source.slice(rootEnd)

let rgbCount = 0
body = body.replace(
  /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/g,
  (match, r, g, b, alpha) => {
    const token = RGB_TOKENS.get(`${r},${g},${b}`)
    if (!token) return match
    rgbCount += 1
    return alpha === undefined
      ? `rgb(var(--${token}))`
      : `rgba(var(--${token}), ${alpha})`
  },
)

let hexCount = 0
body = body.replace(/#[0-9a-fA-F]{3,8}\b/g, (match) => {
  const token = HEX_TOKENS.get(match.toLowerCase())
  if (!token) return match
  hexCount += 1
  return `var(--${token})`
})

writeFileSync(path, head + body)
console.log(`Tokenized ${rgbCount} rgb() and ${hexCount} hex literals in ${path}.`)
