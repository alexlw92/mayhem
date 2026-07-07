// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

afterEach(() => cleanup())
import AugmentIcon from '../AugmentIcon'

const cache = {
  1: { name: 'Iron Will',    iconPath: 'mayhem-asset://augment-icons/1.png', rarity: 0 },
  2: { name: 'Gold Rush',    iconPath: 'mayhem-asset://augment-icons/2.png', rarity: 1 },
  3: { name: 'Prismatic Eye', iconPath: 'mayhem-asset://augment-icons/3.png', rarity: 2 },
  4: { name: 'No Icon',      iconPath: '', rarity: 0 },
}

describe('AugmentIcon', () => {
  it('renders nothing when augment id is not in cache', () => {
    const { container } = render(<AugmentIcon id={999} augments={cache} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders silver augment with correct name and icon', () => {
    const { container } = render(<AugmentIcon id={1} augments={cache} />)
    expect(container).toMatchSnapshot()
  })

  it('renders gold augment with gold border color', () => {
    const { container } = render(<AugmentIcon id={2} augments={cache} />)
    expect(container).toMatchSnapshot()
  })

  it('renders prismatic augment with prismatic border color', () => {
    const { container } = render(<AugmentIcon id={3} augments={cache} />)
    expect(container).toMatchSnapshot()
  })

  it('renders container but no img when iconPath is empty', () => {
    const { container, queryByRole } = render(<AugmentIcon id={4} augments={cache} />)
    expect(queryByRole('img')).toBeNull()
    expect(container.firstChild).not.toBeNull()
  })

  it('respects custom size prop', () => {
    const { container } = render(<AugmentIcon id={1} augments={cache} size={48} />)
    const div = container.firstChild as HTMLElement
    expect(div.style.width).toBe('48px')
    expect(div.style.height).toBe('48px')
  })
})
