import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { LiveStatus } from '@/lib/types'
import { StatusIcon } from './status-icon'

const st = (over: Partial<LiveStatus> = {}): LiveStatus => ({
  state: 'done',
  seq: 1,
  updatedAt: Date.now() - 5 * 60_000,
  ...over,
})

// The detail tooltip moved from a native `title` to the portaled StatusHoverCard
// (only mounts on hover), so these SSR assertions cover the always-visible glyph
// surface; the Markdown panel body is covered in status-hover-panel.test.tsx.
describe('StatusIcon', () => {
  it('renders nothing without a status', () => {
    expect(renderToStaticMarkup(<StatusIcon status={undefined} />)).toBe('')
  })

  it('renders the state glyph + age + accessible label', () => {
    const html = renderToStaticMarkup(<StatusIcon status={st({ state: 'done' })} />)
    expect(html).toContain('✓')
    expect(html).toContain('5m')
    expect(html).toContain('DONE') // aria-label on the glyph
  })

  it('shows the closeable marker only when safe_to_close', () => {
    expect(renderToStaticMarkup(<StatusIcon status={st({ safe_to_close: true })} />)).toContain('✕')
    expect(renderToStaticMarkup(<StatusIcon status={st({ safe_to_close: false })} />)).not.toContain('✕')
  })

  it('dims + strikes a superseded status (user input after updatedAt)', () => {
    const status = st({ updatedAt: 1000 })
    const html = renderToStaticMarkup(<StatusIcon status={status} lastInputAt={2000} />)
    expect(html).toContain('opacity-40')
    expect(html).toContain('line-through')
  })

  it('does NOT dim when the status is current (input predates it)', () => {
    const status = st({ updatedAt: 5000 })
    const html = renderToStaticMarkup(<StatusIcon status={status} lastInputAt={4000} />)
    expect(html).not.toContain('opacity-40')
  })

  it('hides the visible age span when showAge is false', () => {
    const html = renderToStaticMarkup(<StatusIcon status={st({ updatedAt: Date.now() - 3000 })} showAge={false} />)
    // The age now lives only in the hover card; the standalone age span (its dim
    // class) must not render here.
    expect(html).not.toContain('text-[9px]')
  })
})
