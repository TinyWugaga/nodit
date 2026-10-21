const MAX_CELLS = 250_000

/**
 * LCS line diff. Common leading and trailing lines are matched first, so a conversion that adds
 * frontmatter only runs LCS on the changed middle. `complete` is false when the middle is too large
 * to diff; callers that ask for confirmation must not treat that output as a full preview.
 */
export function diffLines(before: string, after: string): { lines: string[]; complete: boolean } {
  const a = before.split('\n')
  const b = after.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const am = a.slice(head, a.length - tail)
  const bm = b.slice(head, b.length - tail)
  const same = (lines: string[]) => lines.map((l) => '  ' + l)
  if (am.length * bm.length > MAX_CELLS) return { lines: [...same(a.slice(0, head)), ...bm.map((l) => '+ ' + l)], complete: false }

  const dp = Array.from({ length: am.length + 1 }, () => new Array<number>(bm.length + 1).fill(0))
  for (let i = am.length - 1; i >= 0; i--) for (let j = bm.length - 1; j >= 0; j--) dp[i][j] = am[i] === bm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const mid: string[] = []
  let i = 0
  let j = 0
  while (i < am.length || j < bm.length) {
    if (i < am.length && j < bm.length && am[i] === bm[j]) {
      mid.push('  ' + am[i])
      i++
      j++
    } else if (j < bm.length && (i >= am.length || dp[i][j + 1] >= dp[i + 1][j])) mid.push('+ ' + bm[j++])
    else mid.push('- ' + am[i++])
  }
  return { lines: [...same(a.slice(0, head)), ...mid, ...same(a.slice(a.length - tail))], complete: true }
}

/** Short diff for init previews. */
export function lineDiff(before: string, after: string, limit = 400): string {
  return diffLines(before, after).lines.slice(0, limit).join('\n')
}
