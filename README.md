# Mayhem

A desktop app for tracking ARAM Mayhem stats across a friend group, built with Electron + React.

Pulls match history directly from the League Client (LCU API) and stores it in a local PostgreSQL database. No Riot API key required.

## Features

- **Dashboard** — win rates, KDA, damage, and gold across all tracked games
- **Champions** — per-champion stats for each player
- **Leaderboard** — ranked comparison across players
- **Augments** — augment pick rates and win rates
- **Trends** — performance over time with charts

## Tech Stack

- Electron + React + TypeScript
- Vite (via electron-vite)
- PostgreSQL + Drizzle ORM
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

3. Start the app (League Client must be running):
   ```
   npm run dev
   ```

The app auto-detects the League Client, reads your match history via the LCU API, and syncs it to the database on launch.
