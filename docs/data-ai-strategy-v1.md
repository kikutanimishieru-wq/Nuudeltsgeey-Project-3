# Nuudeltsgeey Data & AI Strategy v1

Status: Planning document. Partner-café Counter-Strike performance monitoring and upgradeable AI analysis are now included in MVP scope; recruitment and broader analytics remain future roadmap items.

Objective: Use data analytics and future AI assistance to identify talent, recommend teams, improve tournament operations, and support sponsors while preserving fairness, transparency, and cultural identity.

This document records the project owner's proposed strategy. It does not claim deployed AI, measured outcomes, established privacy compliance, or permission to collect data. No website features or data collection are added by this document.

## 1. Data collection

Proposed categories:

- Player data.
- Tournament data.
- Community and partner data.
- Scouting and recruitment data.

Structured and unstructured sources are proposed. Exact fields, sources, retention periods, access roles, and consent flows remain to be defined. Anonymization where appropriate and compliance with applicable Mongolian and international privacy requirements are objectives, not verified current capabilities.

Existing performance and attendance plans remain in the [Tournament Operations Manual](./tournament-operations.md); this strategy does not duplicate their implementation requirements.

## 2. AI scouting system

Proposed capabilities: talent discovery, an opt-in recruitment pool, team suggestions, and interest matching. Recommendations may consider performance, streaks, rank, interests, and Honor, subject to defined data permissions and scoring rules.

Reducing bias is an objective. Automated selection cannot be described as eliminating bias or guaranteeing fairness without evaluation. Feature weights, explanations, and evaluation methods remain undecided.

## 3. Tournament and league analytics

Future insights may support scheduling, participation prediction, streak analysis, stream engagement, and token-economy balance. Bracket fairness analysis and matchmaking suggestions must respect the [Ikh Zasag Rulebook](./ikh-zasag-rulebook.md).

AI cannot override the host-selected eligible style, change locked rosters or settings, pick opponents outside the approved engine, or reroll brackets. The lowest participant floor continues to determine style eligibility. AI analysis does not automatically change reward rates, wallet balances, or rank.

## 4. Recruitment workflow

Proposed flow:

1. Analyze eligible players who have consented to recruitment use of their data.
2. Produce explainable candidate scores using approved performance and preference inputs.
3. Assemble a talent pool of potential recruits.
4. Sponsors or clubs review suggestions and select candidates for offers.
5. Notify selected players and record acceptance or decline.
6. Use permitted team-integration feedback to evaluate recommendation quality.

The original proposal describes scanning all registered players continuously. This roadmap retains its consent requirement: registration alone does not authorize recruitment analysis. Recommendations assist discovery; clubs choose offers and players choose whether to accept. No outreach is authorized or implemented by this document.

## 5. Agent features

Proposed notifications include new talent, team imbalance, and player streak alerts. Historical recruitment outcomes may help improve predictions after evaluation.

Performance or recommendation-acceptance incentives are proposed integrations with the token economy, not approved reward rules. Amounts, eligibility, and effects on player choice require a separate decision. Matchmaking assistance remains subordinate to the approved tournament engine.

## 6. Sponsor and partner benefits

Proposed tools: authorized talent-pool access, performance/ranking/engagement dashboards, and custom filters by game, rank, or reward system. Selection transparency should explain why candidates were suggested and record sponsor decisions.

Sponsor access, subscription terms, permitted fields, and limits are not yet defined. A subscription alone is not authorization to access sensitive player information.

## 7. Data security and ethics

Proposed requirements include consent-based processing, appropriate anonymization of sensitive information, controlled access, and traceable recommendation and sponsor-action logs. Anti-cheat and fraud signals may inform analytics only under an approved policy.

Privacy compliance, effective anonymization, bias mitigation, and security remain work to establish and assess. No automated sanctions or identity removals are introduced by this strategy.

## 8. KPI targets

These are supplied aspirations, not measured results, forecasts, or guarantees.

| KPI | Proposed target | Definition still needed |
| --- | --- | --- |
| Players scouted per month | 1,000+ | Unique eligible players and what counts as scouted |
| Successful team recommendations | 80%+ adoption | Denominator, acceptance event, and observation window |
| Sponsor recruitment via AI | 50+ per year | Completed recruitment and attribution criteria |
| Performance prediction accuracy | At least 85% | Prediction task, metric, held-out data, and baseline |
| Engagement improvement | 20% higher participation | Comparison group, baseline, and measurement period |
| Token flow optimization | Reduced imbalance | Definition of imbalance and acceptable bounds |

## 9. Ecosystem integration

Future scope spans cafés, schools, leagues, national events, and international expansion, with role-appropriate insights for players, sponsors, casters, and organizers.

Game Skill Rank and optional [Bökh Cultural Rank](./bokh-mode-v1.1.md) remain separate. Arena Days retain designated-date rules and Grand Battles remain admin-created. Integration with these systems is planned, not complete. Real-time processing is an aspiration; infrastructure and latency requirements are undecided.

## 10. Philosophy

The strategy aims to connect players, sponsors, and communities through transparent talent discovery and team-building tools while preserving Mongolian cultural identity. Its fairness and trust goals require evidence and accountable governance, not merely automated scores.

## Relationship to the MVP

The owner updated the [MVP architecture](./mvp-architecture-v1.md): start with Counter-Strike (CS2 in the existing app) at partner cafés, connect available server match data, show player performance, and add upgradeable AI analysis. This supersedes the earlier blanket exclusion of AI. Recruitment, sponsor recommendation automation, and broader AI features remain future work. No server feed, parser, model provider, or automated analysis is connected yet.

Public enforcement reporting is deferred. See the [security and monitoring scope](./security-monitoring-v1.md) for confirmed decisions and unresolved integration inputs.

## Decisions reserved for the project owner

- Which player fields may be used, and how consent, withdrawal, and retention work.
- What Honor means outside optional Bökh and whether it belongs in general recruitment scoring.
- Recruitment eligibility, sponsor permissions, offer flow, and notification preferences.
- Scoring weights, explanations, bias evaluation, and correction/appeal processes.
- KPI definitions, baselines, and validation datasets.
- Whether acceptance incentives should exist and, if so, their rules.
- Provider, hosting, costs, and implementation phase.

These remain open; this roadmap does not supply invented answers.
