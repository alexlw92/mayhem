import { useState, useEffect } from 'react'
import { Player } from '../App'
import AugmentIcon from '../components/AugmentIcon'
import './Dashboard.css'

const api = (window as any).api

interface Participant {
  puuid: string
  summonerName: string
  championId: number
  championName: string
  teamId: number
  win: boolean
  kills: number
  deaths: number
  assists: number
  damageDealt: number
  augments: number[]
}

interface MatchView {
  gameId: number
  gameCreation: number
  gameDuration: number
  participants: Participant[]
}

interface AugmentInfo {
  name: string
  iconPath: string
  rarity: number
}

interface PlayerStats {
  puuid: string
  summonerName: string
  games: number
  wins: number
  kills: number
  deaths: number
  assists: number
  avgDamage: number
}

function kda(kills: number, deaths: number, assists: number): string {
  if (deaths === 0) return 'Perfect'
  return ((kills + assists) / deaths).toFixed(2)
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const d = Math.floor(diff / 86_400_000)
  const h = Math.floor(diff / 3_600_000)
  if (d > 0) return `${d}d ago`
  if (h > 0) return `${h}h ago`
  return 'Just now'
}

interface Props {
  selectedPuuid: string | null
  selectedPlayer: Player | null
}

export default function Dashboard({ selectedPuuid, selectedPlayer }: Props) {
  const [matches, setMatches] = useState<MatchView[]>([])
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null)
  const [allPlayerStats, setAllPlayerStats] = useState<PlayerStats[]>([])
  const [augments, setAugments] = useState<Record<number, AugmentInfo>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.db.augmentCache().then(setAugments)
  }, [])

  useEffect(() => {
    setLoading(true)
    if (selectedPuuid) {
      Promise.all([
        api.db.recentMatches(20, selectedPuuid),
        api.db.playerStats()
      ]).then(([m, allStats]: [MatchView[], PlayerStats[]]) => {
        setMatches(m)
        setPlayerStats(allStats.find((s) => s.puuid === selectedPuuid) ?? null)
        setAllPlayerStats([])
        setLoading(false)
      })
    } else {
      Promise.all([
        api.db.recentMatches(20),
        api.db.playerStats()
      ]).then(([m, allStats]: [MatchView[], PlayerStats[]]) => {
        setMatches(m)
        setPlayerStats(null)
        setAllPlayerStats(allStats)
        setLoading(false)
      })
    }
  }, [selectedPuuid])

  if (loading) return <div className="empty-state"><div className="loader" /></div>

  const title = selectedPlayer ? selectedPlayer.summonerName : 'All Players'

  return (
    <div>
      <h1 className="page-title">{title}</h1>

      {/* Stat cards */}
      {selectedPuuid && playerStats ? (
        <div className="grid-4">
          <div className="card stat-card">
            <div className="card-title">Games</div>
            <div className="stat-value">{playerStats.games}</div>
            <div className="stat-label">{playerStats.wins}W {playerStats.games - playerStats.wins}L</div>
          </div>
          <div className="card stat-card">
            <div className="card-title">Win Rate</div>
            <div className={`stat-value ${playerStats.wins / playerStats.games >= 0.5 ? 'win' : 'loss'}`}>
              {((playerStats.wins / playerStats.games) * 100).toFixed(1)}%
            </div>
            <div className="stat-label">
              {((playerStats.wins / playerStats.games) >= 0.5 ? 'Above' : 'Below')} 50%
            </div>
          </div>
          <div className="card stat-card">
            <div className="card-title">Avg KDA</div>
            <div className="stat-value kda">
              {kda(playerStats.kills, playerStats.deaths, playerStats.assists)}
            </div>
            <div className="stat-label">
              {(playerStats.kills / playerStats.games).toFixed(1)} /&nbsp;
              {(playerStats.deaths / playerStats.games).toFixed(1)} /&nbsp;
              {(playerStats.assists / playerStats.games).toFixed(1)}
            </div>
          </div>
          <div className="card stat-card">
            <div className="card-title">Avg Damage</div>
            <div className="stat-value">{(playerStats.avgDamage / 1000).toFixed(1)}k</div>
            <div className="stat-label">Per game</div>
          </div>
        </div>
      ) : allPlayerStats.length > 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">All Players</div>
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Games</th>
                <th>Win Rate</th>
                <th>Avg KDA</th>
                <th>KDA Ratio</th>
                <th>Avg Damage</th>
              </tr>
            </thead>
            <tbody>
              {allPlayerStats.map((p) => (
                <tr key={p.puuid}>
                  <td className="summoner-name">{p.summonerName}</td>
                  <td>{p.games}</td>
                  <td>
                    <span className={p.wins / p.games >= 0.5 ? 'win' : 'loss'}>
                      {((p.wins / p.games) * 100).toFixed(1)}%
                    </span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 12 }}>
                      {p.wins}W {p.games - p.wins}L
                    </span>
                  </td>
                  <td className="kda" style={{ fontSize: 13 }}>
                    {(p.kills / p.games).toFixed(1)} / {(p.deaths / p.games).toFixed(1)} / {(p.assists / p.games).toFixed(1)}
                  </td>
                  <td className="kda">{kda(p.kills, p.deaths, p.assists)}</td>
                  <td>{(p.avgDamage / 1000).toFixed(1)}k</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Recent matches */}
      <div className="card-title" style={{ marginBottom: 8 }}>Recent Games</div>
      {matches.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div>No games yet</div>
            <p>Open the League client and click Sync Now</p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {matches.map((match) => (
            <MatchCard
              key={match.gameId}
              match={match}
              selectedPuuid={selectedPuuid}
              augments={augments}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MatchCard({
  match,
  selectedPuuid,
  augments
}: {
  match: MatchView
  selectedPuuid: string | null
  augments: Record<number, AugmentInfo>
}) {
  const blue = match.participants.filter((p) => p.teamId === 100)
  const red = match.participants.filter((p) => p.teamId === 200)
  const blueWon = blue[0]?.win ?? false

  // If a player is selected, show their team first
  const selectedTeamId = selectedPuuid
    ? match.participants.find((p) => p.puuid === selectedPuuid)?.teamId
    : null
  const [teamA, teamB] =
    selectedTeamId === 200 ? [red, blue] : [blue, red]
  const teamAWon = selectedTeamId === 200 ? !blueWon : blueWon

  return (
    <div className="card match-card">
      <div className="match-header">
        <span className={`result-badge ${teamAWon ? 'win' : 'loss'}`}>
          {teamAWon ? 'WIN' : 'LOSS'}
        </span>
        <span className="match-meta">{formatDuration(match.gameDuration)}</span>
        <span className="match-meta time-ago">{timeAgo(match.gameCreation)}</span>
      </div>
      <div className="match-teams">
        <TeamTable
          participants={teamA}
          won={teamAWon}
          selectedPuuid={selectedPuuid}
          augments={augments}
        />
        <div className="team-divider" />
        <TeamTable
          participants={teamB}
          won={!teamAWon}
          selectedPuuid={selectedPuuid}
          augments={augments}
        />
      </div>
    </div>
  )
}

function TeamTable({
  participants,
  won,
  selectedPuuid,
  augments
}: {
  participants: Participant[]
  won: boolean
  selectedPuuid: string | null
  augments: Record<number, AugmentInfo>
}) {
  return (
    <table className="team-table">
      <tbody>
        {participants.map((p) => {
          const isSelected = p.puuid === selectedPuuid
          return (
            <tr key={p.puuid} className={isSelected ? 'selected-player' : ''}>
              <td className="champ-cell" style={{ width: 28 }}>
                <ChampIcon championId={p.championId} name={p.championName} />
              </td>
              <td className="summoner-name" style={{ minWidth: 90, maxWidth: 120 }}>
                {p.summonerName}
              </td>
              <td>
                <div style={{ display: 'flex', gap: 2 }}>
                  {p.augments.map((id) => (
                    <AugmentIcon key={id} id={id} augments={augments} size={18} />
                  ))}
                </div>
              </td>
              <td className="kda" style={{ whiteSpace: 'nowrap' }}>
                {p.kills}/{p.deaths}/{p.assists}
              </td>
              <td style={{ color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                {(p.damageDealt / 1000).toFixed(1)}k
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ChampIcon({ championId, name }: { championId: number; name: string }) {
  return (
    <img
      src={`mayhem-asset://champion-icons/${championId}.png`}
      alt={name}
      className="champ-icon"
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )
}
