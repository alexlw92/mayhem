# Wilson Score: Fix to True Lower Bound

**Date:** 2026-08-04
**Status:** Approved

## Problem

The current `wilsonScore` utility uses Laplace smoothing:

```typescript
(wins + 1.9208) / (n + 3.8416) * 10
```

For any fixed win rate, the constants cancel — a 60% WR champion scores ~6.0 whether they have 5 games or 500. Pick count has almost no effect. The Score column is effectively just win rate.

## Goal

The Score column should rank by confirmed performance. High pick count should amplify extremes: confirmed good performers rise, confirmed bad performers sink. Low pick count means uncertain — score sits lower regardless of observed WR. This lets users sort by Score and trust that champions at the top are genuinely strong, not just lucky over a small sample.

## Solution: Wilson Score Lower Bound

Replace with the standard Wilson score lower bound (95% confidence):

```
lower = (p̂ + z²/2n − z√(p̂(1−p̂)/n + z²/4n²)) / (1 + z²/n)
```

Where `p̂ = wins/n`, `z = 1.96`.

This answers: "Given the observed data, what is the worst plausible true win rate at 95% confidence?"

### Behavior

| Scenario | Old score | New score |
|---|---|---|
| 70% WR, 200 games | ~7.0 | ~6.2 |
| 70% WR, 10 games | ~7.0 | ~3.9 |
| 50% WR, 200 games | ~5.0 | ~4.4 |
| 50% WR, 10 games | ~5.0 | ~2.4 |
| 30% WR, 200 games | ~3.0 | ~2.2 |
| 30% WR, 10 games | ~3.0 | ~0.6 |
| 0 games | 5.0 | 0 |

## Implementation

### `src/backend/lib/wilson.ts`

```typescript
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
```

- `n === 0` returns `0`: no data sorts to the bottom
- Callers in `db.ts` use the same `(wins, n)` signature — no changes needed

### `src/backend/lib/__tests__/wilson.test.ts`

Rewrite to match new semantics:

- 0 games → 0
- 0% WR, 100 games → ~0
- 100% WR, 100 games → ~9.63
- 50% WR grows with sample size: 10 games → ~2.4, 100 games → ~4.0
- More games with low WR scores **higher** than fewer games with the same low WR (more evidence confirms ~40%, doesn't punish further)
- More games with high WR scores higher than fewer games with high WR (confirmed good)

## Verification

```
npx vitest run src/backend/lib/__tests__/wilson.test.ts
```
