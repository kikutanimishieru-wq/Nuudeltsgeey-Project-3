# Operations Integration Addendum v1

> Governance reconciliation: consult the [current decision register](governance/decision-register.md) and [preserved pre-reconciliation source](governance/history/docs/operations-integration-v1.md). The original text below is retained; conflicting Grand Battle restrictions, blanket 3v3 deferral, economic proposals and older workflows do not override later approved decisions. This notice does not change application behavior or historical tournament rules. Check-in timing remains under revision.

This addendum adapts useful operational ideas from the earlier full-stack operations project without changing the current competition rules.

## Included in the current preview

- Tournament entries show a simple lifecycle: Registration Open → Registered → Check-in Open → Local Check-in Recorded.
- Check-in is stored only in the current browser and is explicitly not venue, identity, or roster verification.
- 5v5 events display the approved roster policy: five starters plus one optional registered substitute.
- The profile history displays whether local check-in was recorded.

## Backend requirements before authoritative enforcement

The future service should support registration, check-in, roster lock, live play, result submission, result confirmation, and completion. Each transition must be authorized, auditable, and validated against the published event rules.

Before bracket generation, a 5v5 roster must contain five starters and may contain one registered substitute. After lock, changes are substitutions from that roster; opponents and bracket positions never change. Major Arena substitutions require administrator approval.

## Audit, incidents, and locked results

The backend should record who performed each significant operation, when it happened, the tournament or match affected, and the rule version. Incident records should preserve evidence references, review status, player/team response, decision, and any penalty level. An allegation must not become a confirmed violation without review.

Match results should move through submission, confirmation or dispute, verification, and lock. A locked result may update rank and tokens only through an authenticated, idempotent server operation. The current ranking direction is represented by the configurable `ranking.js` helper: Floors 1–2 are protected from loss, Floor 3+ losses can reduce rank, stronger-opponent wins reward more, weaker-opponent wins reward less, and verified participation adds gradual progress. The point values remain provisional until validated with real match data.

## Deliberately not imported

- Fixed eight-team requirements.
- A single-elimination-only bracket.
- The old ranking engine.
- Old credentials, environment files, or database configuration.

The current flexible tournament styles and the [Ikh Zasag Rulebook](./ikh-zasag-rulebook.md) remain authoritative.

## Player ID and placement update

The public competitive identity uses a permanent `NMD-000001`-style ID. Team, café, nickname, and rank changes do not create a new ID or erase history. The current preview uses `NMD-000127` as a local example; production issuance must be server-controlled.

Players begin at 1,000 NR and remain in placement until five verified official matches are complete. The ranking helper treats this as a status boundary; it does not invent a final placement formula. Counter-Strike roles (IGL, AWPer, Rifler, Entry, Support, Lurker, Flexible) are separate from broader identity roles such as Host or Caster.
