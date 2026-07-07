import express from 'express'
import cors from 'cors'
import { createStatsRouter, StatsOptions } from './routes/stats'
import syncRouter from './routes/sync'
import { createMetaRouter, MetaOptions } from './routes/meta'

export type AppOptions = MetaOptions & StatsOptions

export function createExpressApp(opts: AppOptions = {}) {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '2mb' }))
  app.use('/api', createStatsRouter(opts))
  app.use('/api', syncRouter)
  app.use('/api', createMetaRouter(opts))
  return app
}
