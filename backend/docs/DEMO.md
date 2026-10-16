# Nuudeltsgeey first demo

This is the minimal, repeatable demo. It uses the configured PostgreSQL database and does not modify tournament matches.

## Start

From `backend/`:

```sh
npm run dev
```

The demo server runs at `http://localhost:3000`.

## Walkthrough

1. Open `/` to show the Mongolian CS2 homepage and nine visual rank emblems.
2. Open `/leaderboard` to show public NR standings and player rank emblems.
3. Open `/tournaments` and select Tournament #001.
4. Show the bracket: Khan Legion has a locked win and has advanced to the semifinal slot.
5. Open `/player/NMD-000011` to show the public profile, match history, and `+12 NR` rating transaction.
6. Open `/admin` and show the protected operations dashboard.

Admin demo credentials are the seeded development credentials. Keep them local and never use them in production.

## Automated smoke check

With the server running, from `backend/` run:

```sh
npm run demo:smoke
```

The smoke check validates the homepage, public pages, health endpoint, leaderboard, tournament list/detail, and player history APIs. It is read-only.

## Current demo state

- Tournament #001 has 8 approved teams and locked rosters.
- All 8 teams are checked in.
- The bracket contains 7 matches.
- The first round-of-eight match is locked.
- Khan Legion is advanced into the first semifinal slot.
- Remaining matches are intentionally left ready or pending for a live demonstration.
