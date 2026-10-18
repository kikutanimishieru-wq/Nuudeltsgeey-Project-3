# V3 rejection attribution investigation

The attribution-loss mechanism is established by the exact pinned Prisma engine source; the actual origin of the historical 23505 remains unproven because its original context was not retained. No native rerun or database connection was made during this investigation.

The V3 sanitized report records distinct sessions, one fulfilled and one rejected transaction, P2010 with 23505, unexpected_code=false, and rejection_context=UNATTRIBUTED. The fixture/trigger prerequisites and committed postconditions passed: one registration, one roster member, zero duplicates, correct winning team and shared player. REJECTION_CONTEXT failed because expectedRejection requires a recognized context token. P2010 is already explicitly accepted; expecting P2002 is not the issue.

The local invariant migration raises DUPLICATE_TOURNAMENT_PARTICIPATION with ERRCODE 23505 but no DETAIL, HINT or CONSTRAINT field. The native suite verifies the checksum-pinned function catalog before execution. The historical sanitized report did not retain metadata field-presence information, so it cannot establish whether the runtime object contained a detail/hint/constraint field. Broadening nesting traversal alone cannot recover fields already discarded upstream.

Pinned engine source (commit c2990dca591cba766e3b7ef5d9e8a84796e47ab7):

- https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres/error.rs — the 23505 arm retains original_code and only uses PostgreSQL DETAIL as original_message, losing MESSAGE_TEXT when DETAIL is absent. The intermediate PostgresError structure does not carry WHERE or structured constraint provenance.
- https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/query-engine/connectors/sql-query-connector/src/error.rs — raw database errors carry code/message and fall back to the generic Quaint error representation when original_message is absent. P2010 therefore can retain 23505 while losing the custom trigger marker. This explains the observed missing attribution without proving which original constraint raised the historical exception.

## Local test-only correction prepared

The roster INSERT is enclosed in a fixed anonymous PL/pgSQL block, not a persistent function or schema change. Bound fixture JSON is supplied through transaction-local set_config. The block catches only unique_violation and reads RETURNED_SQLSTATE, MESSAGE_TEXT, CONSTRAINT_NAME and PG_EXCEPTION_CONTEXT before Prisma translation.

It adds the fixed DETAIL token PHASE4_TEST_EXPECTED_DUPLICATE_PARTICIPATION_V1 only if all original evidence matches: SQLSTATE 23505, exact duplicate-participation message, no named constraint, and context naming the expected enforce_phase4_entrant_invariants() function. Otherwise it rethrows unchanged. The tagged exception still has SQLSTATE 23505 and escapes the outer transaction; both parent registration and child roster roll back. The engine preserves its non-sensitive DETAIL in P2010 metadata. No schema migration or trigger change is needed.

The classifier recognizes only the exact preserved token as VERIFIED_DUPLICATE_DETAIL, subject to existing structured-code checks. Unrelated constraints, generic/missing context, deadlocks, timeouts, connectivity failures and serialization conflicts still fail. Existing distinct-session, one-commit and database-postcondition assertions remain unchanged. No fixture strings, raw errors, metadata values or credentials are printed. Python retains only the new fixed context enum.

## Verification and next run

44 Python regression tests and 13 JavaScript tests passed, including missing/unrelated P2010+23505 context, exact preserved DETAIL, conflicting error codes, redaction and parent sanitization. TypeScript, Python/JavaScript syntax and whitespace checks passed. The SQL block itself has not been executed or validated against PostgreSQL in this task; the fixed-SQL test checks its guard structure only. Real PostgreSQL exception-context formatting and end-to-end token preservation remain native validation requirements.

A new V4 disposable branch is required for another full run under the existing empty-database guard because V3 contains committed fixtures. Do not reset/delete V3 or retarget scripts yet. New branch identity verification, guard changes, strict-TLS preflight, migrations and native fixture writes require their corresponding separate authorizations. The previous native failure must not be relabeled as a proven duplicate-trigger rejection. No automatic retry/cleanup, production modification, migration execution, branch operations, push or deployment occurred.
