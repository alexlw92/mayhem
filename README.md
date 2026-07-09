# Mayhem

A desktop app for tracking ARAM Mayhem stats across a friend group, built with Electron + React.

Pulls match history directly from the League Client (LCU API) and stores it in a PostgreSQL database. No Riot API key required.

## Features

- **Dashboard** — win rates, KDA, damage, and gold across all tracked games
- **Champions** — per-champion stats for each player
- **Leaderboard** — ranked comparison across players
- **Augments** — augment pick rates and win rates
- **Trends** — performance over time with charts
- **Live Game** — real-time stats for everyone in your current game

## Tech Stack

- Electron + React + TypeScript
- Vite (via electron-vite)
- PostgreSQL (postgres.js)
- Recharts

## Setup

**Prerequisites:** Node.js, PostgreSQL

1. Clone the repo and install dependencies:
   ```
   npm install
   ```

2. Create a `.env` file in the project root:
   ```
   DATABASE_URL=postgres://user:password@localhost:5432/mayhem
   ```

   See [Environment variables](#environment-variables) for the full reference.

## Running locally

Two processes must run together. Both read from the same `.env` file in the project root, so `API_KEY` (if set) is automatically shared between them.

**Backend** (terminal 1):
```
npm run server:build
npm run server:start
```
Starts the Express API on port 3847. Reads `DATABASE_URL` and `API_KEY` from `.env`.

**Electron app** (terminal 2):
```
npm run dev
```
Opens the desktop app with hot reload. Reads `BACKEND_URL` (defaults to `http://localhost:3847`) and `API_KEY` from `.env` at startup.

League Client must be running for sync to work.

## Sync-only worker

The standalone worker runs headlessly on the Windows EC2 VM to process the sync queue without the full Electron UI.

```
npm run worker:build
npm run worker:start
```

Reads `BACKEND_URL` and `API_KEY` from `.env`. Polls the backend queue every 15 seconds and imports games via the League Client.

## Deployment

Deployment targets the EC2 backend. The Electron app is distributed separately as a desktop installer.

**Automatic deploys:** Push to `master` → GitHub Actions SSHs into the EC2 instance, pulls latest, runs `npm install && npm run server:build`, and restarts via `pm2 restart mayhem-server`.

**Required GitHub secrets:** `EC2_HOST`, `EC2_SSH_KEY`

**First-time EC2 setup:**
1. Clone the repo on the instance
2. Create a `.env` with `DATABASE_URL`, `API_KEY`, and `PORT`
3. `npm install && npm run server:build`
4. `pm2 start dist-server/server-entry.js --name mayhem-server`
5. `pm2 save`

After that, every push to `master` redeploys automatically.

## Creating a new release

Releases are Windows portable executables distributed via GitHub Releases. The app uses `electron-updater` to auto-detect new versions.

1. Bump the version in `package.json`
2. Build the distributable:
   ```
   npm run dist
   ```
   Outputs a portable `.exe` and `latest.yml` to `dist-electron/`.
3. Create a GitHub release tagged with the version (e.g. `v1.2.0`)
4. Upload the `.exe` and `latest.yml` as release assets
5. Running instances will detect the new version on next launch and prompt to update

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string used by the backend |
| `TEST_DATABASE_URL` | For tests | — | Separate DB that gets wiped before each test run |
| `API_KEY` | Optional | — | Shared secret for backend auth; omit to disable auth |
| `BACKEND_URL` | Optional | `http://localhost:3847` | URL the Electron app and worker use to reach the backend |
| `PORT` | Optional | `3847` | Port the backend server listens on |
