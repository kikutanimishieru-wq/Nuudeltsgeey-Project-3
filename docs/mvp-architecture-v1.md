# Nuudeltsgeey — MVP Technical Architecture v1

Platform: eNomad Arena  
Movement: Nuudeltsgeey  
Law Engine: Ikh Zasag  
Stage: MVP (First Working System)

> Architecture proposal supplied by the project owner, reformatted for readability. This document specifies the target MVP, not the capabilities of the current browser-local prototype.

## 1. MVP Principles

Simple, fast to build, cheap, scalable later, and solo-friendly. No crypto or heavy blockchain. Updated scope includes partner-café Counter-Strike server data and upgradeable AI performance monitoring; integration is pending.

Build identity, location verification, tournament flow, rank calculation, badges, token points, and profiles first.

---

## 2. MVP Core Modules

Seven main systems: Client App → API Gateway → Auth + Profile Service → Tournament Engine → Ikh Zasag Rank Engine → Token System → Data Storage.

---

## 3. Client Layer (Frontend)

Web app (PWA) first; mobile later. Proposed tools: React / Next.js, Tailwind CSS, Firebase Auth UI, and a camera-based QR scanner.

Functions: Register/login, create badge, join tournament, scan QR, see rank, tokens and history, profile page, and tournament lobby.

Target routes: /arena, /profile, /tournaments, /badge, /clan, /rank, /wallet. Everything must work in the browser first.

---

## 4. Backend Layer (API)

Node.js with Express / Fastify, or Firebase Functions.

Auth Service: Email, Google, and Apple login; device ID. Store user ID, badge ID, location, clan, and role.

Profile Service: Name, gamer tag, clan, role, rank, tokens, stickers, and QR. GET /profile; POST /profile/update.

Tournament Service: Create, join, shuffle teams, start/end matches, verify location, award tokens, and update rank. POST /tournament/create; POST /tournament/join; POST /tournament/start; POST /tournament/finish.

Location Verification: Proposed signals are GPS, WiFi fingerprint, IP range, and QR check-in. Small events → GPS; big events → same WiFi; large events → QR + WiFi. Proposed rule: allow when players share WiFi and location; otherwise reject. Later: Bluetooth, NFC, device signatures.

Ikh Zasag Rank Engine: Inputs are opponent rank, match result, participation, streak, and tournament size. rankGain = base + opponentStrength × factor + tournamentSize × factor + streakBonus. rankLoss = opponentStrength × penalty. First floors: no loss, only gain. Higher floors: gain and drop. Store rank tier, history, and floor.

Token Engine: Points, not crypto. Track earned, spent, locked, and bonus. Actions: Entry, win, streak, participation, and penalty. POST /token/earn; POST /token/spend; GET /token/balance.

Badge System: Digital identity card with badge ID, QR, rank, clan, role, stickers, and history. QR links to /profile/{badgeId}. MVP requests dynamic QR and rejects static screenshot check-in. Animated and time-based QR appear in the later-stage proposal.

---

## 5. Database Layer

Choose Firebase Firestore or PostgreSQL + Prisma. Collections/entities: users, badges, tournaments, matches, ranks, tokens, clans, cafes, stickers.

User { id, badgeId, name, clan, role, rank, tokens, location }

Tournament { id, hostCafe, players[], size, status, result }

---

## 6. Security Layer

MVP protections requested: Anti-cheat flags, duplicate-device detection, location-spoof detection, screenshot QR invalidation, and match-history audit.

Rules: One badge = one device; QR refresh every X seconds; IP + GPS combined; manual admin review. AI analysis is now planned for the MVP. The café server data source and analysis implementation are not connected; game-client anti-tampering remains later-stage.

---

## 7. Streaming & Media Layer (Later MVP+)

Plan stream links, YouTube / Twitch embeds, replay storage, and caster profiles. For MVP, just store the stream URL.

---

## 8. Infrastructure

Proposed hosting: Vercel frontend, Firebase backend and database, or Supabase.

Example stack: Next.js + Tailwind frontend; Firebase Functions backend; Firebase Auth; Firestore; Firebase Storage; Vercel hosting; JavaScript QR library.

---

## 9. Data Flow Example

Login → Scan QR → Verify location → Join lobby → Match starts → Result submitted → Rank engine runs → Token awarded → Badge updated.

---

## 10. MVP Feature Scope

Build: Login, profile, badge, tournament creation/joining, location verification, rank update, token points, QR profile, and history page.

Exclude: Blockchain, payments, NFTs, and a full mobile app. Partner-café Counter-Strike performance monitoring and upgradeable AI analysis are now in the planned MVP; recruitment AI remains later-stage.

---

## 11. Scaling Path

Phase 2: Native mobile app, café dashboard, admin panel, advanced anti-cheat, and streaming tools.

Phase 3: Token payments, sponsor APIs, league engine, and analytics.

Phase 4: Internationalization, AI scouting, blockchain wallet, and API marketplace.

---

## 12. Solo Developer Execution Stack

