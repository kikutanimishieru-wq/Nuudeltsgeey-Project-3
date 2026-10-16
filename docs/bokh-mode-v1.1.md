# Naadam Bökh Mode v1.1 — Optional Mode

## Scope confirmed by the project owner

Bökh is an optional play mode. Players choose whether to use it. It has a separate Bökh Cultural Rank; the existing Game Skill Rank, floor ladder, wallet, and standard tournament rules are not replaced. Opting out does not erase earned cultural identity or history in the intended system.

## Daily and ceremonial layers

Daily Bökh: default 1v1, automatic matching with same-cultural-tier priority, fast queue, training, skill growth, streak building, and gradual cultural progression. Size, age, and fame do not decide equality; cultural rank does.

Ceremonial Bökh: designated Arena Days / Naadam, rank protection, seeding, ceremony, larger cultural progression, and permanent title badges. Daily builds discipline; Arena Days build legends.

## Separate rank and reputation

Each player may hold Game Skill Rank and Bökh Cultural Rank independently. Bökh tracks Honor, Courage, Discipline, and its own match/title history. No conversion from game rank or floor rank is defined. The full tier ladder and progression formulas remain unspecified; do not invent them.

## High-rank rights inside this mode only

Zaan, Arslan, and Champion unlock challenge rights: choose opponent within an allowed cultural-rank range, format, and battlefield. Recipients accept or decline. These are opt-in Bökh challenges, not manual assignment of regular tournament brackets. Daily matching stays automatic and ceremonial brackets retain system seeding.

The supplied proposal says declining slightly lowers Honor and repeated declines lower Honor. Amounts, thresholds, expiry/no-response handling, and review rules remain unresolved; no decline penalty is implemented.

## Teams and cafés

Only Zaan+ leaders form squads of 2–5. Pick teammates and size; issue protected mode challenges. Team and individual titles use Bökh identity.

Each café may have a Bökh team, local broadcast channel, café badge, and location identity. Players join a house, represent it, and travel for away matches. Café UI is intended to show café rank, members, and upcoming battles.

League path: Café → District → City → Aimag → National → International.

## Tokens and sanctions

Daily: small entry, medium win reward, slow streak multiplier. Ceremonial: ceremonial entry, larger win rewards, permanent title badge, large pool. No numeric rates are supplied; the preview charges or awards nothing.

Verified Bökh matches update Honor, Courage, and Discipline. The updated general graduated-penalty policy applies to confirmed violations; Bökh identity revocation is a potential highest-level sanction rather than automatic. Enforcement requires a trusted backend and review process.

## Current implementation

An optional entry card on Tournaments opens the Bökh mode screen. A separate localStorage key remembers opt-in. The main player state is untouched. Mode rank starts as Unranked, and reputation metrics show no recorded values. The 1v1 action explains that live matchmaking is unavailable; it does not simulate a queue, charge tokens, mint a title, or assign a rank. High-rank challenge and squad execution remain unavailable until eligibility and backend services exist.

“Daily Bökh builds warriors. Arena Day Bökh creates legends.”
