# Phase 4 V3 target verification — 2026-10-18

READY FOR STRICT-TLS PREFLIGHT. This is not migration or synthetic-write authorization.

Verified through read-only Neon metadata and SELECT queries:

- Project rough-snow-56584532.
- Branch phase4-validation-v3 / br-morning-queen-b5u7j4qz.
- Endpoint ep-still-rain-b55chfrd.
- Direct host ep-still-rain-b55chfrd.c-7.us-east-2.aws.neon.tech.
- Database neondb; current role neondb_owner.
- Branch ready, primary=false, default=false, protected=false. Endpoint active, disabled=false, pooler_enabled=false.
- Created 2026-10-18T09:41:57Z; expires 2026-10-25T09:41:57Z (October 25 at 17:41:57 Ulaanbaatar). Seven-day original TTL provides testing and investigation time; live expiration is rechecked by the guard.
- init_source=parent-schema confirms schema-only initialization. A missing parent is expected for this independent root branch.

The complete live metadata object exactly matches the previously audited foundation catalog, including security metadata. Verified 26 tables, 192 columns, 74 primary/foreign-key constraints, 52 valid indexes, 13 enum types (67 enum labels). The audited baseline was previously compared against the pinned foundation SQL without executing migrations. Exact SELECT counts across all 26 application tables sum to zero; _prisma_migrations exists with zero records. No native fixtures or migration ledger rows were inherited.

Local shared preflight and native target pins now accept V3 exclusively. Updated positive metadata fixtures use phase4-validation-v3; regression cases explicitly reject the retired V2 branch/name/endpoint, prior expired target, pooled V3 endpoint and production. Migration and behavior launchers import the shared preflight; no additional target override was added. Updated current guarded-execution and native-test-plan documents; historical V2 reports remain unchanged.

Strict TLS, exact direct hostname/database/role, minimal subprocess environment, fresh hidden credentials, live ownership/protection/expiration checks, process-group cleanup, explicit write authorization flags, migration checksum verification, and retry=0/bail=1 remain intact. Seven migration checksums and chronological order match the unchanged pins; Prisma CLI/client 6.19.3 and engine hash verified. The corrected duplicate-participation runner and reporting contracts were not changed by this retargeting.

Local checks passed: 43 Python regression tests, 10 JavaScript tests, TypeScript no-emit, Python/JavaScript syntax and whitespace. JavaScript reporter integration uses a synthetic local assertion only, without a database connection. No migrations or native database suite were executed.

Next command from repository root, requiring hidden terminal credentials:

```sh
PATH="/private/tmp/node-v22.23.3-darwin-arm64/bin:$PATH" python3 -B backend/scripts/phase4-preflight.py
```

Use only V3's direct connection URL, with sslmode=require&sslaccept=strict; channel_binding=require is optionally allowed. Do not paste credentials into chat or change the normal DATABASE_URL. A new strict-TLS receipt is required because the preflight file changed. V3 foundation verification through MCP is not a credential-based Prisma TLS test. Migration rehearsal and native writes require separate subsequent approval.

V2 and its diagnostic evidence were not changed or deleted. No production database queries or changes, branch creation/deletion, application writes, push, deployment or Phase 5 work occurred. V2's existing expiration remains unchanged. The previous native failure remains UNKNOWN, and corrected native behavior is not yet validated on PostgreSQL.
