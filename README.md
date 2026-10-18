# eNomad Arena

> Governance reconciliation: consult the [current decision register](docs/governance/decision-register.md) and [preserved pre-reconciliation source](docs/governance/history/README.md). The original text below is retained; conflicting Grand Battle restrictions, blanket 3v3 deferral, economic proposals and older workflows do not override later approved decisions. This notice does not change application behavior or historical tournament rules. Check-in timing remains under revision.

Responsive, dependency-free website prototype for the Nuudeltsgeey competitive identity platform.

## Run

With Node.js installed:

```sh
npm run dev
```

Open http://localhost:5173. You can also open [index.html](./index.html) directly; browser storage behavior may vary for local files.

## Implemented

- Responsive arena overview with original steppe SVG artwork
- CS2 tournament search, format filters, local creation, and entry reservations
- Demo token balance and transaction history; duplicate entries and insufficient balances are blocked
- Editable player identity, role, location, and visibility preference
- Badge, protected rank preview, tournament registrations, and trophy-room empty state
- Local clan membership and streaming discovery
- Local browser persistence using localStorage

## Scope and integration needs

This is a frontend prototype, not a production decentralized platform. Events, community statistics, clans, and rankings are sample data. Tournament creation and membership changes are only visible on the current device. Team entry reserves one team slot without roster validation. Tokens are demonstration credits, with no monetary value.

Production work remains for authenticated email/phone accounts, server-side roles and permissions, a database, wallet ledger and payments, identity QR issuance and scanning, host and venue verification, device/GPS/WiFi attestation, authoritative team rosters and check-in, bracket generation and match reporting, anti-cheat and disputes, ranking/significance calculations, real trophies and streaks, messaging, notifications, caster assignment, stream storage, and admin tools. Wallet passes, scouting, leagues, multi-game, and international capabilities remain roadmap work.

Fonts load from Google Fonts with system fallbacks. No dependencies or API keys are required.

## Files

- [index.html](./index.html): application shell
- [style.css](./style.css): responsive visual system
- [app.js](./app.js): screens, interaction, local persistence
- [assets/mountains.svg](./assets/mountains.svg): original vector landscape
- [server.cjs](./server.cjs): local development server

## Token economy whitepaper

The [Token Economy Whitepaper v1](./docs/token-economy-v1.md) is integrated into the Token Economy screen, accessible from navigation and the wallet. All 18 sections are included, alongside AT/BT descriptions, the circulation cycle, and an interactive illustrative reward calculator. The calculator never changes balances. The proposal does not define production reward rates, daily limits, burn allocation, or staking mechanics; those remain unimplemented. The staking terminology is attributed to the proposal rather than presented as a legal determination.

## MVP technical architecture

The [MVP Technical Architecture v1](./docs/mvp-architecture-v1.md) defines the browser-first target, seven modules, API contracts, database entities, security requirements, and phased delivery. The Architecture page (`#architecture`) includes an interactive module diagram and all 14 sections. Implementation notes separate browser limitations and unresolved policy parameters from the original proposal. This addition is documentation and UI; it does not implement a backend or migrate the existing project to Next.js/Firebase.

## Competition rules and Arena Days

The Competition Rules screen (`#competition`) adds eight tournament-style concepts and the Arena Days framework without duplicating existing economy or architecture pages. Tournament creation saves style, map pool, entry type, and verification preferences; free entry costs zero demo tokens. Sponsored funding and Token Battle remain unavailable. Bracket generation and major-event scheduling are not implemented.

Canonical documents: [Ikh Zasag Rulebook](./docs/ikh-zasag-rulebook.md), [Tournament Operations Manual](./docs/tournament-operations.md), [App Feature Spec addendum](./docs/app-feature-spec.md), and [Architecture addendum](./docs/mvp-architecture-v1.md).

## Optional Bökh mode

Tournaments links to `#bokh`, an opt-in cultural mode documented in [Naadam Bökh v1.1](./docs/bokh-mode-v1.1.md). Its local preference is stored separately from the main profile and wallet. The page describes daily 1v1, ceremonial play, a separate cultural rank, Zaan+ challenges, squads, café houses, and reputation. Live queueing, rank progression, challenges, and sanctions are not implemented; no tokens are charged by this mode preview.

Style eligibility uses the lowest participant floor (including teammates), not the host’s floor. Floors 1–2 allow Open Bracket only; higher-floor choices must be unlocked for everyone. [style-eligibility.js](./style-eligibility.js) provides the tested policy helper, pending verified roster integration and approved advanced unlock thresholds. Tournament creation currently stores a provisional style preference.

## Future Data & AI roadmap

[Data & AI Strategy v1](./docs/data-ai-strategy-v1.md) records proposed recruitment workflows, team suggestions, analytics, alerts, consent requirements, and unvalidated KPI targets. It is a planning document. Partner-café Counter-Strike performance monitoring and upgradeable AI analysis have since been added to MVP scope; recruitment AI remains later-stage. No AI feature, public page, outreach, or data collection was added. Existing bracket rules and the separate Bökh cultural identity remain authoritative.


[Security and monitoring scope](./docs/security-monitoring-v1.md) records the partner-café-first Counter-Strike integration, pending server data source, upgradeable AI analysis, deferred public reporting, and retained confirmed-cheating policy. No live monitoring is connected.

## Updated Counter-Strike tournament rules

The rulebook and operations manual now specify evidence-based graduated penalties, Floor 2-only lateness protection, and locked 5v5 rosters with five starters plus one optional substitute. Major Arena substitutions require admin approval and cannot change opponents. Tournament sizes and BO1/BO3 configurations remain flexible. Captain duties, veto publication, result verification, investigations, conduct, administrator accountability, and rule versioning are documented; backend enforcement remains unimplemented.

Useful operations workflow from the earlier project is now represented in the local preview and documented in the [Operations Integration Addendum](./docs/operations-integration-v1.md): registration and check-in state, the approved 5v5 roster policy, and backend requirements for audit, incidents, disputes, and locked results. Local check-in is only a browser preview and is not venue verification.

The [ranking policy helper](./ranking.js) now captures the approved direction: Floors 1–2 are protected from rank loss; from Floor 3 onward, a match loss can reduce rank; wins against stronger opponents give larger gains; wins against weaker opponents give smaller gains; and verified participation provides a modest progression bonus. The point values are configurable defaults and require server-side verified results before production use.

The Player ID update adds a permanent public `NMD-000001` identity, a five-verified-match placement period from starting NR 1,000, and a separate Counter-Strike role field. These are represented in the local profile preview; contact collection, identity verification, and permanent server-issued IDs remain backend work.

Tournament award defaults from the approved pilot flow are now represented in the ranking policy: participation +5 NR, champion +50 NR, runner-up +30 NR, and semifinalist +15 NR. These are separate from match-result changes and require idempotent server-side award processing.

## Real backend foundation

The [backend](./backend/) now contains the approved Next.js + Prisma + PostgreSQL foundation. It stores private identity data separately, issues server-side NMD IDs during registration, exposes a public competitive profile without private fields, and models teams, cafés, tournaments, matches, ranking transactions, achievements, incidents, suspensions, corrections, and audit events. The browser prototype remains available while the backend workflow is built out.

The backend now also includes authenticated team invitations, flexible system-generated brackets, roster locking, check-in, result verification and locking, tournament NR awards, achievement evaluation, admin actions, and automated ranking/bracket tests. PostgreSQL migration still requires a local database URL.
