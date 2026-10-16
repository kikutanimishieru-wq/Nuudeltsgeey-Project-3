-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLAYER', 'REFEREE', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('CREATED', 'UNVERIFIED', 'VERIFIED', 'ACTIVE', 'UNDER_REVIEW', 'SUSPENDED', 'BADGE_REVOKED');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN', 'ROSTER_LOCKED', 'LIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WAITLISTED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'READY', 'LIVE', 'AWAITING_CONFIRMATION', 'DISPUTED', 'VERIFIED', 'LOCKED');

-- CreateEnum
CREATE TYPE "MatchResult" AS ENUM ('WIN', 'LOSS', 'FORFEIT');

-- CreateEnum
CREATE TYPE "ConfirmationDecision" AS ENUM ('CONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('REPORTED', 'UNDER_REVIEW', 'VIOLATION_ESTABLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PenaltyLevel" AS ENUM ('NONE', 'WARNING', 'COMPETITIVE_PENALTY', 'TOURNAMENT_REMOVAL', 'SUSPENSION', 'BADGE_REVOCATION');

-- CreateEnum
CREATE TYPE "RatingTransactionType" AS ENUM ('PLACEMENT', 'PARTICIPATION', 'MATCH_RESULT', 'REVERSAL', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AchievementKind" AS ENUM ('FIRST_STEP', 'FIRST_BLOOD', 'VETERAN', 'BATTLE_TESTED', 'FIFTY_BATTLES', 'STREAK_III', 'STREAK_V', 'FINALIST', 'CHAMPION', 'KHAN');

-- CreateEnum
CREATE TYPE "VetoAction" AS ENUM ('BAN', 'PICK');

-- CreateEnum
CREATE TYPE "TournamentAwardKind" AS ENUM ('PARTICIPATION', 'CHAMPION', 'RUNNER_UP', 'SEMIFINALIST');

-- CreateTable
CREATE TABLE "IdentitySequence" (
    "id" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentitySequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'PLAYER',
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'CREATED',
    "publicNmdId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "phone" TEXT,
    "verificationNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "csRole" TEXT,
    "identityRole" TEXT,
    "avatarUrl" TEXT,
    "currentNr" INTEGER NOT NULL DEFAULT 1000,
    "floor" INTEGER NOT NULL DEFAULT 1,
    "verifiedMatches" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "tournamentsPlayed" INTEGER NOT NULL DEFAULT 0,
    "tournamentsWon" INTEGER NOT NULL DEFAULT 0,
    "currentTeamId" TEXT,
    "homeCafeId" TEXT,

    CONSTRAINT "PlayerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cafe" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "district" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cafe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT,
    "cafeId" TEXT,
    "captainId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "isStarter" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamInvitation" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "TeamInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "game" TEXT NOT NULL DEFAULT 'Counter-Strike 2',
    "format" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "teamSize" INTEGER NOT NULL DEFAULT 5,
    "startersPerTeam" INTEGER NOT NULL DEFAULT 5,
    "maxSubstitutes" INTEGER NOT NULL DEFAULT 1,
    "rulesVersion" TEXT NOT NULL DEFAULT '1.0',
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "cafeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentRegistration" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "checkedInAt" TIMESTAMP(3),
    "checkInStatus" TEXT NOT NULL DEFAULT 'NOT_CHECKED_IN',
    "checkInNote" TEXT,
    "rosterLockedAt" TIMESTAMP(3),

    CONSTRAINT "TournamentRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentRosterMember" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "isStarter" BOOLEAN NOT NULL DEFAULT true,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "TournamentRosterMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "round" TEXT NOT NULL,
    "bracketOrder" INTEGER NOT NULL,
    "teamAId" TEXT,
    "teamBId" TEXT,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "result" "MatchResult",
    "winnerTeamId" TEXT,
    "teamAScore" INTEGER,
    "teamBScore" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchParticipant" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "isSubstitute" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MatchParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapVeto" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "teamId" TEXT NOT NULL,
    "action" "VetoAction" NOT NULL,
    "mapName" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3),

    CONSTRAINT "MapVeto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultConfirmation" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "decision" "ConfirmationDecision" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerNrSnapshot" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "nr" INTEGER NOT NULL,

    CONSTRAINT "PlayerNrSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingEvent" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatingTransaction" (
    "id" TEXT NOT NULL,
    "rankingEventId" TEXT,
    "playerId" TEXT NOT NULL,
    "type" "RatingTransactionType" NOT NULL,
    "delta" INTEGER NOT NULL,
    "beforeNr" INTEGER NOT NULL,
    "afterNr" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RatingTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "kind" "AchievementKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerAchievement" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentAward" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "kind" "TournamentAwardKind" NOT NULL,
    "nrDelta" INTEGER NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RulesAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tournamentId" TEXT,
    "rulesVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RulesAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "matchId" TEXT,
    "reporterId" TEXT,
    "reviewerId" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'REPORTED',
    "penalty" "PenaltyLevel" NOT NULL DEFAULT 'NONE',
    "evidenceRef" TEXT,
    "playerResponse" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suspension" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issuedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Suspension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchCorrection" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "reason" TEXT NOT NULL,
    "previousData" JSONB NOT NULL,
    "correctedData" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "MatchCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "tournamentId" TEXT,
    "matchId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_publicNmdId_key" ON "User"("publicNmdId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateIdentity_userId_key" ON "PrivateIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerProfile_userId_key" ON "PlayerProfile"("userId");

-- CreateIndex
CREATE INDEX "PlayerProfile_currentNr_idx" ON "PlayerProfile"("currentNr");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerProfile_nickname_key" ON "PlayerProfile"("nickname");

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE INDEX "TeamMembership_playerId_leftAt_idx" ON "TeamMembership"("playerId", "leftAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_teamId_playerId_joinedAt_key" ON "TeamMembership"("teamId", "playerId", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvitation_teamId_playerId_status_key" ON "TeamInvitation"("teamId", "playerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentRegistration_tournamentId_teamId_key" ON "TournamentRegistration"("tournamentId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentRosterMember_registrationId_playerId_key" ON "TournamentRosterMember"("registrationId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_tournamentId_round_bracketOrder_key" ON "Match"("tournamentId", "round", "bracketOrder");

-- CreateIndex
CREATE INDEX "MatchParticipant_matchId_teamId_idx" ON "MatchParticipant"("matchId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchParticipant_matchId_playerId_key" ON "MatchParticipant"("matchId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "MapVeto_matchId_sequence_key" ON "MapVeto"("matchId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ResultConfirmation_matchId_teamId_key" ON "ResultConfirmation"("matchId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerNrSnapshot_matchId_playerId_key" ON "PlayerNrSnapshot"("matchId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "RankingEvent_matchId_key" ON "RankingEvent"("matchId");

-- CreateIndex
CREATE INDEX "RatingTransaction_playerId_createdAt_idx" ON "RatingTransaction"("playerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_kind_key" ON "Achievement"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerAchievement_playerId_achievementId_key" ON "PlayerAchievement"("playerId", "achievementId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentAward_tournamentId_playerId_kind_key" ON "TournamentAward"("tournamentId", "playerId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "RulesAcceptance_userId_tournamentId_rulesVersion_key" ON "RulesAcceptance"("userId", "tournamentId", "rulesVersion");

-- CreateIndex
CREATE INDEX "Incident_tournamentId_status_idx" ON "Incident"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_createdAt_idx" ON "AuditEvent"("entityType", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "PrivateIdentity" ADD CONSTRAINT "PrivateIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_currentTeamId_fkey" FOREIGN KEY ("currentTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_homeCafeId_fkey" FOREIGN KEY ("homeCafeId") REFERENCES "Cafe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_cafeId_fkey" FOREIGN KEY ("cafeId") REFERENCES "Cafe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "PlayerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "PlayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "PlayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_cafeId_fkey" FOREIGN KEY ("cafeId") REFERENCES "Cafe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRosterMember" ADD CONSTRAINT "TournamentRosterMember_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "TournamentRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRosterMember" ADD CONSTRAINT "TournamentRosterMember_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "PlayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_teamAId_fkey" FOREIGN KEY ("teamAId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_teamBId_fkey" FOREIGN KEY ("teamBId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "PlayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapVeto" ADD CONSTRAINT "MapVeto_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapVeto" ADD CONSTRAINT "MapVeto_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultConfirmation" ADD CONSTRAINT "ResultConfirmation_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultConfirmation" ADD CONSTRAINT "ResultConfirmation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerNrSnapshot" ADD CONSTRAINT "PlayerNrSnapshot_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerNrSnapshot" ADD CONSTRAINT "PlayerNrSnapshot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "PlayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingEvent" ADD CONSTRAINT "RankingEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingTransaction" ADD CONSTRAINT "RatingTransaction_rankingEventId_fkey" FOREIGN KEY ("rankingEventId") REFERENCES "RankingEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingTransaction" ADD CONSTRAINT "RatingTransaction_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "PlayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAchievement" ADD CONSTRAINT "PlayerAchievement_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "PlayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAchievement" ADD CONSTRAINT "PlayerAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentAward" ADD CONSTRAINT "TournamentAward_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentAward" ADD CONSTRAINT "TournamentAward_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "PlayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulesAcceptance" ADD CONSTRAINT "RulesAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulesAcceptance" ADD CONSTRAINT "RulesAcceptance_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suspension" ADD CONSTRAINT "Suspension_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suspension" ADD CONSTRAINT "Suspension_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCorrection" ADD CONSTRAINT "MatchCorrection_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCorrection" ADD CONSTRAINT "MatchCorrection_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCorrection" ADD CONSTRAINT "MatchCorrection_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
