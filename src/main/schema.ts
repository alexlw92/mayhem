import { pgTable, serial, integer, bigint, text, boolean } from 'drizzle-orm/pg-core'

export const matches = pgTable('matches', {
  gameId:       bigint('gameId', { mode: 'number' }).primaryKey(),
  queueId:      integer('queueId').notNull(),
  gameCreation: bigint('gameCreation', { mode: 'number' }).notNull(),
  gameDuration: integer('gameDuration').notNull(),
  gameVersion:  text('gameVersion'),
})

export const participants = pgTable('participants', {
  id:           serial('id').primaryKey(),
  gameId:       bigint('gameId', { mode: 'number' }).notNull().references(() => matches.gameId),
  puuid:        text('puuid').notNull(),
  summonerName: text('summonerName').notNull(),
  championId:   integer('championId').notNull(),
  championName: text('championName').notNull(),
  teamId:       integer('teamId').notNull(),
  win:          boolean('win').notNull(),
  kills:        integer('kills').notNull(),
  deaths:       integer('deaths').notNull(),
  assists:      integer('assists').notNull(),
  damageDealt:  integer('damageDealt').notNull(),
  damageTaken:  integer('damageTaken').notNull(),
  goldEarned:   integer('goldEarned').notNull(),
  champLevel:   integer('champLevel').notNull(),
})

export const participantAugments = pgTable('participant_augments', {
  participantId: integer('participantId').notNull().references(() => participants.id),
  augmentId:     integer('augmentId').notNull(),
})

export const playerSyncTimes = pgTable('player_sync_times', {
  puuid:    text('puuid').primaryKey(),
  syncedAt: bigint('syncedAt', { mode: 'number' }).notNull(),
})
