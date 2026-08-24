import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  lstat,
  readFile,
} from 'node:fs/promises'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inflateRawSync } from 'node:zlib'

import {
  candidateWhitePaperWithReleaseHandoff,
  createPdf,
  downloadablePdfMarkdown,
  historicalWhitePaperForDistribution,
  renderWhitePaperHtml,
} from './generate-downloads.mjs'
import {
  resolveReleaseIdentity,
  validateResolvedReleaseIdentity,
} from './release-identity.mjs'
import {
  runtimePayloadEntryForPath,
  runtimePayloadIdentityFromFiles,
} from './runtime-payload-identity.mjs'

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u
const TAR_BLOCK_BYTES = 512
const TAR_END_BYTES = TAR_BLOCK_BYTES * 2
const MAX_PACKED_BYTES = 128 * 1024 * 1024
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024
const MAX_TAR_FILE_BYTES = 128 * 1024 * 1024
const MAX_TAR_ENTRIES = 100_000
const MAX_JSON_BYTES = 1024 * 1024
const NPM_PORTABLE_MTIME = 499_162_500
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })
const CANDIDATE_PAPER_PATH = 'docs/ARACHNE_METHOD_WHITE_PAPER_3_1.md'
const CANDIDATE_PAPER_TITLE = 'The Arachne Method and WebChess'
const HISTORICAL_PAPER_PATH = 'docs/WEBCHESS_WHITE_PAPER_V3.md'
const HISTORICAL_SOFTWARE_VERSION = '2.2.0'
const ALLOWED_NON_RUNTIME_FILES = new Set([
  'npm-shrinkwrap.json',
  'webchess-build-identity.json',
])
const CRC32_TABLE = Array.from({ length: 256 }, (_, value) => {
  let remainder = value
  for (let bit = 0; bit < 8; bit += 1) {
    remainder = remainder & 1
      ? 0xedb88320 ^ (remainder >>> 1)
      : remainder >>> 1
  }
  return remainder >>> 0
})

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function allZero(bytes) {
  return bytes.every((byte) => byte === 0)
}

function isByteView(value) {
  return Buffer.isBuffer(value) || (
    ArrayBuffer.isView(value) && value.BYTES_PER_ELEMENT === 1
  )
}

function crc32(bytes) {
  let checksum = 0xffffffff
  for (const byte of bytes) {
    checksum = CRC32_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8)
  }
  return (checksum ^ 0xffffffff) >>> 0
}

function decompressSingleGzip(artifactBytes) {
  const compressed = Buffer.from(
    artifactBytes.buffer,
    artifactBytes.byteOffset,
    artifactBytes.byteLength,
  )
  if (
    compressed.byteLength < 18 ||
    compressed[0] !== 0x1f ||
    compressed[1] !== 0x8b ||
    compressed[2] !== 0x08 ||
    compressed[3] !== 0
  ) {
    throw new Error(
      'Packed WebChess artifact is not a canonical single-member gzip stream.',
    )
  }
  let result
  try {
    result = inflateRawSync(compressed.subarray(10), {
      info: true,
      maxOutputLength: MAX_UNPACKED_BYTES,
    })
  } catch {
    throw new Error('Packed WebChess artifact is not a bounded gzip stream.')
  }
  const footerOffset = 10 + result.engine.bytesWritten
  if (footerOffset + 8 !== compressed.byteLength) {
    throw new Error(
      'Packed WebChess artifact must contain exactly one gzip member with no trailing bytes.',
    )
  }
  const expectedChecksum = compressed.readUInt32LE(footerOffset)
  const expectedSize = compressed.readUInt32LE(footerOffset + 4)
  if (
    crc32(result.buffer) !== expectedChecksum ||
    (result.buffer.byteLength >>> 0) !== expectedSize
  ) {
    throw new Error('Packed WebChess artifact has an invalid gzip checksum or size.')
  }
  return result.buffer
}

