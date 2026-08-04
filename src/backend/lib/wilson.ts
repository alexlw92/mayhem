const Z2 = 3.8416      // 1.96² (95% confidence)
const Z2_HALF = 1.9208 // z²/2

export function wilsonScore(wins: number, n: number): number {
  return ((wins + Z2_HALF) / (n + Z2)) * 10
}
