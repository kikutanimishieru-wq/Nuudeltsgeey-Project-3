# Investor demo script

## Positioning

Nuudeltsgeey is a Mongolian competitive identity and tournament operations platform. It gives players a persistent public record while giving cafés and organizers a reliable workflow for teams, brackets, results, rankings, and audit history.

## Five-minute walkthrough

1. Start at `/investor` and explain the opportunity, current working data, and the three product pillars: identity, operations, and Mongolian competitive culture.
2. Open `/` to show the branded experience and nine-rank Mongolian visual hierarchy.
3. Open `/leaderboard` to show public NMD IDs, current NR, floors, and player records.
4. Open `/tournaments/a936c6b4-5e6e-42d2-9945-bfd2f45b55d0` to show Tournament #001, approved teams, and bracket advancement.
5. Open `/player/NMD-000011` to show a public player profile, a locked match, and the `+12 NR` transaction.
6. Open `/admin` to show protected tournament operations: check-ins, locked rosters, bracket state, and admin-only result handling.

## What to say clearly

- This is a functional prototype with real PostgreSQL persistence.
- The displayed records are synthetic demo data.
- NR calculations and floor protection are implemented without exposing private identity data.
- Captain disputes, identity verification providers, file uploads, and production hardening are planned next; they are not represented as complete today.

## Before a public link

Deploy the backend with a production database environment, rotate all demo credentials, enable backups and monitoring, and keep the investor demo dataset free of real personal information.
