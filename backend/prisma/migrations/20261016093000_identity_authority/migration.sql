-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('STEAM', 'DISCORD');

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityChallenge" (
    "tokenHash" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "intent" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "IdentityChallenge_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "IdentityLoginGrant" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "browserHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "IdentityLoginGrant_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "SteamAssertionNonce" (
    "nonceHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SteamAssertionNonce_pkey" PRIMARY KEY ("nonceHash")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "IncidentParty" (
    "incidentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "IncidentParty_pkey" PRIMARY KEY ("incidentId","userId")
);

-- CreateTable
CREATE TABLE "ReviewAssignment" (
    "incidentId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "attestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewAssignment_pkey" PRIMARY KEY ("incidentId","reviewerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_provider_providerAccountId_key" ON "ExternalIdentity"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_userId_provider_key" ON "ExternalIdentity"("userId", "provider");

-- CreateIndex
CREATE INDEX "IdentityChallenge_expiresAt_idx" ON "IdentityChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "IdentityLoginGrant_expiresAt_idx" ON "IdentityLoginGrant"("expiresAt");

-- CreateIndex
CREATE INDEX "RateLimitBucket_resetsAt_idx" ON "RateLimitBucket"("resetsAt");

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityChallenge" ADD CONSTRAINT "IdentityChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityLoginGrant" ADD CONSTRAINT "IdentityLoginGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentParty" ADD CONSTRAINT "IncidentParty_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentParty" ADD CONSTRAINT "IncidentParty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Phase 2 invariants beyond Prisma's declarative schema.
ALTER TABLE "IdentityChallenge" ADD CONSTRAINT "IdentityChallenge_intent_user_check"
  CHECK (("intent" = 'LINK' AND "userId" IS NOT NULL) OR ("intent" = 'SIGN_IN' AND "userId" IS NULL));
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_independent_assigner_check"
  CHECK ("reviewerId" <> "assignedById");
ALTER TABLE "RateLimitBucket" ADD CONSTRAINT "RateLimitBucket_positive_count_check" CHECK ("count" > 0);
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_subject_format_check"
  CHECK (("provider" = 'STEAM' AND "providerAccountId" ~ '^[0-9]{17}$')
      OR ("provider" = 'DISCORD' AND "providerAccountId" ~ '^[0-9]{17,20}$'));
