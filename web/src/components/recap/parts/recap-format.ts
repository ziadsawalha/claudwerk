/** Number formatters for the structured recap report (Recap 2.0). */

export function fmtUsd(n: number): string {
  if (!n) return '$0'
  if (n < 0.01) return '<$0.01'
  if (n < 1) return `$${n.toFixed(2)}`
  if (n < 100) return `$${n.toFixed(1)}`
  return `$${Math.round(n).toLocaleString()}`
}

export function fmtCompact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
