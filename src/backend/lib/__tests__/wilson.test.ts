import { describe, it, expect } from 'vitest'
import { wilsonScore } from '../wilson'

describe('wilsonScore', () => {
  it('returns 5.0 with no data (neutral prior)', () => {
    expect(wilsonScore(0, 0)).toBeCloseTo(5.0, 3)
  })

  it('returns ~0.19 for 0% WR with 100 games (confirmed terrible)', () => {
    expect(wilsonScore(0, 100)).toBeCloseTo(0.19, 1)
  })

  it('returns ~9.82 for 100% WR with 100 games (confirmed great)', () => {
    expect(wilsonScore(100, 100)).toBeCloseTo(9.82, 1)
  })

  it('returns ~5.0 for 50% WR regardless of sample size', () => {
    expect(wilsonScore(5, 10)).toBeCloseTo(5.0, 1)
    expect(wilsonScore(50, 100)).toBeCloseTo(5.0, 1)
  })

  it('high picks amplifies penalty — 40% WR with 100 games scores lower than 40% WR with 10 games', () => {
    expect(wilsonScore(40, 100)).toBeLessThan(wilsonScore(4, 10))
  })

  it('high picks amplifies reward — 60% WR with 100 games scores higher than 60% WR with 10 games', () => {
    expect(wilsonScore(60, 100)).toBeGreaterThan(wilsonScore(6, 10))
  })
})
