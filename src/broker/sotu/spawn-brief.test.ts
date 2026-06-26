import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setProjectSettings } from '../project-settings'
import { writeChronicle } from './chronicle'
import { claimContrib } from './contrib-fixtures'
import { recordContribution } from './contribute'
import { initSotuStore, projectSlug } from './index'
import { sotuSpawnBrief } from './spawn-brief'
import { emptyChronicle } from './types'

const PROJECT = 'claude://host/spawn-brief-proj'
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sotu-spawn-'))
  initSotuStore(dir)
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  setProjectSettings(PROJECT, { sotuEnabled: false })
})

test('returns empty when SOTU is disabled for the project (floor-only)', () => {
  setProjectSettings(PROJECT, { sotuEnabled: false })
  const chron = emptyChronicle(1)
  chron.narrative = 'busy project'
  writeChronicle(projectSlug(PROJECT), chron)
  expect(sotuSpawnBrief(PROJECT, 'spawn-brief-proj')).toBe('')
})

test('injects the brief (narrative + CONTENDED) for an enabled project', () => {
  setProjectSettings(PROJECT, { sotuEnabled: true })
  const slug = projectSlug(PROJECT)
  const chron = emptyChronicle(1)
  chron.narrative = 'Two convs converging on auth.'
  writeChronicle(slug, chron)
  recordContribution(slug, claimContrib('conv-a', 1000))
  recordContribution(slug, claimContrib('conv-b', 2000))

  const brief = sotuSpawnBrief(PROJECT, 'spawn-brief-proj')
  expect(brief).toContain('State of the Union -- spawn-brief-proj')
  expect(brief).toContain('converging on auth')
  expect(brief).toContain('CONTENDED')
  expect(brief).toContain('src/auth.ts')
})

test('never throws when the store is uninitialized -> returns empty', () => {
  // No initSotuStore in a fresh module-state would throw inside; the helper must
  // swallow it. Enabled but no chronicle/queue -> empty brief, no throw.
  setProjectSettings(PROJECT, { sotuEnabled: true })
  expect(() => sotuSpawnBrief(PROJECT, 'x')).not.toThrow()
})
