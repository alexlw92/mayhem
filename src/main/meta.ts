import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { AugmentInfo } from '../backend/db'

export type { AugmentInfo }

const META_VERSION = 2

interface MetaCache {
  champions: Record<number, string>
  augments: Record<number, AugmentInfo>
  fetchedAt: number
  version?: number
}

let metaCache: MetaCache | null = null

function metaPath(): string {
  return path.join(app.getPath('userData'), 'mayhem-meta.json')
}

function loadMeta(): MetaCache {
  if (metaCache) return metaCache
  try {
    metaCache = JSON.parse(fs.readFileSync(metaPath(), 'utf-8'))
  } catch {
    metaCache = { champions: {}, augments: {}, fetchedAt: 0 }
  }
  return metaCache!
}

function saveMeta(): void {
  fs.writeFileSync(metaPath(), JSON.stringify(metaCache), 'utf-8')
}

export function isMetaStale(maxAgeHours = 24): boolean {
  const m = loadMeta()
  if ((m.version ?? 0) < META_VERSION) return true
  return Date.now() - m.fetchedAt > maxAgeHours * 3_600_000
}

export function clearMetaCache(): void {
  metaCache = null
}

export function saveMetaCache(
  champions: Record<number, string>,
  augments: Record<number, AugmentInfo>
): void {
  metaCache = { champions, augments, fetchedAt: Date.now(), version: META_VERSION }
  saveMeta()
}

export function getChampionCache(): Record<number, string> {
  return loadMeta().champions
}

export function getAugmentCache(): Record<number, AugmentInfo> {
  return loadMeta().augments
}
