const Z = 1.96
const Z2 = Z * Z

export function wilsonScore(wins: number, n: number): number {
  if (n === 0) return 0
  const p = wins / n
  const lower =
    (p + Z2 / (2 * n) - Z * Math.sqrt((p * (1 - p) + Z2 / (4 * n)) / n)) /
    (1 + Z2 / n)
  return lower * 10
}
