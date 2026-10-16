# Tournament Operations Manual — Styles and Arena Days v1

## Host configuration

Choose match format (5v5, 2v2, solo), map pool, entry type (free, token, sponsored), rank weight, token stakes, verification level, and tournament style. These are format-level settings only. Follow the [No Manual Match Control Rule](./ikh-zasag-rulebook.md).

| Style | Concept |
| --- | --- |
| Open Bracket | Random seeding, knockout |
| Swiss System | Same-record pairing |
| League Round Robin | Everyone plays everyone |
| Floor Climb | Floor progression, inspired by Heaven’s Arena |
| Bökh Challenge Mode | Rank-protected automatic selection |
| Cafe War Mode | Location versus location |
| Speed Ladder | Win to move up |
| Token Battle Mode | Stake-based automatic pairing, later-stage concept |

Planned flow: configure → close and verify entrants → Generate Bracket → system seeds and pairs → verified results → automatic progression. No drag-and-drop, opponent picker, or host-controlled reroll.

Seeding, rematch avoidance, byes, tie-breaks, floor protection, café representation, rank weighting, and progression algorithms require a separate engine specification. Do not infer these rules from style names.

## Arena Days System

Nuudeltsgeey separates daily competition from national competition. While local tournaments run continuously, Major Events are held only on designated Arena Days. Arena Days may align with cultural, seasonal, or historically symbolic moments, and may be announced either as fixed national dates or as surprise community milestones.

This structure preserves honor, pressure, and narrative, ensuring that Major victories carry long-term meaning rather than becoming routine.

### Fixed National Days

Proposed occasions: Naadam, Independence Day, Youth Day, and Education Day. Uses: school championships, aimag leagues, national finals. These are proposed occasions, not an official scheduled calendar.

### Surprise Arena Days

Announce 7–14 days before the event. Uses: elite badge tournaments, invitational battles, international guests. Announcement triggers are not yet specified. The supplied concept mentions October 20, 1945 as historical inspiration; it does not designate a current tournament or recurring event date.

### Seasonal Arena Windows

Spring War, Summer Steppe, Autumn Storm, Winter Crown. The proposal assigns one major event per season. Define the combined annual limit across seasonal, fixed, and surprise events before scheduling; do not treat them as unlimited separate event quotas.

## Major competition requirements

- Invitation + qualification only; café leagues feed qualification.
- Limited designated days, no spam majors.
- Higher rank weight under defined system rules, special badges, permanent trophies, national broadcast presentation.
- Planned UI: Arena Day Approaching banner, countdown, qualification opening, and Qualified for Arena Day profile status based on verified eligibility.
- Do not display countdowns or qualification claims before real schedule and eligibility data exists.

## Current prototype

The creation form saves styles, maps, free/token entry, verification preference, standard rank-weight placeholder, and zero stakes. Free entry deducts zero points. Sponsored entry is unavailable until funding is supported. Token Battle remains visible but disabled because staking is outside the MVP.

The Competition Rules page presents all eight styles and Arena Days. No date is announced, so there is no countdown or qualification claim. There is no bracket generator yet: verified rosters and a server-side engine are required. Existing sample events remain daily tournaments.

## Confirmed governance decisions

- Updated decision: lateness protection applies only to Floor 2. Floor 1 has no lateness exemption. This does not exempt cheating, no-shows, or other violations. Exact protected consequences and interaction with team forfeits remain to be defined before enforcement.
- Hosts select the tournament style. The system generates randomized brackets within that style’s constraints. Hosts cannot choose opponents, edit seeds, reroll draws, or change progression. Swiss still respects records; round robin still schedules everyone.
- Only admins create Grand Battles. Grand Battles retain designated Arena Day and invitation/qualification restrictions. Administrative publication authority does not grant control of opponents or event significance.

## Tournament categories

Categories describe an event’s purpose; styles describe its pairing algorithm.

| Category | Operations |
| --- | --- |
| Micro Battle | 2v2, 3v3, 5v5; same-location verification; entry may be free; habit, streaks, discovery |
| Café Arena Battle | Café-hosted clan battles; QR check-in; local prizes such as hours, gear, tokens |
| Rank Advancement Battle | System-approved eligibility; minimum player count and rank mix; badge advancement thresholds pending |
| Open Community Battle | Schools, families, universities; community hosts; optional sponsor stickers |
| Grand Battle | Admin-only creation; designated Arena Days; invitation/qualification; large attendance or rank concentration; permanent profile record, public by default |

## Attendance and match operations

Proposed registration requires a badge, venue proximity, clan/solo selection, and attendance commitment. On-site check-in verifies presence, locks the roster, and activates tracking. Use the published lateness procedure, subject to Floor 2-only lateness protection. The exact effect of that protection on team forfeits remains pending.

Verification levels: small → GPS; medium → network + GPS; big badge → network + QR; Grand → QR + network + host confirmation. Camera check-in must validate identity and a server-issued challenge; the existing architecture notes explain browser/network and screenshot limitations. No verification is implemented by merely selecting a field.

The planned host dashboard shows active matches, manual score submission, map rotation, and time. Score entry is not opponent control. Results require validation and an audit trail before rewards. Automatic bracket generation respects the host-selected style and verified roster.

## Casting and education

Casters apply; assignment may use first-come-first-served or host selection. Assigned platform casters receive authorized match links, overlays, player information, exposure, and rewards. Open streaming, watch parties, and analysis are proposed; access to official feeds/data requires platform authorization and applicable rights. School activities include camera, commentary, and production training.

