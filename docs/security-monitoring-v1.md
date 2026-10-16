# Security & Monitoring v1 — Confirmed Scope

Status: Planning, not deployed protection or monitoring.

## Confirmed decisions

- Counter-Strike is the first game; the existing application targets CS2.
- Partner cafés are the first server-integration setting.
- Connect available server results and performance data so players can inspect their shooting and match performance. The actual detail depends on the supplied data; do not promise every action is recorded.
- Include upgradeable AI analysis in MVP scope. This supersedes the earlier blanket exclusion of AI, without bringing recruitment automation or every proposed AI feature into the MVP.
- Updated decision: use graduated penalties after evidence review and player response, up to badge revocation for the most serious or repeated violations. This supersedes automatic permanent removal, token freezing, rank erasure, and wallet disabling. Penalty selection is not automated.
- Public reporting and transparency policy will be updated later. No public accusations, evidence feeds, or reporting automation are authorized by this scope.

## Planned integration sequence

Partner café data source → authenticated ingestion → match/player identity mapping → validation and stored source records → player performance view → versioned AI analysis.

This is an implementation direction, not a description of an existing pipeline. The server integration must be chosen after inspecting an available API, log sample, or demo recording. Credentials must remain server-side. Model updates should be versioned so older analyses can be traced to the version and source data that produced them.

## Questions still open

- Does the café operate the match server, or only provide PCs connecting to another provider?
- Which source can the café supply: server logs, demo recordings, a plugin feed, or a documented API?
- Which metrics exist, and how are game identities matched to platform profiles?
- The owner confirmed AI should provide analysis; the precise scope of coaching versus suspicious-play flags still needs definition.
- Human review before penalties has been recommended, but the adjudication process has not been finalized. No automated penalty implementation is authorized here.
- AI provider, model, update process, costs, access, consent, retention, and permissions remain to be specified.

No server access, upload endpoint, parser, data collection, AI model, or enforcement action is implemented by these documentation changes. Broader 2FA, backups, replay review, partner audits, and disaster-recovery proposals remain unimplemented and require their own delivery work.

Existing protections and policies remain: lateness protection for Floor 2 only, participant-based style eligibility, locked-roster automatic brackets, admin-only Grand Battles on Arena Days, and separate optional Bökh cultural rank.
