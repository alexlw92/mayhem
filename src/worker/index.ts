import os from 'os'
import { importGamesForPuuid, setChampionNames } from '../main/sync'
import { apiClient } from '../main/apiClient'
import { isClientRunning } from '../main/lcu'

const CLIENT_ID = `worker-${os.hostname()}-${process.pid}`
const POLL_INTERVAL_MS = 15_000

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function loadChampionNames() {
  try {
    const names = await apiClient.championCache()
    setChampionNames(names)
    console.log(`[worker] loaded ${Object.keys(names).length} champion names`)
  } catch (err: any) {
    console.warn('[worker] failed to load champion names:', err?.message)
  }
}

async function run() {
  console.log(`[worker] starting clientId=${CLIENT_ID}`)
  console.log(`[worker] backend: ${process.env.BACKEND_URL ?? 'http://localhost:3847'}`)

  await loadChampionNames()
  setInterval(loadChampionNames, 60 * 60 * 1000)

  while (true) {
    if (!isClientRunning()) {
      console.log('[worker] LCU not running, waiting...')
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    let puuid: string | null = null
    try {
      const res = await apiClient.claimNextJob(CLIENT_ID)
      puuid = res.puuid
    } catch (err: any) {
      console.warn('[worker] failed to poll queue:', err?.message)
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    if (!puuid) {
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    const short = puuid.slice(0, 8)
    console.log(`[worker] syncing ${short}...`)
    try {
      const { imported, fetchFailed } = await importGamesForPuuid(puuid)
      if (fetchFailed) {
        console.warn(`[worker] no ARAM history for ${short}`)
      } else {
        console.log(`[worker] imported ${imported} games for ${short}`)
      }
      await apiClient.completeJob(puuid)
    } catch (err: any) {
      console.error(`[worker] error syncing ${short}:`, err?.message)
      await apiClient.failJob(puuid).catch(() => {})
    }
  }
}

run().catch(err => {
  console.error('[worker] fatal:', err)
  process.exit(1)
})
