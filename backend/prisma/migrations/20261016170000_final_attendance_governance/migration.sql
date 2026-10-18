BEGIN;
-- Expand constraints prospectively; no old rows, policy versions or migrations are rewritten.
ALTER TABLE "Tournament" DROP CONSTRAINT "Tournament_phase3_configuration_check";


-- Legacy events retain NULL policy/ownership/fee; no historical host is guessed.
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_phase3_configuration_check" CHECK (
  "configurationPolicy" IS NULL OR (
    "configurationPolicy" = 'PHASE3_FREE_OPEN_V1' AND "hostUserId" IS NOT NULL
    AND "entryFee" IS NOT NULL AND "entryFee" = 0 AND "style" = 'Open Bracket'
    AND "format" IN ('1v1','2v2','3v3','5v5') AND "capacity" IN (2,4,8,16,32,64)
    AND "teamSize" = CASE "format" WHEN '1v1' THEN 1 WHEN '2v2' THEN 2 WHEN '3v3' THEN 3 WHEN '5v5' THEN 5 END
    AND "startersPerTeam" = "teamSize"
    AND "maxSubstitutes" = CASE WHEN "format" = '1v1' THEN 0 WHEN "format" = '5v5' OR "rulesVersion" = 'OWNER_PHASE4_FINAL_2026_10_16' THEN 1 ELSE 0 END
  )
);
ALTER TABLE "TournamentLatenessClaim" ADD COLUMN "policyVersion" TEXT;
ALTER TABLE "TournamentLatenessClaim" DROP CONSTRAINT "lateness_no_unapproved_decision";
ALTER TABLE "TournamentLatenessClaim" ADD CONSTRAINT "lateness_versioned_decision" CHECK (
 ("policyVersion" IS NULL AND "decision" = 'PENDING_GOVERNANCE' AND "decisionById" IS NULL AND "decisionAt" IS NULL AND "usedAt" IS NULL)
 OR ("policyVersion" IS NOT NULL AND "policyVersion" = 'OWNER_PHASE4_FINAL_2026_10_16' AND (
  ("decision" = 'REQUESTED' AND "usedAt" IS NULL AND "decisionAt" IS NULL AND "decisionById" IS NULL)
  OR ("decision" = 'EXPIRED' AND "usedAt" IS NULL AND "decisionAt" IS NOT NULL)
  OR ("decision" = 'AUTO_APPROVED' AND "usedAt" IS NOT NULL AND "decisionAt" IS NOT NULL AND "decisionById" IS NOT NULL AND "decisionAt" = "usedAt")
 ))
);
CREATE TABLE "TournamentLatenessRequest" (
 "id" TEXT PRIMARY KEY,
 "claimId" TEXT NOT NULL REFERENCES "TournamentLatenessClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "tournamentId" TEXT NOT NULL REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "matchId" TEXT REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "scheduledStart" TIMESTAMPTZ(3) NOT NULL, "protectedDeadline" TIMESTAMPTZ(3) NOT NULL,
 "reason" TEXT NOT NULL CHECK (length(trim("reason")) > 0), "policyVersion" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'REQUESTED', "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "completedAt" TIMESTAMPTZ(3), "expiredAt" TIMESTAMPTZ(3),
 CONSTRAINT "request_window" CHECK ("protectedDeadline" = "scheduledStart" + INTERVAL '15 minutes'),
 CONSTRAINT "request_decision" CHECK (
 ("status" = 'REQUESTED' AND "completedAt" IS NULL AND "expiredAt" IS NULL)
 OR ("status" = 'EXPIRED' AND "completedAt" IS NULL AND "expiredAt" IS NOT NULL AND "expiredAt" > "protectedDeadline")
 OR ("status" = 'AUTO_APPROVED' AND "completedAt" IS NOT NULL AND "completedAt" BETWEEN "scheduledStart" AND "protectedDeadline" AND "expiredAt" IS NULL)
 )
);
CREATE INDEX "TournamentLatenessRequest_tournamentId_status_idx" ON "TournamentLatenessRequest"("tournamentId","status");
CREATE UNIQUE INDEX "one_pending_lateness_request" ON "TournamentLatenessRequest"("claimId") WHERE "status" = 'REQUESTED';
CREATE UNIQUE INDEX "one_consumed_lateness_request" ON "TournamentLatenessRequest"("claimId") WHERE "completedAt" IS NOT NULL;
CREATE TRIGGER "lateness_request_lock_guard" BEFORE INSERT OR UPDATE OR DELETE ON "TournamentLatenessRequest" FOR EACH ROW EXECUTE FUNCTION "guard_tournament_registration_write"();

CREATE FUNCTION "validate_lateness_request_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "TournamentLatenessClaim" WHERE "id" = NEW."claimId" AND "tournamentId" = NEW."tournamentId" AND "policyVersion" = NEW."policyVersion") THEN
  RAISE EXCEPTION 'LATENESS_REQUEST_SCOPE_MISMATCH';
 END IF;
 IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - ARRAY['status','completedAt','expiredAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','completedAt','expiredAt']) THEN
  RAISE EXCEPTION 'LATENESS_REQUEST_FACTS_IMMUTABLE';
 END IF;
 IF TG_OP = 'UPDATE' AND OLD."status" <> 'REQUESTED' THEN RAISE EXCEPTION 'LATENESS_DECISION_FINAL'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "lateness_request_scope" BEFORE INSERT OR UPDATE ON "TournamentLatenessRequest" FOR EACH ROW EXECUTE FUNCTION "validate_lateness_request_scope"();
CREATE FUNCTION "guard_consumed_lateness_incident"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."usedAt" IS NOT NULL THEN RAISE EXCEPTION 'LATENESS_INCIDENT_ALREADY_USED'; END IF;
 IF (to_jsonb(NEW) - ARRAY['decision','decisionAt','decisionById','usedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['decision','decisionAt','decisionById','usedAt']) THEN
  RAISE EXCEPTION 'LATENESS_INCIDENT_FACTS_IMMUTABLE';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "consumed_lateness_guard" BEFORE UPDATE ON "TournamentLatenessClaim" FOR EACH ROW EXECUTE FUNCTION "guard_consumed_lateness_incident"();

CREATE FUNCTION "preserve_lateness_history"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'LATENESS_HISTORY_IMMUTABLE'; END; $$;
CREATE TRIGGER "lateness_request_no_delete" BEFORE DELETE ON "TournamentLatenessRequest" FOR EACH ROW EXECUTE FUNCTION "preserve_lateness_history"();
CREATE TRIGGER "lateness_incident_no_delete" BEFORE DELETE ON "TournamentLatenessClaim" FOR EACH ROW EXECUTE FUNCTION "preserve_lateness_history"();

COMMIT;
