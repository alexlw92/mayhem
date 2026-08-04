import { describe, it, expect } from 'vitest'
import { wilsonScore } from '../wilson'

describe('wilsonScore', () => {
  it('returns 0 with no data', () => {
    expect(wilsonScore(0, 0)).toBe(0)
  })

  it('returns ~0 for 0% WR with 100 games', () => {
    expect(wilsonScore(0, 100)).toBeCloseTo(0, 1)
  })

  it('returns ~9.63 for 100% WR with 100 games', () => {
    expect(wilsonScore(100, 100)).toBeCloseTo(9.63, 1)
  })

  it('returns a higher score with more games at the same 50% WR', () => {
    const tenGames = wilsonScore(5, 10)   // ~2.4
    const hundredGames = wilsonScore(50, 100) // ~4.0
    expect(tenGames).toBeCloseTo(2.4, 1)
    expect(hundredGames).toBeCloseTo(4.0, 1)
    expect(hundredGames).toBeGreaterThan(tenGames)
  })

  it('more games with 40% WR scores higher than fewer games — more evidence, closer to true rate', () => {
    const tenGames = wilsonScore(4, 10)    // ~1.7
    const hundredGames = wilsonScore(40, 100) // ~3.1
    expect(hundredGames).toBeGreaterThan(tenGames)
  })

  it('more games with 60% WR scores higher than fewer games', () => {
    const tenGames = wilsonScore(6, 10)    // ~3.1
    const hundredGames = wilsonScore(60, 100) // ~5.0
    expect(hundredGames).toBeGreaterThan(tenGames)
  })
})
