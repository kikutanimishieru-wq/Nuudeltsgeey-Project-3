# Phase 4 validation v2 setup — 2026-10-18

Decision: BLOCKED pending independent source-branch provenance confirmation. Local guard retargeting and regression validation are complete; no database writes are authorized by this report.

## Verified target

- Project: rough-snow-56584532 (nuudeltsgeey-production).
- Branch: br-plain-glitter-b5cadax8 (phase4-validation-v2).
- Endpoint: ep-round-leaf-b5w0evea.
- Direct host: ep-round-leaf-b5w0evea.c-7.us-east-2.aws.neon.tech.
- Database/owner: neondb / neondb_owner.
- State ready; primary=false, default=false, protected=false; endpoint disabled=false.
- Created 2026-10-18T08:42:26Z; expires 2026-10-19T08:41:46Z (2026-10-19 16:41:46 Asia/Ulaanbaatar).
- At 2026-10-18T08:45:16Z, remaining lifetime was 23h 56m 30s. Recheck live expiration before any later operation.
- API init_source=parent-schema. The branch API response has no parent_id. The owner reports production as source; metadata identifies production as br-wispy-mountain-b5nku4bf, but this does not independently prove the new branch was copied from that branch. No production database queries were made.

## Read-only database verification

All queries explicitly selected the new project, branch, endpoint and database. Catalog identity was neondb / neondb_owner. All 26 application tables have exactly zero rows, including IdentitySequence; no previous synthetic fixtures exist. _prisma_migrations exists with zero records.

The live PostgreSQL catalog was compared offline to the checksum-pinned foundation SQL without executing SQL migrations, including in memory. All 192 column definitions (type, nullability, defaults), 74 primary/foreign-key constraints (definitions, validation and deferral flags), 52 indexes (definitions, validity/readiness), and 67 enum values across 13 enum types matched. Comparison normalized PostgreSQL identifier quoting, type/default rendering and foreign-key action order. There are no public application functions or user triggers at foundation stage. Security metadata shows owner-owned application tables, no RLS/policies/views/other schemas, owner-only table ACLs, and public schema USAGE. These checks establish foundation structural compatibility; source provenance remains separate.

## Local guards and readiness

Shared preflight and native-test target pins now accept only the new branch/endpoint/host. The migration and behavior launchers import the shared guard. The branch name must equal phase4-validation-v2. Production, retired endpoint, pooler and inherited database-routing environment variables remain rejected. Hidden input, strict sslmode=require plus sslaccept=strict, bounded connection options, ownership/protection/expiry checks, approval flags, process-group termination and redaction remain intact. Added regression coverage for retired branch/endpoint, wrong project/name and pooled URL rejection.

The native runner retains the static test-name registry, safe SQLSTATE/category reporting, fsynced private diagnostics, per-case duration/interruption evidence, deterministic tournament lock ordering, coordinated time budgets, retry=0 and bail=1. Its final catalog fingerprint remains the reviewed migrated-schema pin; it is not evidence that this foundation-only branch already has the final schema. Fixture execution must wait for a separately approved migration rehearsal, final schema verification and empty-table checks. Failures never reset, repair or automatically rerun the suite. Committed fixtures require separately approved disposal/recovery.

Prisma CLI/client 6.19.3 and reviewed engine hash verified locally. All seven SHA-256 pins and exact migration order matched:

| Migration | SHA-256 |
| --- | --- |
| 20261012003031_foundation | a8ae6fd95d38a2ea0192d471485e2fdf6abcb54f683d8ad0025bfd68088d73bc |
| 20261016093000_identity_authority | 031afe0e48408fe46a517f7defae219d12b0f4bd09cfd416cbecb2e56c1eb07b |
| 20261016103000_identity_hardening | 9422261b8cbe4a86f09601d163aecc9f15a0465d89b094346678e43e0774262a |
| 20261016120000_tournament_configuration | 30df24fceee8eea8e02934a3e04e75223d2b66270bd5f152150a3a6b566b1296 |
| 20261016150000_registration_lock | be091cdbc4d8cd92e086792c0f29bb191ac05dec6db7de0636dea3026ec82fa0 |
| 20261016170000_final_attendance_governance | 66edc04a2b802a27acd73056562ad37f398d4fd0437fc9833f666f4766b3a254 |
| 20261016190000_phase4_database_invariants | 3e015ab70b016845c35453414f935311c3183b89929ba56fc4918a5442225136 |

Foundation baselining is structurally appropriate for this matching foundation and empty ledger. The separately approved runner will recheck the full foundation reference immediately before baselining, verify the baseline record/checksum, then deploy the six remaining migrations in the order above and compare the final ledger/catalog including constraints/functions/triggers. No baseline, deploy or native suite was executed here. Historical migrations and application code are unchanged.

Local verification: 42 Python regression tests, four JavaScript reporter tests (including one Vitest subprocess with a synthetic local assertion only), TypeScript no-emit, Python/JavaScript syntax and whitespace checks passed. No real native database tests ran.

## Next step

Obtain console creation evidence identifying production/br-wispy-mountain-b5nku4bf as the schema source; the current API omits that relationship. Use a replacement API key if the previously exposed one has not been revoked. Never paste secrets into chat.

Exact read-only preflight command from repository root (not executed during setup):

```sh
PATH="/private/tmp/node-v22.23.3-darwin-arm64/bin:$PATH" python3 -B backend/scripts/phase4-preflight.py
```

Enter the new branch's direct URL and API key only at hidden terminal prompts. The query suffix is ?sslmode=require&sslaccept=strict (channel_binding=require is also allowed). No normal DATABASE_URL or .env change is needed. MCP metadata/catalog validation is not a fresh credential-based Prisma strict-TLS preflight. After source confirmation and a fresh PASS receipt, request separate migration-write authorization; synthetic native fixtures require their own later approval. No push, deployment, production-data access, branch creation/deletion or Phase 5 work occurred.