function decodeTarString(bytes, label) {
  const nul = bytes.indexOf(0)
  const valueBytes = nul === -1 ? bytes : bytes.subarray(0, nul)
  if (nul !== -1 && !allZero(bytes.subarray(nul))) {
    throw new Error(`Packed WebChess artifact contains an invalid tar ${label}.`)
  }
  try {
    return UTF8_DECODER.decode(valueBytes)
  } catch {
    throw new Error(`Packed WebChess artifact contains a non-UTF-8 tar ${label}.`)
  }
}

function parseTarOctal(bytes, label) {
  let end = bytes.length
  while (end > 0 && (bytes[end - 1] === 0 || bytes[end - 1] === 0x20)) {
    end -= 1
  }
  let start = 0
  while (start < end && bytes[start] === 0x20) start += 1
  const value = bytes.subarray(start, end).toString('ascii')
  if (!/^[0-7]+$/u.test(value)) {
    throw new Error(`Packed WebChess artifact contains an invalid tar ${label}.`)
  }
  const parsed = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Packed WebChess artifact contains an unsafe tar ${label}.`)
  }
  return parsed
}

function parseTarZero(bytes, label) {
  return bytes.every((byte) => byte === 0 || byte === 0x20)
    ? 0
    : parseTarOctal(bytes, label)
}

function tarChecksum(header) {
  let total = 0
  for (let index = 0; index < header.length; index += 1) {
    total += index >= 148 && index < 156 ? 0x20 : header[index]
  }
  return total
}

function hasControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

function validatePackedPath(value) {
  const segments = value.split('/')
  if (
    !value.startsWith('package/') ||
    value.includes('\\') ||
    hasControlCharacter(value) ||
    path.posix.normalize(value) !== value ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Packed WebChess artifact contains an unsafe path.')
  }
  if (segments.includes('node_modules')) {
    throw new Error(
      'Packed WebChess artifact contains a dependency-shadowing path.',
    )
  }
  if (path.posix.basename(value) === '.npmignore') {
    throw new Error('Packed WebChess artifact contains an npm control file.')
  }
}

export function parsePackedArtifact(artifactBytes) {
  if (
    !isByteView(artifactBytes) ||
    artifactBytes.byteLength === 0 ||
    artifactBytes.byteLength > MAX_PACKED_BYTES
  ) {
    throw new Error('Packed WebChess artifact has an invalid compressed size.')
  }
  const unpacked = decompressSingleGzip(artifactBytes)
  if (
    unpacked.byteLength < TAR_END_BYTES ||
    unpacked.byteLength % TAR_BLOCK_BYTES !== 0
  ) {
    throw new Error('Packed WebChess artifact has an invalid tar length.')
  }

  const entries = []
  const seenPaths = new Set()
  let offset = 0
  let foundEnd = false
  while (offset + TAR_BLOCK_BYTES <= unpacked.byteLength) {
    const header = unpacked.subarray(offset, offset + TAR_BLOCK_BYTES)
    if (allZero(header)) {
      if (
        offset + TAR_END_BYTES > unpacked.byteLength ||
        !allZero(unpacked.subarray(offset, offset + TAR_END_BYTES)) ||
        !allZero(unpacked.subarray(offset))
      ) {
        throw new Error('Packed WebChess artifact has an invalid tar end record.')
      }
      foundEnd = true
      break
    }
    if (entries.length >= MAX_TAR_ENTRIES) {
      throw new Error('Packed WebChess artifact contains too many files.')
    }
    if (
      !header.subarray(257, 263).equals(Buffer.from('ustar\0')) ||
      !header.subarray(263, 265).equals(Buffer.from('00'))
    ) {
      throw new Error('Packed WebChess artifact is not a canonical ustar archive.')
    }
    const expectedChecksum = parseTarOctal(
      header.subarray(148, 156),
      'checksum',
    )
    if (tarChecksum(header) !== expectedChecksum) {
      throw new Error('Packed WebChess artifact has an invalid tar checksum.')
    }
    const mode = parseTarOctal(header.subarray(100, 108), 'file mode')
    const mtime = parseTarOctal(header.subarray(136, 148), 'modification time')
    if (
      (mode !== 0o644 && mode !== 0o755) ||
      parseTarZero(header.subarray(108, 116), 'user id') !== 0 ||
      parseTarZero(header.subarray(116, 124), 'group id') !== 0 ||
      mtime !== NPM_PORTABLE_MTIME ||
      decodeTarString(header.subarray(265, 297), 'user name') ||
      decodeTarString(header.subarray(297, 329), 'group name') ||
      parseTarZero(header.subarray(329, 337), 'device major number') !== 0 ||
      parseTarZero(header.subarray(337, 345), 'device minor number') !== 0 ||
      !allZero(header.subarray(500))
    ) {
      throw new Error(
        'Packed WebChess artifact contains noncanonical npm tar metadata.',
      )
    }
    if (header[156] !== 0x30) {
      throw new Error('Packed WebChess artifact contains a non-regular tar entry.')
    }
    if (decodeTarString(header.subarray(157, 257), 'link name')) {
      throw new Error('Packed WebChess artifact contains a linked tar entry.')
    }
    const name = decodeTarString(header.subarray(0, 100), 'path')
    const prefix = decodeTarString(header.subarray(345, 500), 'path prefix')
    const entryPath = prefix ? `${prefix}/${name}` : name
    validatePackedPath(entryPath)
    if (seenPaths.has(entryPath)) {
      throw new Error('Packed WebChess artifact contains a duplicate path.')
    }
    seenPaths.add(entryPath)

    const size = parseTarOctal(header.subarray(124, 136), 'file size')
    if (size > MAX_TAR_FILE_BYTES) {
      throw new Error('Packed WebChess artifact contains an oversized tar file.')
    }
    const contentStart = offset + TAR_BLOCK_BYTES
    const contentEnd = contentStart + size
    const nextOffset = contentStart + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES
    if (contentEnd > unpacked.byteLength || nextOffset > unpacked.byteLength) {
      throw new Error('Packed WebChess artifact contains a truncated tar entry.')
    }
    if (!allZero(unpacked.subarray(contentEnd, nextOffset))) {
      throw new Error('Packed WebChess artifact contains nonzero tar padding.')
    }
    entries.push({
      path: entryPath,
      bytes: unpacked.subarray(contentStart, contentEnd),
      mode,
    })
    offset = nextOffset
  }
  if (!foundEnd || entries.length === 0) {
    throw new Error('Packed WebChess artifact has no complete tar payload.')
  }
  return entries
}

function packageFiles(entries) {
  return new Map(entries.map((entry) => [
    entry.path.slice('package/'.length),
    entry.bytes,
  ]))
}

function requiredFile(files, relativePath) {
  const bytes = files.get(relativePath)
  if (!bytes) {
    throw new Error(`Packed WebChess artifact is missing ${relativePath}.`)
  }
  return bytes
}

function parseJsonFile(files, relativePath) {
  const bytes = requiredFile(files, relativePath)
  if (bytes.byteLength > MAX_JSON_BYTES) {
    throw new Error(`Packed WebChess artifact contains an oversized ${relativePath}.`)
  }
  try {
    return JSON.parse(UTF8_DECODER.decode(bytes))
  } catch {
    throw new Error(`Packed WebChess artifact contains invalid JSON in ${relativePath}.`)
  }
}

function textFile(files, relativePath) {
  const bytes = requiredFile(files, relativePath)
  try {
    return UTF8_DECODER.decode(bytes)
  } catch {
    throw new Error(`Packed WebChess artifact contains non-UTF-8 text in ${relativePath}.`)
  }
}

function markdownImageReferences(markdown) {
  const references = new Set()
  const pattern = /!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'))?\)/gu
  let match
  while ((match = pattern.exec(markdown)) !== null) {
    references.add(match[1] ?? match[2])
  }
  return [...references]
}

function localImageEntryPath(href, sourcePath) {
  if (!href || /^(?:data:|https?:|#)/iu.test(href)) return null
  const cleanHref = href.split(/[?#]/u, 1)[0]
  const decoded = decodeURI(cleanHref)
  if (decoded.startsWith('/')) return null
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(sourcePath), decoded),
  )
  return resolved.startsWith('public/') ? resolved : null
}

function jpegDimensions(bytes) {
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8
  ) {
    throw new Error('Packed candidate PDF figure is not a JPEG image.')
  }
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ])
  let offset = 2
  while (offset + 8 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue
    }
    if (offset + 2 > bytes.byteLength) break
    const segmentLength = bytes.readUInt16BE(offset)
    if (startOfFrameMarkers.has(marker)) {
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      }
    }
    if (segmentLength < 2) break
    offset += segmentLength
  }
  throw new Error('Packed candidate PDF figure dimensions are invalid.')
}

function packedWhitePaperImages(markdown, sourcePath, files) {
  const images = new Map()
  for (const href of markdownImageReferences(markdown)) {
    const entryPath = localImageEntryPath(href, sourcePath)
    if (!entryPath) continue
    const extension = path.posix.extname(entryPath).toLowerCase()
    if (extension !== '.jpg' && extension !== '.jpeg') {
      throw new Error(`Packed candidate PDF figure must be JPEG: ${href}`)
    }
    const data = requiredFile(files, entryPath)
    images.set(href, {
      ...jpegDimensions(data),
      data,
      dataUri: `data:image/jpeg;base64,${data.toString('base64')}`,
      name: `Im${images.size + 1}`,
      source: href,
    })
  }
  return images
}

function expectedGeneratedDownloads(files, sourceCommit) {
  const installation = textFile(files, 'INSTALL.md')
  const license = textFile(files, 'LICENSE')
  const packageJson = parseJsonFile(files, 'package.json')
  if (
    typeof packageJson.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/u.test(
      packageJson.version,
    )
  ) {
    throw new Error('Packed WebChess package has an invalid software version.')
  }
  const candidateSource = textFile(files, CANDIDATE_PAPER_PATH)
  const historicalSource = textFile(files, HISTORICAL_PAPER_PATH)
  const candidateMarkdown = candidateWhitePaperWithReleaseHandoff(
    candidateSource,
    sourceCommit,
  )
  const historicalMarkdown = historicalWhitePaperForDistribution(
    historicalSource,
  )
  const candidateImages = packedWhitePaperImages(
    candidateSource,
    CANDIDATE_PAPER_PATH,
    files,
  )
  const historicalImages = packedWhitePaperImages(
    historicalSource,
    HISTORICAL_PAPER_PATH,
    files,
  )
  const candidateHtml = renderWhitePaperHtml(
    candidateMarkdown,
    candidateImages,
    {
      documentTitle: CANDIDATE_PAPER_TITLE,
      sourceCommit,
      sourcePath: CANDIDATE_PAPER_PATH,
    },
  )
  const candidatePdf = createPdf(
    downloadablePdfMarkdown(candidateMarkdown),
    packageJson.version,
    candidateImages,
    {
      documentTitle: CANDIDATE_PAPER_TITLE,
      linkAnnotations: true,
    },
  )
  const historicalHtml = renderWhitePaperHtml(
    historicalMarkdown,
    historicalImages,
  )
  const historicalPdf = createPdf(
    downloadablePdfMarkdown(historicalMarkdown),
    HISTORICAL_SOFTWARE_VERSION,
    historicalImages,
  )
  return new Map([
    ['public/downloads/LICENSE', Buffer.from(license)],
    ['public/downloads/webchess-installation.md', Buffer.from(installation)],
    ['public/downloads/webchess-white-paper.html', Buffer.from(candidateHtml)],
    ['public/downloads/webchess-white-paper.md', Buffer.from(candidateMarkdown)],
    ['public/downloads/webchess-white-paper.pdf', candidatePdf],
    [
      'public/downloads/webchess-white-paper-v3-historical.html',
      Buffer.from(historicalHtml),
    ],
    [
      'public/downloads/webchess-white-paper-v3-historical.md',
      Buffer.from(historicalMarkdown),
    ],
    [
      'public/downloads/webchess-white-paper-v3-historical.pdf',
      historicalPdf,
    ],
  ])
}

function generatedDownloadPaths(sourceCommit) {
  return [
    'public/downloads/LICENSE',
    'public/downloads/webchess-installation.md',
    'public/downloads/webchess-release-identity.json',
    `public/downloads/webchess-source-${sourceCommit}.zip`,
    'public/downloads/webchess-white-paper.html',
    'public/downloads/webchess-white-paper.md',
    'public/downloads/webchess-white-paper.pdf',
    'public/downloads/webchess-white-paper-v3-historical.html',
    'public/downloads/webchess-white-paper-v3-historical.md',
    'public/downloads/webchess-white-paper-v3-historical.pdf',
  ].sort((left, right) => left.localeCompare(right, 'en'))
}

function assertExactBytes(actual, expected, relativePath) {
  if (!Buffer.from(actual).equals(Buffer.from(expected))) {
    throw new Error(
      `Packed generated download is stale or noncanonical: ${relativePath}.`,
    )
  }
}

function publicArtifactPath(downloadPath) {
  if (
    typeof downloadPath !== 'string' ||
    !downloadPath.startsWith('/downloads/') ||
    downloadPath.includes('\\') ||
    path.posix.normalize(downloadPath) !== downloadPath ||
    downloadPath.split('/').some((segment, index) => index > 0 && !segment)
  ) {
    throw new Error('Packed release identity contains an unsafe download path.')
  }
  return `public${downloadPath}`
}

function verifyDigest(bytes, expected, relativePath) {
  if (!SHA256_PATTERN.test(expected)) {
    throw new Error('Packed release identity contains an invalid SHA-256 digest.')
  }
  const actual = sha256(bytes)
  if (actual !== expected) {
    throw new Error(`Packed artifact digest mismatch for ${path.posix.basename(relativePath)}.`)
  }
  return actual
}

export function validatePackedReleaseIdentity(value, sourceCommit) {
  let identity
  try {
    identity = validateResolvedReleaseIdentity(value)
  } catch {
    throw new Error(
      'Packed public release identity does not match the canonical release contract.',
    )
  }
  if (identity.source.commit !== sourceCommit) {
    throw new Error(
      'Packed public release identity does not match the build identity.',
    )
  }
  return identity
}

export function verifyDownloadArtifacts(
  files,
  sourceCommit,
  trustedSourceArchive,
) {
  if (!isByteView(trustedSourceArchive)) {
    throw new Error(
      'Generated download verification requires the trusted Git source archive.',
    )
  }
  const expectedDownloads = expectedGeneratedDownloads(files, sourceCommit)
  for (const [relativePath, expected] of expectedDownloads) {
    assertExactBytes(requiredFile(files, relativePath), expected, relativePath)
  }
  const manifestPath = 'public/downloads/webchess-release-identity.json'
  const releaseIdentity = validatePackedReleaseIdentity(
    parseJsonFile(files, manifestPath),
    sourceCommit,
  )
  const sourcePath = publicArtifactPath(
    releaseIdentity.source.archive.downloadPath,
  )
  assertExactBytes(
    requiredFile(files, sourcePath),
    trustedSourceArchive,
    sourcePath,
  )
  const sourceSha256 = verifyDigest(
    requiredFile(files, sourcePath),
    releaseIdentity.source.archive.sha256,
    sourcePath,
  )
  const paperPath = publicArtifactPath(
    releaseIdentity.paper.candidate.pdf.downloadPath,
  )
  const paperSha256 = verifyDigest(
    requiredFile(files, paperPath),
    releaseIdentity.paper.candidate.pdf.sha256,
    paperPath,
  )
  const expectedReleaseIdentity = resolveReleaseIdentity({
    paperPdfSha256: paperSha256,
    paperRepositoryPath: CANDIDATE_PAPER_PATH,
    sourceArchiveSha256: sourceSha256,
    sourceCommit,
  })
  assertExactBytes(
    requiredFile(files, manifestPath),
    Buffer.from(`${JSON.stringify(expectedReleaseIdentity, null, 2)}\n`),
    manifestPath,
  )
  const expectedPaths = generatedDownloadPaths(sourceCommit)
  const actualPaths = [...files.keys()]
    .filter((relativePath) => (
      relativePath.startsWith('public/downloads/') &&
      relativePath !== 'public/downloads/.npmignore'
    ))
    .sort()
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error(
      'Packed WebChess artifact contains missing, stale, or unexpected public downloads.',
    )
  }
  return { paperSha256, releaseIdentity, sourceSha256 }
}

function validateTrustedSource(trustedSource) {
  const objectIdPattern = trustedSource?.objectFormat === 'sha1'
    ? /^[0-9a-f]{40}$/u
    : /^[0-9a-f]{64}$/u
  if (
    !trustedSource ||
    !SOURCE_COMMIT_PATTERN.test(trustedSource.sourceCommit) ||
    !isByteView(trustedSource.sourceArchive) ||
    trustedSource.package?.name !== 'webchess' ||
    typeof trustedSource.package.version !== 'string' ||
    (trustedSource.objectFormat !== 'sha1' &&
      trustedSource.objectFormat !== 'sha256') ||
    !Array.isArray(trustedSource.runtimeFiles) ||
    trustedSource.runtimeFiles.length === 0
  ) {
    throw new Error(
      'Packed artifact verification requires an exact trusted source identity.',
    )
  }
  const seenPaths = new Set()
  for (const file of trustedSource.runtimeFiles) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      !runtimePayloadEntryForPath(file.path) ||
      path.posix.normalize(file.path) !== file.path ||
      file.path.startsWith('/') ||
      file.path.includes('\\') ||
      file.path.split('/').some((segment) => !segment || segment === '..') ||
      path.posix.basename(file.path) === '.npmignore' ||
      seenPaths.has(file.path) ||
      (file.mode !== 0o644 && file.mode !== 0o755) ||
      !objectIdPattern.test(file.objectId)
    ) {
      throw new Error(
        'Packed artifact verification requires an exact trusted runtime inventory.',
      )
    }
    seenPaths.add(file.path)
  }
  return trustedSource
}

function gitBlobObjectId(bytes, objectFormat) {
  return createHash(objectFormat)
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex')
}

function verifyTrustedRuntimeFiles(payload, sourceFiles, trustedSource) {
  const generatedPaths = generatedDownloadPaths(trustedSource.sourceCommit)
  const expectedPaths = [
    ...trustedSource.runtimeFiles.map((file) => file.path),
    ...generatedPaths,
  ].sort((left, right) => left.localeCompare(right, 'en'))
  const actualPaths = payload.files
    .map((file) => file.path)
    .sort((left, right) => left.localeCompare(right, 'en'))
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error(
      'Packed WebChess runtime file set does not match the trusted source Git tree.',
    )
  }
  const actualByPath = new Map(payload.files.map((file) => [file.path, file]))
  for (const expected of trustedSource.runtimeFiles) {
    const actual = actualByPath.get(expected.path)
    if (
      actual.mode !== expected.mode ||
      gitBlobObjectId(
        requiredFile(sourceFiles, expected.path),
        trustedSource.objectFormat,
      ) !== expected.objectId
    ) {
      throw new Error(
        `Packed WebChess runtime file does not match the trusted source Git tree: ${expected.path}.`,
      )
    }
  }
  for (const generatedPath of generatedPaths) {
    if (actualByPath.get(generatedPath)?.mode !== 0o644) {
      throw new Error(
        `Packed WebChess generated download has a noncanonical mode: ${generatedPath}.`,
      )
    }
  }
}

function hasExactKeys(value, expected) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort()),
  )
}

export function verifyPackedArtifactBytes(
  artifactBytes,
  reviewedLock,
  trustedSourceInput,
) {
  if (!isByteView(reviewedLock)) {
    throw new Error('Packed artifact verification requires the reviewed lock bytes.')
  }
  const trustedSource = validateTrustedSource(trustedSourceInput)
  const entries = parsePackedArtifact(artifactBytes)
  const files = packageFiles(entries)
  for (const entry of entries) {
    const relativePath = entry.path.slice('package/'.length)
    if (
      !runtimePayloadEntryForPath(relativePath) &&
      !ALLOWED_NON_RUNTIME_FILES.has(relativePath)
    ) {
      throw new Error(
        `Packed WebChess artifact contains an unexpected package file: ${relativePath}.`,
      )
    }
    if (
      ALLOWED_NON_RUNTIME_FILES.has(relativePath) &&
      entry.mode !== 0o644
    ) {
      throw new Error(
        `Packed WebChess artifact contains a noncanonical mode for ${relativePath}.`,
      )
    }
  }
  const identity = parseJsonFile(files, 'webchess-build-identity.json')
  const packedPackage = parseJsonFile(files, 'package.json')
  const payload = runtimePayloadIdentityFromFiles(
    entries.map((entry) => ({
      path: entry.path.slice('package/'.length),
      bytes: entry.bytes,
      mode: entry.mode,
    })),
  )
  verifyTrustedRuntimeFiles(payload, files, trustedSource)
  if (
    !hasExactKeys(identity, [
      'format',
      'package',
      'runtimePayload',
      'sourceCommit',
    ]) ||
    !hasExactKeys(identity.package, ['name', 'version']) ||
    !hasExactKeys(identity.runtimePayload, [
      'byteCount',
      'fileCount',
      'format',
      'sha256',
    ]) ||
    identity.format !== 'webchess-build-identity/1' ||
    !SOURCE_COMMIT_PATTERN.test(identity.sourceCommit) ||
    identity.sourceCommit !== trustedSource.sourceCommit ||
    identity.package.name !== trustedSource.package.name ||
    identity.package.version !== trustedSource.package.version ||
    packedPackage.name !== trustedSource.package.name ||
    packedPackage.version !== trustedSource.package.version ||
    identity.runtimePayload?.format !== payload.format ||
    identity.runtimePayload.sha256 !== payload.sha256 ||
    identity.runtimePayload.fileCount !== payload.fileCount ||
    identity.runtimePayload.byteCount !== payload.byteCount
  ) {
    throw new Error(
      'Packed WebChess build identity does not match the trusted source and archived runtime bytes.',
    )
  }

  const packedLock = requiredFile(files, 'npm-shrinkwrap.json')
  if (!Buffer.from(reviewedLock).equals(packedLock)) {
    throw new Error('Packed dependency graph does not match package-lock.json.')
  }

  const { paperSha256, sourceSha256 } = verifyDownloadArtifacts(
    files,
    identity.sourceCommit,
    trustedSource.sourceArchive,
  )

  return {
    format: 'webchess-packed-artifact-verification/1',
    artifactSha256: sha256(artifactBytes),
    entryCount: entries.length,
    sourceCommit: identity.sourceCommit,
    runtimePayloadSha256: payload.sha256,
    pluginManifestSha256: sha256(requiredFile(files, 'openclaw.plugin.json')),
    sourceSha256,
    paperSha256,
  }
}

export function trustedGitReleaseSource(root = projectRoot) {
  const status = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  if (status.length !== 0) {
    throw new Error(
      'Packed artifact verification requires an exact clean trusted checkout.',
    )
  }
  const sourceCommit = execFileSync(
    'git',
    ['rev-parse', '--verify', 'HEAD^{commit}'],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  ).trim().toLowerCase()
  if (!SOURCE_COMMIT_PATTERN.test(sourceCommit)) {
    throw new Error(
      'Packed artifact verification requires an exact trusted Git commit.',
    )
  }
  const objectFormat = execFileSync(
    'git',
    ['rev-parse', '--show-object-format'],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  ).trim()
  if (objectFormat !== 'sha1' && objectFormat !== 'sha256') {
    throw new Error(
      'Packed artifact verification requires a supported Git object format.',
    )
  }
  const tree = execFileSync(
    'git',
    ['ls-tree', '-r', '-z', sourceCommit],
    {
      cwd: root,
      encoding: null,
      maxBuffer: MAX_UNPACKED_BYTES,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  const runtimeFiles = []
  let recordStart = 0
  while (recordStart < tree.byteLength) {
    const recordEnd = tree.indexOf(0, recordStart)
    if (recordEnd === -1) {
      throw new Error('Trusted Git tree contains an unterminated entry.')
    }
    const record = tree.subarray(recordStart, recordEnd)
    const separator = record.indexOf(0x09)
    if (separator === -1) {
      throw new Error('Trusted Git tree contains an invalid entry.')
    }
    const metadata = record.subarray(0, separator).toString('ascii')
    let relativePath
    try {
      relativePath = UTF8_DECODER.decode(record.subarray(separator + 1))
    } catch {
      throw new Error('Trusted Git tree contains a non-UTF-8 path.')
    }
    const match = /^(100644|100755) blob ([0-9a-f]+)$/u.exec(metadata)
    if (
      runtimePayloadEntryForPath(relativePath) &&
      path.posix.basename(relativePath) !== '.npmignore'
    ) {
      if (!match) {
        throw new Error(
          `Trusted Git runtime entry is not a regular file: ${relativePath}.`,
        )
      }
      runtimeFiles.push({
        path: relativePath,
        mode: match[1] === '100755' ? 0o755 : 0o644,
        objectId: match[2],
      })
    }
    recordStart = recordEnd + 1
  }
  const commitTime = execFileSync(
    'git',
    ['show', '-s', '--format=%ct', sourceCommit],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  ).trim()
  if (!/^[1-9]\d{8,11}$/u.test(commitTime)) {
    throw new Error(
      'Packed artifact verification requires an exact trusted commit timestamp.',
    )
  }
  const sourceArchive = execFileSync(
    'git',
    [
      'archive',
      '--format=zip',
      '-0',
      `--mtime=@${commitTime}`,
      `--prefix=webchess-${sourceCommit}/`,
      sourceCommit,
    ],
    {
      cwd: root,
      encoding: null,
      maxBuffer: MAX_UNPACKED_BYTES,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  return { objectFormat, runtimeFiles, sourceArchive, sourceCommit }
}

export async function verifyPackedArtifact(artifactPath) {
  const resolvedArtifactPath = path.resolve(artifactPath)
  const metadata = await lstat(resolvedArtifactPath)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Packed WebChess artifact must be a regular file.')
  }
  if (metadata.size <= 0 || metadata.size > MAX_PACKED_BYTES) {
    throw new Error('Packed WebChess artifact has an invalid compressed size.')
  }
  const trustedGitSource = trustedGitReleaseSource()
  const [artifactBytes, reviewedLock, trustedPackage] = await Promise.all([
    readFile(resolvedArtifactPath),
    readFile(path.join(projectRoot, 'package-lock.json')),
    readFile(path.join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
  ])
  return verifyPackedArtifactBytes(artifactBytes, reviewedLock, {
    ...trustedGitSource,
    package: trustedPackage,
  })
}

async function main() {
  if (process.argv.length !== 3) {
    throw new Error('Usage: node scripts/verify-packed-artifact.mjs <webchess.tgz>')
  }
  process.stdout.write(
    `${JSON.stringify(await verifyPackedArtifact(process.argv[2]), null, 2)}\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
