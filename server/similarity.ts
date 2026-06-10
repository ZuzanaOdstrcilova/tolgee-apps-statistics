/**
 * Text-similarity scoring for "how close was the AI output to the final
 * reviewed text". All scorers return an integer 0–100 (100 = identical).
 * Dependency-free.
 */

export type Scorer = (a: string, b: string) => number

export const countWords = (s: string): number => {
  const t = s.trim()
  return t === '' ? 0 : t.split(/\s+/).length
}

/** Two-row Levenshtein edit distance over an array of comparable items. */
const editDistance = <T>(a: readonly T[], b: readonly T[]): number => {
  const n = a.length
  const m = b.length
  if (n === 0) return m
  if (m === 0) return n
  let prev = Array.from({ length: m + 1 }, (_, i) => i)
  let curr = new Array<number>(m + 1)
  for (let i = 1; i <= n; i++) {
    curr[0] = i
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[m]
}

const tokenize = (s: string): string[] =>
  s.trim().toLowerCase().split(/\s+/).filter(Boolean)

/**
 * Distance → 0–100 score. 100 is reserved for an EXACT match (distance 0);
 * any real difference caps at 99 so rounding (e.g. 1 edit in 200 tokens →
 * 99.5) can never leak a changed translation into the "100% Match" bucket.
 */
const ratioScore = (dist: number, max: number): number =>
  max === 0 || dist === 0 ? 100 : Math.min(99, Math.round(100 * (1 - dist / max)))

/**
 * Word-level similarity: edit distance over whitespace tokens, normalised by
 * the longer token count. Robust to punctuation/whitespace noise and matches
 * the word-weighted dashboard. This is the default.
 */
export const wordTokenScore: Scorer = (a, b) => {
  const ta = tokenize(a)
  const tb = tokenize(b)
  return ratioScore(editDistance(ta, tb), Math.max(ta.length, tb.length))
}

const CHAR_CAP = 4000

/** Character-level Levenshtein ratio. Stricter; catches tiny edits. */
export const charLevenshteinScore: Scorer = (a, b) => {
  // Char DP is O(n·m); for very long strings defer to the (uncapped, cheaper)
  // word scorer rather than truncating inputs and hiding later differences.
  if (a.length > CHAR_CAP || b.length > CHAR_CAP) return wordTokenScore(a, b)
  const ca = [...a]
  const cb = [...b]
  return ratioScore(editDistance(ca, cb), Math.max(ca.length, cb.length))
}

export const DEFAULT_SCORER: Scorer = wordTokenScore

export type BucketKey = 'b100' | 'b9990' | 'b8980' | 'b7970' | 'bno'

/** Thresholds match the dashboard's BUCKETS legend exactly. */
export const bucketOf = (score: number): BucketKey =>
  score >= 100 ? 'b100' : score >= 90 ? 'b9990' : score >= 80 ? 'b8980' : score >= 70 ? 'b7970' : 'bno'
