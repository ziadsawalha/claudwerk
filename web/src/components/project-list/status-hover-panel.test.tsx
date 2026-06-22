import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { LiveStatus } from '@/lib/types'
import { StatusHoverPanel } from './status-hover-panel'

const st = (over: Partial<LiveStatus> = {}): LiveStatus => ({
  state: 'done',
  seq: 1,
  updatedAt: Date.now() - 5 * 60_000,
  ...over,
})

describe('StatusHoverPanel', () => {
  it('renders the state label + age in the header', () => {
    const html = renderToStaticMarkup(<StatusHoverPanel status={st({ state: 'done' })} />)
    expect(html).toContain('DONE')
    expect(html).toContain('5m ago')
  })

  it('renders detail fields as Markdown, not raw source', () => {
    const html = renderToStaticMarkup(
      <StatusHoverPanel status={st({ done: 'shipped `liveStatus` and **statusStale**' })} />,
    )
    // The whole point: backticks/asterisks become real elements, not literal text.
    expect(html).toContain('<code>liveStatus</code>')
    expect(html).toContain('<strong>statusStale</strong>')
    expect(html).not.toContain('`liveStatus`')
  })

  it('shows the closeable marker when safe_to_close', () => {
    const html = renderToStaticMarkup(<StatusHoverPanel status={st({ safe_to_close: true })} />)
    expect(html).toContain('closeable')
  })

  it('shows the superseded warning when flagged', () => {
    const html = renderToStaticMarkup(<StatusHoverPanel status={st()} superseded />)
    expect(html).toContain('superseded')
  })

  it('shows the last-input age when provided', () => {
    const html = renderToStaticMarkup(<StatusHoverPanel status={st()} lastInputAt={Date.now() - 2 * 60_000} />)
    expect(html).toContain('last input')
    expect(html).toContain('2m ago')
  })

  it('omits the detail grid when no fields are populated (empty is signal)', () => {
    const html = renderToStaticMarkup(<StatusHoverPanel status={st()} />)
    expect(html).not.toContain('grid-cols-')
  })
})
