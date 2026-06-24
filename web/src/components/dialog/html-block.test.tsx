/**
 * HtmlBlock isolation guard. The single security invariant: the embed iframe is
 * sandboxed WITHOUT allow-same-origin, so agent-authored HTML runs in an opaque
 * origin and can never touch the control-panel origin or its cookies. If anyone
 * ever adds allow-same-origin, this test fails loudly.
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { HtmlBlock } from './html-block'

afterEach(cleanup)

function iframeOf(container: HTMLElement): HTMLIFrameElement {
  const el = container.querySelector('iframe')
  if (!el) throw new Error('no iframe rendered')
  return el
}

describe('HtmlBlock', () => {
  test('sandboxes the iframe and never grants same-origin', () => {
    const { container } = render(<HtmlBlock content="<h1>hi</h1>" />)
    const sandbox = iframeOf(container).getAttribute('sandbox') ?? ''
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).not.toContain('allow-same-origin')
  })

  test('inline content renders via srcdoc, not src', () => {
    const { container } = render(<HtmlBlock content="<p>inline</p>" />)
    const iframe = iframeOf(container)
    expect(iframe.getAttribute('srcdoc')).toBe('<p>inline</p>')
    expect(iframe.getAttribute('src')).toBeNull()
  })

  test('url renders via src, not srcdoc, with an open-in-tab link', () => {
    const url = '/file/abc123.html'
    const { container } = render(<HtmlBlock url={url} />)
    const iframe = iframeOf(container)
    expect(iframe.getAttribute('src')).toBe(url)
    expect(iframe.getAttribute('srcdoc')).toBeNull()
    const link = container.querySelector(`a[href="${url}"]`)
    expect(link).not.toBeNull()
  })
})
