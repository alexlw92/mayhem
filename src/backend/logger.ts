import pino from 'pino'

const logFile = process.env.MAYHEM_LOG_FILE
const level = process.env.NODE_ENV === 'test'
  ? 'silent'
  : process.env.NODE_ENV === 'production'
    ? 'info'
    : 'debug'

export const logger = logFile
  ? pino({ level }, pino.transport({
      target: 'pino-roll',
      options: { file: logFile, size: '10m', limit: { count: 3 } },
    }))
  : pino({ level })
