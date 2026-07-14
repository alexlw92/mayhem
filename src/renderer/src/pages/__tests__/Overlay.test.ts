import { describe, it, expect } from 'vitest'
import { matchAugments } from '../ocrUtils'

describe('matchAugments', () => {
  it('matches exact augment names case-insensitively', () => {
    const cache = {
      1: { name: 'Ultimate Unstoppable' },
      2: { name: 'Purist - Caster' },
      3: { name: 'Mighty Shield' },
    }
    const text = 'ultimate unstoppable\npurist caster\nmighty shield'
    expect(matchAugments(text, cache)).toEqual([1, 2, 3])
  })

  it('returns empty when no names match', () => {
    const cache = { 1: { name: 'Iron Will' } }
    expect(matchAugments('some random text', cache)).toEqual([])
  })

  it('stops at 3 matches', () => {
    const cache = { 1: { name: 'Alpha' }, 2: { name: 'Beta' }, 3: { name: 'Gamma' }, 4: { name: 'Delta' } }
    expect(matchAugments('alpha beta gamma delta', cache)).toHaveLength(3)
  })

  it('skips names shorter than 3 characters', () => {
    const cache = { 1: { name: 'AB' }, 2: { name: 'Iron Will' } }
    expect(matchAugments('ab iron will', cache)).toEqual([2])
  })

  it('does not double-match a longer name via a shorter substring', () => {
    const cache = {
      1: { name: 'Apex' },
      2: { name: 'Apex Inventor' },
      3: { name: 'Magic Missile' },
      4: { name: 'Upgrade Infinity Edge' },
    }
    const text = 'apex inventor\nmagic missile\nupgrade infinity edge'
    const result = matchAugments(text, cache)
    expect(result).toHaveLength(3)
    expect(result).toContain(2)
    expect(result).toContain(3)
    expect(result).toContain(4)
    expect(result).not.toContain(1)
  })
})

describe('OCR from screenshot', () => {
  it('detects the three augments visible in the augment-select fixture', async () => {
    const { createWorker } = await import('tesseract.js')
    const { join } = await import('path')

    const imgPath = join(__dirname, 'fixtures/augment-select.png')
    const worker = await createWorker('eng', 1, { logger: () => {} })
    const { data: { text } } = await worker.recognize(imgPath)
    await worker.terminate()

    const cache = {
      1: { name: 'Ultimate Unstoppable' },
      2: { name: 'Purist - Caster' },
      3: { name: 'Mighty Shield' },
    }
    const detected = matchAugments(text, cache)
    expect(detected).toHaveLength(3)
    expect(detected).toContain(1)
    expect(detected).toContain(2)
    expect(detected).toContain(3)
  }, 60_000)
})
