/** Tiny LCS line diff for previews. */
export function lineDiff(before: string, after: string, limit = 400): string {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length * b.length > 250_000) return after
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push('  ' + a[i])
      i++
      j++
    }
    else if (j < b.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) out.push('+ ' + b[j++])
    else out.push('- ' + a[i++])
  }
  return out.slice(0, limit).join('\n')
}
