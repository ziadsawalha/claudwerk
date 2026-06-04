import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_TEMPLATE_ID,
  loadTemplates,
  loadTemplatesFromDir,
  pickTemplate,
  type RecapTemplateOption,
  resolveTemplatesDir,
  type TemplateLoadEvent,
  templateManifestSchema,
} from './templates'

const TEST_DIR = join(import.meta.dir, '.test-recap-templates')

// A minimal valid template body (no required fields beyond the schema).
const VALID_YML = `
id: project-recap
label: Project Recap
description: The default reflective recap.
sections: [features, bugs, fixes]
options:
  - id: terse
    label: Terse tone
    default: false
  - id: include_cost
    label: Include cost
    default: false
    signal: cost
body: |
  Write a recap for {{ period.human }}.
  {% if options.terse %}One line per item.{% endif %}
`

function write(file: string, contents: string): void {
  writeFileSync(join(TEST_DIR, file), contents)
}

function collectLogger(): { events: TemplateLoadEvent[]; log: (e: TemplateLoadEvent) => void } {
  const events: TemplateLoadEvent[] = []
  return { events, log: e => events.push(e) }
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('loadTemplatesFromDir', () => {
  it('loads a valid template and applies schema defaults', () => {
    write('project-recap.yml', VALID_YML)
    const { templates, skipped } = loadTemplatesFromDir(TEST_DIR, () => {})

    expect(skipped).toHaveLength(0)
    expect(templates.size).toBe(1)

    const t = templates.get('project-recap')
    if (!t) throw new Error('expected project-recap template to load')
    expect(t.label).toBe('Project Recap')
    expect(t.sections).toEqual(['features', 'bugs', 'fixes'])
    // Defaults filled in by the schema.
    expect(t.scope).toBe('fleet')
    expect(t.audience).toBe('human')
    expect(t.defaults).toEqual({ retrospect: false, customerFriendly: false, signals: [] })
    // Technical option carries its signal; prompt-tweak option does not.
    const byId = (id: string): RecapTemplateOption | undefined => t.options.find(o => o.id === id)
    expect(byId('include_cost')?.signal).toBe('cost')
    expect(byId('terse')?.signal).toBeUndefined()
  })

  it('skips a malformed YAML file and logs a structured event', () => {
    write('project-recap.yml', VALID_YML)
    write('broken.yml', 'id: broken\n  label: : : not valid yaml :')
    const { events, log } = collectLogger()

    const { templates, skipped } = loadTemplatesFromDir(TEST_DIR, log)

    // The valid one still loads; the broken one is skipped, not fatal.
    expect(templates.has('project-recap')).toBe(true)
    expect(templates.has('broken')).toBe(false)
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.file).toBe('broken.yml')
    // Structured event was logged (LOG-EVERYTHING covenant).
    expect(events).toHaveLength(1)
    expect(events[0]?.event).toBe('recap_template_skipped')
    expect(events[0]?.reason).toContain('yaml parse failed')
  })

  it('rejects a template missing a required field', () => {
    // No `body` -- required, no default.
    write('nobody.yml', 'id: nobody\nlabel: No Body\ndescription: missing body field\n')
    const { events, log } = collectLogger()

    const { templates, skipped } = loadTemplatesFromDir(TEST_DIR, log)

    expect(templates.size).toBe(0)
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.event).toBe('recap_template_skipped')
    expect(skipped[0]?.reason).toContain('schema invalid')
    expect(skipped[0]?.reason).toContain('body')
    expect(events).toHaveLength(1)
  })

  it('rejects a section outside the fixed frontmatter vocabulary', () => {
    write('badsection.yml', VALID_YML.replace('[features, bugs, fixes]', '[features, made_up_section]'))
    const { templates, skipped } = loadTemplatesFromDir(TEST_DIR, () => {})

    expect(templates.size).toBe(0)
    expect(skipped[0]?.reason).toContain('schema invalid')
    expect(skipped[0]?.reason).toContain('sections')
  })

  it('rejects a template body with a Liquid syntax error', () => {
    write(
      'badliquid.yml',
      VALID_YML.replace('{% if options.terse %}One line per item.{% endif %}', '{% if options.terse %}unclosed'),
    )
    const { templates, skipped } = loadTemplatesFromDir(TEST_DIR, () => {})

    expect(templates.size).toBe(0)
    expect(skipped[0]?.reason).toContain('liquid syntax error')
  })

  it('skips a duplicate id, keeping the first', () => {
    write('a.yml', VALID_YML)
    write('b.yml', VALID_YML.replace('label: Project Recap', 'label: Dup'))
    const { templates, skipped } = loadTemplatesFromDir(TEST_DIR, () => {})

    expect(templates.size).toBe(1)
    // Files are read in sorted order: a.yml wins, b.yml is the duplicate.
    expect(templates.get('project-recap')?.label).toBe('Project Recap')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.reason).toContain('duplicate id')
  })

  it('logs and returns empty when the dir is missing', () => {
    const { events, log } = collectLogger()
    const { templates, skipped } = loadTemplatesFromDir(join(TEST_DIR, 'does-not-exist'), log)

    expect(templates.size).toBe(0)
    expect(skipped[0]?.event).toBe('recap_templates_dir_missing')
    expect(events).toHaveLength(1)
  })
})

describe('resolveTemplatesDir / loadTemplates', () => {
  it('resolves to the repo dir when the prod bind-mount is absent', () => {
    // /srv/recap-templates does not exist in the test env -> dev fallback.
    expect(resolveTemplatesDir().endsWith('/recap-templates')).toBe(true)
  })

  it('loads the committed built-ins without throwing, including the anchor', () => {
    const { templates, skipped } = loadTemplates(() => {})
    // Phase 1 committed the default `project-recap` anchor template.
    expect(skipped).toHaveLength(0)
    expect(templates.has(DEFAULT_TEMPLATE_ID)).toBe(true)
    expect(templates.get(DEFAULT_TEMPLATE_ID)?.audience).toBe('human')
  })
})

describe('pickTemplate', () => {
  it('returns the requested template when present', () => {
    write('project-recap.yml', VALID_YML)
    const { templates } = loadTemplatesFromDir(TEST_DIR, () => {})
    expect(pickTemplate(templates, 'project-recap')?.id).toBe('project-recap')
  })

  it('falls back to the default template and logs when the requested id is missing', () => {
    write('project-recap.yml', VALID_YML)
    const { templates } = loadTemplatesFromDir(TEST_DIR, () => {})
    const { events, log } = collectLogger()

    const picked = pickTemplate(templates, 'no-such-template', log)
    expect(picked?.id).toBe(DEFAULT_TEMPLATE_ID)
    expect(events).toHaveLength(1)
    expect(events[0]?.event).toBe('recap_template_fallback')
  })

  it('returns undefined when even the default is absent', () => {
    const { templates } = loadTemplatesFromDir(TEST_DIR, () => {})
    expect(pickTemplate(templates, undefined, () => {})).toBeUndefined()
  })
})

describe('templateManifestSchema', () => {
  it('is exported for downstream wiring', () => {
    const parsed = templateManifestSchema.safeParse({
      id: 'x',
      label: 'X',
      description: 'd',
      body: 'hello',
    })
    expect(parsed.success).toBe(true)
  })
})
