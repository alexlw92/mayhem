# Mayhem TODO

## Augment Stats Page
Show augment pick rates, win rates, and frequency across all tracked games.
- Use augment cache (already in DB) to resolve names and icons
- Support filtering by player
- Show rarity (silver/gold/prismatic) breakdown

## Better Sync Logging
Clearer per-player progress during sync.
- Show new vs already-stored count separately
- Surface fetch failures distinctly
- Cleaner final summary message

## Filter by Patch
Filter all stat views by patch.
- Store patch version per match at import time (from LCU `gameVersion` field)
- Add patch selector to UI
- Apply filter across dashboard, champion stats, leaderboard, trends

## Group Stats by Role
Break down stats by champion class (mage, tank, assassin, etc.) derived from DDragon/CDragon data. Shows how players perform across different playstyles.

## Periodic Full Sync (every 8 hours)
Auto-trigger a full BFS sync every 8 hours so all known players stay up to date without manual intervention. Current auto-poll only checks the logged-in summoner incrementally.

## Favorite Players
Star/favorite specific players.
- Favorites appear at top of player dropdown
- Visual highlight in dropdown and leaderboard
- Persist favorites across sessions
