import { useState } from 'react'
import Augments from './Augments'
import Items from './Items'

type Tab = 'augments' | 'items'

interface Props {
  championId: number
  championName: string
  selectedPatches: string[] | null
  selectedMode?: number
  metaKey: number
  onBack: () => void
  onAugmentClick: (augmentId: number) => void
}

export default function ChampionDetail({ championId, championName, selectedPatches, selectedMode, metaKey, onBack, onAugmentClick }: Props) {
  const [tab, setTab] = useState<Tab>('augments')

  return (
    <div className="page-content">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 12,
            padding: '4px 10px',
          }}
        >
          ← Back
        </button>
        <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>{championName}</h2>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {(['augments', 'items'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              borderRadius: 0,
              color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 13,
              padding: '6px 14px',
              marginBottom: -1,
              textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'augments' && (
        <Augments
          selectedPatches={selectedPatches}
          selectedMode={selectedMode}
          initialChampionId={championId}
          onMounted={() => {}}
          onAugmentClick={(id) => onAugmentClick(id)}
        />
      )}

      {tab === 'items' && (
        <Items championId={championId} selectedPatches={selectedPatches} selectedMode={selectedMode} metaKey={metaKey} />
      )}
    </div>
  )
}