## Host and café responsibilities

Hosts provide location, internet, power, seating, and a fair environment. Entry charges, sponsors, and membership cards are proposed; revenue splits remain later-stage work. Cafés may develop clan identity, arena cards, memberships, fans, and home/away leagues. League path: Ulaanbaatar → Aimag → National → International.

## Results, records, and discovery

After verified results: issue tokens, recalculate rank, award participation/honor/optional sponsor stickers, save history, and update profiles. Send a summary, streak information, and suggested battles. Ordinary sticker visibility is player-controlled; major records are public by default under the proposed rules.

Collect attendance, rank changes, token activity, stickers, and performance. K/D, utility usage, accuracy, reaction metrics, and subscription scouting are later additions. Reward amounts, decay intervals, and advanced eligibility thresholds remain unspecified.

## Enforcement proposals

The current graduated framework supersedes the earlier automatic sanction mapping. Review evidence and hear the player/team response before deciding a penalty. Levels are warning, competitive penalty, tournament removal, suspension, and badge revocation. Consider severity, intent, evidence, advantage, impact, and repeat conduct. Floor 2-only lateness protection is not a misconduct exemption. No automated sanctions are active.

## Emergency handling

Internet failure, power loss, or host cancellation should support pause, reschedule, or token refunds. Host reputation adjustments need defined rules. Refunds must reference the original debit and be idempotent; rescheduling must not duplicate entry charges or results. These operations need a backend and are not active in the local demo.

## Delivery scope

v1 emphasizes manual score input, location verification, content creation, and community growth. Game APIs, smart contracts, and international federation are future proposals, not requirements for the current points-only MVP.

The current update adds category and prize-description fields, 3v3 format/filtering, protected-floor messaging, and rejection of Grand Battle creation through the ordinary local host form. This client-side check is not production authorization. No admin workflow, attendance penalties, score processing, casting service, emergency refunds, or bracket engine is implemented yet.

## Confirmed beginner style and draw timing

Floors 1–2: Open Bracket only. Additional styles become available as players climb; the higher-floor unlock schedule is not specified. Use the lowest participant floor across the whole roster, including every teammate. Any Floor 1–2 entrant limits the event to Open Bracket. With all participants at Floor 3+, offer only styles unlocked for everyone. A host’s floor does not restrict the event unless they are also a participant. Re-evaluate eligibility after every roster change and at roster/settings lock; never generate an ineligible draw. The current selector remains a configuration preview and does not enforce floor access.

Lock the roster and tournament settings before generating the bracket. Hosts cannot alter opponents or reroll after generation. Byes and other style-specific edge cases remain undecided. Optional Bökh cultural rank is separate from this main floor ladder.

## Counter-Strike event procedures — approved integration

### Flexible event configuration

The supplied eight-team, single-elimination event (BO1 quarterfinals/semifinals and BO3 final) is an example, not a platform-wide limit. Team count, eligible style, and match-series settings depend on the published event configuration. Existing floor eligibility and automatic opponent assignment still apply. The current creation form does not yet implement per-round series settings.

### Captain and locked roster

For 5v5: five starting players, one optional substitute, maximum six registered players. Designate one captain for registration, check-in, official communication, result confirmation, and disputes. Register everyone before roster lock. After lock, only registered-substitute changes are permitted, with no opponent or bracket-position changes. Major Arena events require admin approval. Ordinary café authority and exact substitution windows remain undefined.

### Information before registration closes

Publish the tournament name, game, café, location, date, registration deadline, check-in time, first-match time, team count, roster size, style, round series lengths, entry fee and payment deadline, refund conditions, prizes and distribution, non-cash rewards, map pool, equipment requirements, and applicable rule version. Do not secretly change prize distribution after play begins.

### Map veto

Publish the exact veto sequence before play. BO1 uses alternating removals until the map is determined. BO3 defines first/second bans, each team’s pick, remaining bans, and a decider. Starting order follows a published seeding/random procedure, not administrator preference. Confirmed veto results are final; disliking a map is not grounds to reroll it. Exact sequences depend on the configured map pool and remain event-specific.

### Lateness and technical interruptions

The supplied default schedule is warning within 0–10 minutes, final warning within 10–15 minutes, and a possible forfeit after 15 minutes. A tournament may publish an approved alternative beforehand. Exact interval boundaries and Floor 2 protection’s effect on a team forfeit remain unresolved; these timings are documented rather than automatically enforced.

Report PC, network, server, game, or peripheral failures promptly. Administrators may continue, pause, restart, resume, relocate, or reschedule where justified. Café-wide failures and emergencies can justify exceptions. Deliberately causing an interruption is misconduct.

### Result verification and disputes

Record result → captains confirm → administrator verifies → result becomes official → rule-based rank/reward updates. Administrators cannot award arbitrary rank points.

Captain disputes identify tournament, match, teams, approximate time, incident description, and available evidence. Demos, server records, video, observations, and screenshots may support review. Screenshot evidence is distinct from prohibited screenshot-based identity/location check-in.

Use the [rulebook investigation and graduated-penalty process](./ikh-zasag-rulebook.md). Preserve versioned decisions and give players an opportunity to respond. Registration should record agreement to the published rules and registered-identity, conduct, fair-play, and community obligations.

These additions are documented procedures and public explanatory text. Live roster enforcement, vetoes, score approvals, case management, sanctions, and automated lateness handling require backend implementation.
