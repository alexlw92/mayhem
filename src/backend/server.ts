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

  const SLOW_REQUEST_MS = 30_000

  // Record metrics on response finish (req.route is set by this point)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    let recorded = false
    const record = (status: number) => {
      if (recorded) return
      recorded = true
      const route = req.route ? req.baseUrl + req.route.path : req.path
      if (req.method === 'GET' && route === '/api/metrics') return
      recordRequest(req.method, route, status, Date.now() - start)
    }
    res.on('finish', () => {
      const ms = Date.now() - start
      // Treat slow-but-successful responses as gateway timeouts
      const status = res.statusCode < 500 && ms >= SLOW_REQUEST_MS ? 504 : res.statusCode
      record(status)
    })
    res.on('close', () => {
      // Client disconnected before response was sent
      if (!res.writableEnded) record(499)
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

  // Global error handler — receives errors forwarded via next(err) from route handlers
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err, req: { method: req.method, url: req.url } }, 'unhandled route error')
    console.error(`[api] ${req.method} ${req.url} —`, err instanceof Error ? err.message : err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return app
}
