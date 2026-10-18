-- Backwards-compatible expansion: existing team registrations and IDs are unchanged.
-- The sole relaxed constraint allows genuine solo entries without fabricating teams.
ALTER TABLE "TournamentRegistration" ALTER COLUMN "teamId" DROP NOT NULL;
ALTER TABLE "TournamentRegistration" ADD COLUMN "soloPlayerId" TEXT REFERENCES "PlayerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN "withdrawnAt" TIMESTAMPTZ(3), ADD COLUMN "disqualifiedAt" TIMESTAMPTZ(3), ADD COLUMN "disqualificationReason" TEXT;
CREATE UNIQUE INDEX "TournamentRegistration_tournamentId_soloPlayerId_key" ON "TournamentRegistration"("tournamentId","soloPlayerId");
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "entrant_kind" CHECK (("teamId" IS NOT NULL) <> ("soloPlayerId" IS NOT NULL));
ALTER TABLE "TournamentRosterMember" ADD COLUMN "checkedInAt" TIMESTAMPTZ(3), ADD COLUMN "checkInRuleVersion" TEXT,
 ADD COLUMN "attendanceVerifiedAt" TIMESTAMPTZ(3), ADD COLUMN "attendanceEvidenceRef" TEXT;
CREATE TABLE "TournamentRegistrationPolicy" (
 "tournamentId" TEXT PRIMARY KEY REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "registrationClosesAt" TIMESTAMPTZ(3) NOT NULL, "deadlineApprovalRef" TEXT NOT NULL, "rulesVersion" TEXT NOT NULL, "attendancePolicyRef" TEXT
);
CREATE TABLE "TournamentLatenessClaim" (
 "id" TEXT PRIMARY KEY, "tournamentId" TEXT NOT NULL REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "playerId" TEXT NOT NULL REFERENCES "PlayerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "matchId" TEXT REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "scheduledStart" TIMESTAMPTZ(3) NOT NULL, "protectedDeadline" TIMESTAMPTZ(3) NOT NULL,
 "reason" TEXT NOT NULL, "evidenceRef" TEXT NOT NULL, "decision" TEXT NOT NULL DEFAULT 'PENDING_GOVERNANCE',
 "decisionById" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE, "decisionAt" TIMESTAMPTZ(3), "usedAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "lateness_window" CHECK ("protectedDeadline" = "scheduledStart" + INTERVAL '15 minutes'),
 CONSTRAINT "lateness_no_unapproved_decision" CHECK ("decision" = 'PENDING_GOVERNANCE' AND "decisionById" IS NULL AND "decisionAt" IS NULL AND "usedAt" IS NULL)
);
CREATE UNIQUE INDEX "TournamentLatenessClaim_tournamentId_playerId_key" ON "TournamentLatenessClaim"("tournamentId","playerId");
CREATE TABLE "TournamentLockSnapshot" (
 "tournamentId" TEXT PRIMARY KEY REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "lockedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lockedById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "rulesVersion" TEXT NOT NULL, "activePlayerCount" INTEGER NOT NULL, "classification" TEXT NOT NULL,
 "snapshot" JSONB NOT NULL, "digest" TEXT NOT NULL,
 CONSTRAINT "automatic_classification" CHECK ("activePlayerCount" >= 0 AND "classification" = CASE WHEN "activePlayerCount" >= 64 THEN 'GRAND_BATTLE' ELSE 'ORDINARY' END)
);
CREATE FUNCTION "immutable_tournament_snapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'LOCK_SNAPSHOT_IMMUTABLE'; END; $$;
CREATE TRIGGER "snapshot_immutable" BEFORE UPDATE OR DELETE ON "TournamentLockSnapshot" FOR EACH ROW EXECUTE FUNCTION "immutable_tournament_snapshot"();
-- Every roster/registration write takes the same parent lock as finalization.
CREATE FUNCTION "guard_tournament_registration_write"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_id TEXT;
BEGIN
 IF TG_OP = 'UPDATE' THEN
  IF TG_TABLE_NAME = 'TournamentRosterMember' THEN
   IF OLD."registrationId" <> NEW."registrationId" THEN RAISE EXCEPTION 'ENTRANT_REASSIGNMENT_UNAVAILABLE'; END IF;
  ELSIF OLD."tournamentId" <> NEW."tournamentId" THEN RAISE EXCEPTION 'ENTRANT_REASSIGNMENT_UNAVAILABLE'; END IF;
 END IF;
 IF TG_TABLE_NAME = 'TournamentRosterMember' THEN
  SELECT "tournamentId" INTO event_id FROM "TournamentRegistration" WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."registrationId" ELSE NEW."registrationId" END;
 ELSE event_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."tournamentId" ELSE NEW."tournamentId" END; END IF;
 PERFORM 1 FROM "Tournament" WHERE "id" = event_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM "TournamentLockSnapshot" WHERE "tournamentId" = event_id) THEN
  -- Withdrawal is historical status only: never mutate the frozen lineup or count.
  IF TG_TABLE_NAME = 'TournamentRegistration' AND TG_OP = 'UPDATE' THEN
   IF (to_jsonb(NEW) - 'withdrawnAt') = (to_jsonb(OLD) - 'withdrawnAt') AND NEW."withdrawnAt" IS NOT NULL THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'TOURNAMENT_ROSTER_LOCKED';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER "registration_lock_guard" BEFORE INSERT OR UPDATE OR DELETE ON "TournamentRegistration" FOR EACH ROW EXECUTE FUNCTION "guard_tournament_registration_write"();
CREATE TRIGGER "roster_lock_guard" BEFORE INSERT OR UPDATE OR DELETE ON "TournamentRosterMember" FOR EACH ROW EXECUTE FUNCTION "guard_tournament_registration_write"();
CREATE TRIGGER "policy_lock_guard" BEFORE INSERT OR UPDATE OR DELETE ON "TournamentRegistrationPolicy" FOR EACH ROW EXECUTE FUNCTION "guard_tournament_registration_write"();
CREATE FUNCTION "guard_locked_tournament_settings"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "TournamentLockSnapshot" WHERE "tournamentId" = OLD."id") AND
 (to_jsonb(NEW) - ARRAY['status','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','updatedAt']) THEN
 RAISE EXCEPTION 'TOURNAMENT_SETTINGS_LOCKED'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "settings_lock_guard" BEFORE UPDATE ON "Tournament" FOR EACH ROW EXECUTE FUNCTION "guard_locked_tournament_settings"();
