/**
 * Detect a host-local report artifact referenced in a /slash command chip body
 * (e.g. the `/insights` payload contains
 * `Report URL: file:///Users/x/.claude-work/usage-data/report-2026-06-07-131009.html`).
 *
 * Returns the configDir-RELATIVE path (`usage-data/report-*.html`), which is
 * what the broker -> sentinel `fetch_artifact` RPC expects. Deliberately
 * aligned with the sentinel's built-in allowlist (`usage-data/*.html`) so the
 * control panel never offers a "Show report" button for an artifact the
 * sentinel would refuse. The profile's configDir (`.claude`, `.claude-work`,
 * ...) is resolved sentinel-side; the web side never needs it.
 */
export function detectReportArtifactRelPath(content: string): string | undefined {
  const m = content.match(/usage-data\/report-[\w.-]+\.html/)
  return m ? m[0] : undefined
}
