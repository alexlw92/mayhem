export type AugCacheMap = Record<number, { name: string }>

export function normalizeOcr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Returns [from, to] slice indices if name is found in haystack, else null.
// Tries exact substring first; falls back to ordered word match with proximity guard.
function findInText(haystack: string, name: string): [number, number] | null {
  const idx = haystack.indexOf(name)
  if (idx !== -1) return [idx, idx + name.length]

  const words = name.split(' ').filter(w => w.length >= 3)
  if (words.length < 2) return null

  let from = -1
  let pos = 0
  for (const word of words) {
    const widx = haystack.indexOf(word, pos)
    if (widx === -1) return null
    if (from === -1) from = widx
    // Proximity: matched region must not be wider than the name itself + 10 chars slack
    if (widx - from > name.length + 10) return null
    pos = widx + word.length
  }
  return [from, pos]
}

export function matchAugments(text: string, cache: AugCacheMap): number[] {
  const entries = Object.entries(cache).sort(
    ([, a], [, b]) => (b.name ?? '').length - (a.name ?? '').length
  )

  let remaining = normalizeOcr(text)
  const matched: number[] = []

  for (const [idStr, info] of entries) {
    const nameLower = normalizeOcr(info.name ?? '')
    if (nameLower.length < 3) continue

    const found = findInText(remaining, nameLower)
    if (found) {
      const [from, to] = found
      matched.push(Number(idStr))
      // Blank out the matched region (preserves string length so other positions stay valid)
      remaining = remaining.slice(0, from) + ' '.repeat(to - from) + remaining.slice(to)
    }
  }
  return matched
}