Candidate tools: Next.js, Firebase, Tailwind, Prisma, Supabase, GitHub, and Vercel.

Daily loop: Build → Test → Café trial → Fix → Repeat.

---

## 13. MVP Success Definition

Cafés run tournaments; players get badges; rank moves; tokens work; profiles are shareable; the community uses it daily.

Success is not when it looks perfect.

---

## 14. Architecture Philosophy

Not casino. Not social media. Not blockchain hype. Identity + Arena + Data + Culture.

You are building Mongolia’s digital arena infrastructure. Start small. Ship fast. Test in cafés. Let warriors shape the system.

## Implementation notes (added during integration)

These notes clarify implementation constraints; they are separate from the supplied architecture.

- Choose one backend stack. Firebase Auth + Functions + Firestore is the proposed default; PostgreSQL + Prisma / Supabase is an alternative. The repository has not been migrated to either.
- Browser applications cannot directly inspect WiFi SSID/BSSID. GPS requires permission and secure hosting. Café network verification needs a server-observed network signal or café-managed verification service; a shared IP alone is insufficient proof of presence.
- Keep public profile QR URLs separate from signed, short-lived, single-use check-in challenges bound to an event and user. Refreshing an image alone does not invalidate screenshots; expiry and replay rejection require server validation. The requested expiry interval is unspecified.
- Browser device identifiers can be cleared or copied. GPS can be spoofed. Treat these as signals and support manual review and legitimate device replacement.
- Rank and token operations must be authenticated, authorized, validated, and executed server-side. Token earn is for trusted result processing, not arbitrary client rewards. Finish operations need idempotency and atomic ledger/rank updates.
- Define venue radii, network enrollment, QR expiry, rank factors, floor thresholds, streak rules, reward limits, sanction review, and device recovery before enforcement.

## Current implementation and next build order

Current: local profile editing, badge preview, local tournament creation/entry, demo token ledger, sample rankings, and browser-local registration history. No backend endpoints listed above exist yet. Current routes are hash-based and do not yet implement shared profile URLs or a PWA.

1. Establish Next.js/Tailwind and one backend environment; preserve the current visual design.
2. Add authentication, server-authorized profiles, badge IDs, and persistent storage.
3. Implement host permissions, tournament lifecycle, five-starter plus one-substitute roster limits, and atomic entry transactions.
4. Add café check-in, geolocation consent, expiring QR challenges, audit records, and incident review.
5. Implement bracket generation, approved and locked match results, protected-floor rules, the configurable ranking policy in `ranking.js`, and idempotent rank/token awards.
6. Add shareable profiles, history, PWA installability, and a café trial with multiple devices.

Success requires a real café to complete this flow with multiple authenticated players. The documentation and frontend preview alone do not satisfy that milestone.

## Bracket engine and Arena Days addendum

Follow the [Ikh Zasag fairness rules](./ikh-zasag-rulebook.md) and [Tournament Operations Manual](./tournament-operations.md). Configuration must include tournament style, match format, map pool, entry type, rank-weight policy, stake policy, and verification level.

The authoritative bracket engine exclusively generates seeds, pairings, and progression. Freeze verified entrants and rules at generation; persist the draw, policy version, and audit trail. Reject arbitrary opponent assignments and repeated generation intended to reroll a draw. Exact pairing algorithms remain to be specified for each style. Token Battle stays outside the points-only MVP.

Major events must reference a designated Arena Day. Proposed records include category (fixed/surprise/seasonal), meaning, announcement time, event time, qualification window, and eligibility policy. Server validation must enforce designation and eligibility. Annual event limits, designation authority, rank weights, and qualification rules remain undefined. A designation cannot replace participant-driven event significance with arbitrary manual prestige.

The current addition provides configuration and explanatory UI only, not server enforcement or generated brackets.

## Operations authorization requirements

Grand Battle creation must require a server-verified admin role, never a role editable in the profile. Retain Arena Day and qualification validation. Ordinary categories and prize descriptions are currently local configuration only. Lateness protection applies to Floor 2 only. Do not treat it as a blanket no-show or misconduct exemption; exact forfeit interactions remain pending. Host-selected styles must use system-generated draws without manual opponent editing or rerolls. Emergency refunds must atomically reverse an original debit once. See the [operations manual](./tournament-operations.md) for the expanded lifecycle.

## Participant-based style eligibility

Use the minimum verified floor across all entrants, including each team member. Floors 1–2 restrict the draw to Open Bracket. For an all-Floor-3+ roster, intersect the styles unlocked for all entrants. Host floor is irrelevant unless the host participates. Validate on roster changes and again when both roster and settings are locked, before system generation. Do not allow host changes or rerolls afterward.

The pure helper in `style-eligibility.js` handles this calculation and returns a pending result for missing/invalid floors. Advanced unlock thresholds must come from an approved policy; none are invented. Token Battle remains unavailable. The current app has no verified participant roster, so this helper is not yet authoritative enforcement and the creation selector remains provisional.
