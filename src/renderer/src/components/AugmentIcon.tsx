const RARITY_COLOR = ['#c0c0c0', '#f0b429', '#b44be1']  // silver, gold, prismatic

interface Props {
  id: number
  augments: Record<number, { name: string; iconPath: string; rarity: number }>
  size?: number
}

export default function AugmentIcon({ id, augments, size = 24 }: Props) {
  const info = augments[id]
  if (!info) return null
  const src = info.iconPath ?? ''
  const color = RARITY_COLOR[info.rarity] ?? RARITY_COLOR[0]

  return (
    <div
      title={info.name}
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        border: `1px solid ${color}`,
        overflow: 'hidden',
        flexShrink: 0,
        background: 'var(--bg-primary)',
        display: 'inline-flex'
      }}
    >
      {src && (
        <img
          src={src}
          alt={info.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      )}
    </div>
  )
}
