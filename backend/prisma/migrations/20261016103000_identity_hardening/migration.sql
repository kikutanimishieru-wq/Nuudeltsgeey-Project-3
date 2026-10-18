-- Additive security follow-up: no existing record is overwritten or removed.
ALTER TABLE "ExternalIdentity"
  ADD COLUMN "administrativeHoldAt" TIMESTAMP(3),
  ADD COLUMN "revocationKind" TEXT;
ALTER TABLE "IdentityChallenge" ADD COLUMN "reauthenticatedAt" TIMESTAMP(3);
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_revocationKind_check"
  CHECK ("revocationKind" IS NULL OR "revocationKind" IN ('SELF', 'ADMIN', 'ADMIN_CLEARED'));
ALTER TABLE "IdentityChallenge" ADD CONSTRAINT "IdentityChallenge_reauthentication_intent_check"
  CHECK ("reauthenticatedAt" IS NULL OR "intent" = 'LINK');
-- Existing LINK challenges have no fresh-authentication proof and are rejected by the application.
-- Existing unclassified revoked identities require explicit administrator review; no backfill guesses provenance.
