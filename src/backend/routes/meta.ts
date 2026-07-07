import { Router, Request, Response } from 'express'
import type { AugmentInfo } from '../db'

export interface MetaOptions {
  getChampions?: () => Record<number, string>
  getAugments?: () => Record<number, AugmentInfo>
}

export function createMetaRouter(opts: MetaOptions = {}): Router {
  const router = Router()

  router.get('/meta/champions', (_req: Request, res: Response) => {
    res.json(opts.getChampions?.() ?? {})
  })

  router.get('/meta/augments', (_req: Request, res: Response) => {
    res.json(opts.getAugments?.() ?? {})
  })

  return router
}
