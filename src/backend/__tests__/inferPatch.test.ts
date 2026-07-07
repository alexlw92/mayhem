import { describe, it, expect } from 'vitest'
import { inferPatch } from '../db'

const ts = (iso: string) => new Date(iso).getTime()

describe('inferPatch', () => {
  it('returns undefined for timestamps before the first known patch', () => {
    expect(inferPatch(ts('2023-01-01T00:00:00Z'))).toBeUndefined()
  })

  it('returns the correct patch for a timestamp exactly at the boundary', () => {
    expect(inferPatch(ts('2024-01-10T12:00:00Z'))).toBe('14.1')
  })

  it('returns the correct patch mid-patch', () => {
    // Between 14.1 (Jan 10) and 14.2 (Jan 24)
    expect(inferPatch(ts('2024-01-15T00:00:00Z'))).toBe('14.1')
  })

  it('advances to the next patch at the boundary', () => {
    expect(inferPatch(ts('2024-01-24T12:00:00Z'))).toBe('14.2')
  })

  it('handles the season-year rollover (14 → 15)', () => {
    expect(inferPatch(ts('2025-01-10T00:00:00Z'))).toBe('15.1')
  })

  it('handles the season-year rollover (15 → 16)', () => {
    expect(inferPatch(ts('2026-01-10T00:00:00Z'))).toBe('16.1')
  })

  it('returns the last known patch for future timestamps', () => {
    expect(inferPatch(ts('2099-01-01T00:00:00Z'))).toBe('16.13')
  })
})
