import { constants as fsConstants } from 'node:fs'
import { copyFile, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

export async function preparePackedShrinkwrap(
  root = repositoryRoot,
) {
  const lockPath = join(root, 'package-lock.json')
  const shrinkwrapPath = join(root, 'npm-shrinkwrap.json')
  const lockBytes = await readFile(lockPath)

  let lock
  try {
    lock = JSON.parse(lockBytes.toString('utf8'))
  } catch {
    throw new Error('package-lock.json is not valid JSON.')
  }
  if (!lock || typeof lock !== 'object' || lock.lockfileVersion !== 3) {
    throw new Error('The packed plugin requires a reviewed lockfileVersion 3 lock.')
  }

  try {
    await copyFile(
      lockPath,
      shrinkwrapPath,
      fsConstants.COPYFILE_EXCL,
    )
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    ) {
      throw error
    }
    const existing = await readFile(shrinkwrapPath)
    if (!existing.equals(lockBytes)) {
      throw new Error(
        'Refusing to replace an existing npm-shrinkwrap.json that differs from package-lock.json.',
        { cause: error },
      )
    }
  }

  const packedBytes = await readFile(shrinkwrapPath)
  if (!packedBytes.equals(lockBytes)) {
    throw new Error('The generated npm-shrinkwrap.json does not exactly match package-lock.json.')
  }
}

export async function cleanPackedShrinkwrap(
  root = repositoryRoot,
) {
  const lockPath = join(root, 'package-lock.json')
  const shrinkwrapPath = join(root, 'npm-shrinkwrap.json')
  let shrinkwrapBytes
  try {
    shrinkwrapBytes = await readFile(shrinkwrapPath)
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return
    }
    throw error
  }
  const lockBytes = await readFile(lockPath)
  if (!shrinkwrapBytes.equals(lockBytes)) {
    throw new Error(
      'Refusing to remove npm-shrinkwrap.json because it differs from package-lock.json.',
    )
  }
  await rm(shrinkwrapPath)
}

async function run() {
  if (process.argv[2] === '--clean') {
    await cleanPackedShrinkwrap()
    return
  }
  if (process.argv.length > 2) {
    throw new Error('Usage: node scripts/packed-shrinkwrap.mjs [--clean]')
  }
  await preparePackedShrinkwrap()
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await run()
}
