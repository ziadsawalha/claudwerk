/**
 * CONTRACT: Bun.write file permissions vs writeSecureFile.
 *
 * settings-merge.ts writes MCP config + secrets. Bun.write creates files
 * group/other-readable (unlike Node's writeFile umask handling in some cases),
 * which is why secrets go through writeSecureFile (0600). This pins both halves
 * so a Bun default change that silently widened secret perms is caught here.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSecureFile } from '../secure-temp'

let plain = ''
let secure = ''
let counter = 0
beforeEach(() => {
  plain = join(tmpdir(), `bun-write-plain-${process.pid}-${counter}.txt`)
  secure = join(tmpdir(), `bun-write-secure-${process.pid}-${counter}.txt`)
  counter++
})
afterEach(async () => {
  await rm(plain, { force: true })
  await rm(secure, { force: true })
})

describe('file permission contract', () => {
  test('Bun.write produces a NON-owner-only file (the hazard we defend against)', async () => {
    await Bun.write(plain, 'not-secret')
    const mode = statSync(plain).mode & 0o777
    // The exact bits vary with umask, but the point is: group/other CAN read.
    // If this ever flips to owner-only, writeSecureFile is redundant -- but until
    // then, secrets MUST not use a bare Bun.write.
    expect(mode & 0o044).not.toBe(0)
  })

  test('writeSecureFile locks the file to the owner (0600)', async () => {
    await writeSecureFile(secure, 'secret')
    const mode = statSync(secure).mode & 0o777
    expect(mode & 0o600).toBe(0o600) // owner rw present
    expect(mode & 0o077).toBe(0) // group + other have NOTHING
  })
})
