export type AugCacheMap = Record<number, { name: string }>

export function matchAugments(text: string, cache: AugCacheMap): number[] {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

  const entries = Object.entries(cache).sort(
    ([, a], [, b]) => (b.name ?? '').length - (a.name ?? '').length
  )

  let remaining = normalize(text)
  const matched: number[] = []

  for (const [idStr, info] of entries) {
    const nameLower = normalize(info.name ?? '')
    if (nameLower.length < 3) continue
    if (remaining.includes(nameLower)) {
      matched.push(Number(idStr))
      remaining = remaining.replace(nameLower, '')
      if (matched.length === 3) break
    }
  }
  return matched
}
