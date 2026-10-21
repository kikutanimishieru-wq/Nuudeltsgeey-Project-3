# Sprint 2A-F — source hardening, offline verification only

No feature activation, provider connection, server, database access or migration.
This supersedes the linking-availability statements in Sprint 2A documentation.

## Completed source corrections

Password login retains initial bcrypt verification, then validates supported public
schema targeting, locks public.User FOR UPDATE, and compares the reread password
hash with the verified snapshot before audit/success. Credential hashes never enter
the returned Auth.js user or audit. Account status is reread. Concurrent credential
writes must respect ordinary row-lock behavior; no claim is made that a later
password change revokes an already-created JWT session. Persistent revocation is
separate blocked work. Legacy PLAYER/REFEREE/ADMIN/SUPER_ADMIN password access remains.

Schema targeting checks the configured PostgreSQL URL's single optional schema
parameter (public only), then requires current_schema=public, the exact effective
namespace pg_catalog/public, and unqualified User resolution equal to public.User.
Missing/ambiguous observations fail closed. Temporary or additional namespaces are
rejected, not accommodated automatically. Validation precedes identity lookup and
allocation in Discord resolution. Raw User inserts/locks explicitly name public.
Prisma's schema configuration must match; catalog nullability checks still apply
before provisioning. No SET search_path, configuration repair or SQL execution has
been performed in this sprint; these are future runtime checks in source only.

Grant expiry is checked again after account locking and restriction/identity reads.
Independent fixtures cover expired-unconsumed and unexpired-consumed grants plus
valid consumption/replay. An advancing fake clock covers expiry during processing.

## Linking correction remains BLOCKED

No durable generation/session registry exists. A proposal is preserved in
proposals/SPRINT2AF_REVOCABLE_LINKING.md, not applied. All LINK starts and callbacks
are now blocked with LINK_AUTHORIZATION_GENERATION_REQUIRED before provider proof
or identity writes, including old timestamp-only challenges. This deliberately
pauses legacy linking/reverification too. Sign-in and identity history remain.
No fallback, local counter or unverified client generation enables linking.
Fresh Discord reauthentication and persistence are not implemented here.

## Tests and limits

Mock-only tests capture actual password provider handlers, use fake Prisma/provider
boundaries and a copy-on-write logical transaction model for callback failures.
The model discards writes on thrown profile/identity/audit/grant errors and preserves
a committed account after session-creation failure. This verifies source ordering
against a simulated contract; it does NOT establish PostgreSQL rollback, advisory
locks, isolation, P2002 behavior, search-path behavior or Auth.js cookie transport.
No full database/native test suite may be invoked for this sprint.

Default-disabled provisioning, passwordless schema proposal, identity uniqueness,
Steam sign-in rejection and existing restrictions remain. Neither schema.prisma nor
installed migrations change. No frontend, ingress/proxy, harness or Phase 4 file
changes. New provisioning still requires separately approved schema/client work.

Next: independent source review of completed corrections and review of the persistent
revocation proposal. Do not enable LINK or provisioning until persistence adoption,
isolated database validation and separate execution approvals are complete.
