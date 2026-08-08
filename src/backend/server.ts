import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import pinoHttp from 'pino-http'
import { logger } from './logger'
import { recordRequest } from './metrics'
import { createStatsRouter, StatsOptions } from './routes/stats'
import { createSyncRouter } from './routes/sync'
import { createMetaRouter, MetaOptions } from './routes/meta'

export type AppOptions = MetaOptions & StatsOptions

export function createExpressApp(opts: AppOptions = {}) {
  const app = express()

  // Log every request to file
  app.use(pinoHttp({ logger }))

  // Record metrics on response finish (req.route is set by this point)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    res.on('finish', () => {
      const route = req.route?.path ?? req.path
      recordRequest(req.method, route, res.statusCode, Date.now() - start)
    })
    next()
  })

  app.use(cors())
  app.use(express.json({ limit: '2mb' }))
  app.get('/health', (_req, res) => res.json({ ok: true }))
  if (process.env.API_KEY) {
    app.use((req, res, next) => {
      if (req.headers['x-api-key'] !== process.env.API_KEY) {
        return res.status(401).json({ error: 'unauthorized' })
      }
      next()
    })
  }
  app.use('/api', createStatsRouter(opts))
  app.use('/api', createSyncRouter())
  app.use('/api', createMetaRouter(opts))

  // Global error handler — catches unhandled async errors in route handlers
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err, req: { method: req.method, url: req.url } }, 'unhandled route error')
    console.error(`[api] ${req.method} ${req.url} —`, err instanceof Error ? err.message : err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return app
}
