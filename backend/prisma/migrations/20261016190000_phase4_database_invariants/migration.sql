BEGIN;
-- Prospective protections for the approved final governance version. No existing
-- rows, snapshots, historical policies or previous migration files are rewritten.
CREATE FUNCTION "enforce_phase4_entrant_invariants"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_id TEXT; event_row "Tournament"%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME = 'Tournament' THEN
  event_id := NEW."id";
 ELSIF TG_TABLE_NAME = 'TournamentRegistration' THEN
  event_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."tournamentId" ELSE NEW."tournamentId" END;
 ELSE
  SELECT "tournamentId" INTO event_id FROM "TournamentRegistration"
   WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."registrationId" ELSE NEW."registrationId" END;
 END IF;
 SELECT * INTO event_row FROM "Tournament" WHERE "id" = event_id FOR UPDATE;
 IF event_row."configurationPolicy" IS DISTINCT FROM 'PHASE3_FREE_OPEN_V1' OR
    event_row."rulesVersion" IS DISTINCT FROM 'OWNER_PHASE4_FINAL_2026_10_16' THEN RETURN NULL; END IF;
 -- The volatile trigger's reads get fresh command snapshots after the parent
 -- lock in READ COMMITTED. SERIALIZABLE additionally uses PostgreSQL SSI.
 -- Reject the stale-snapshot isolation level rather than silently weaken checks.
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable') THEN
  RAISE EXCEPTION 'PHASE4_UNSUPPORTED_ISOLATION' USING ERRCODE = '23514';
 END IF;
 IF (SELECT count(*) FROM "TournamentRegistration" WHERE "tournamentId" = event_id
     AND "withdrawnAt" IS NULL AND "disqualifiedAt" IS NULL) > event_row."capacity" THEN
  RAISE EXCEPTION 'TOURNAMENT_CAPACITY_REACHED' USING ERRCODE = '23514';
 END IF;
 IF EXISTS (
  SELECT m."playerId" FROM "TournamentRosterMember" m
  JOIN "TournamentRegistration" r ON r."id" = m."registrationId"
  WHERE r."tournamentId" = event_id AND r."withdrawnAt" IS NULL AND r."disqualifiedAt" IS NULL
  GROUP BY m."playerId" HAVING count(*) > 1
 ) THEN RAISE EXCEPTION 'DUPLICATE_TOURNAMENT_PARTICIPATION' USING ERRCODE = '23505'; END IF;
 RETURN NULL;
END; $$;
CREATE TRIGGER "phase4_capacity_and_participation_registration" AFTER INSERT OR UPDATE OR DELETE ON "TournamentRegistration"
 FOR EACH ROW EXECUTE FUNCTION "enforce_phase4_entrant_invariants"();
CREATE TRIGGER "phase4_capacity_and_participation_roster" AFTER INSERT OR UPDATE OR DELETE ON "TournamentRosterMember"
 FOR EACH ROW EXECUTE FUNCTION "enforce_phase4_entrant_invariants"();
CREATE TRIGGER "phase4_capacity_and_participation_settings" AFTER INSERT OR UPDATE ON "Tournament"
 FOR EACH ROW EXECUTE FUNCTION "enforce_phase4_entrant_invariants"();

CREATE FUNCTION "preserve_phase4_governance_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."configurationPolicy" = 'PHASE3_FREE_OPEN_V1' AND OLD."rulesVersion" = 'OWNER_PHASE4_FINAL_2026_10_16' AND
  (NEW."configurationPolicy" IS DISTINCT FROM OLD."configurationPolicy" OR NEW."rulesVersion" IS DISTINCT FROM OLD."rulesVersion") THEN
  RAISE EXCEPTION 'PHASE4_POLICY_DOWNGRADE_UNAVAILABLE' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "phase4_governance_scope_guard" BEFORE UPDATE ON "Tournament"
 FOR EACH ROW EXECUTE FUNCTION "preserve_phase4_governance_scope"();

CREATE FUNCTION "validate_phase4_lock_snapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_row "Tournament"%ROWTYPE; reg RECORD; member RECORD; json_entry JSONB;
 actual_lineup JSONB; expected_lineup JSONB; actual_ids TEXT[]; expected_ids TEXT[];
 active_count INTEGER := 0; starter_count INTEGER; eligible_count INTEGER;
BEGIN
 SELECT * INTO event_row FROM "Tournament" WHERE "id" = NEW."tournamentId" FOR UPDATE;
 IF event_row."configurationPolicy" IS DISTINCT FROM 'PHASE3_FREE_OPEN_V1' OR
    event_row."rulesVersion" IS DISTINCT FROM 'OWNER_PHASE4_FINAL_2026_10_16' THEN
  RAISE EXCEPTION 'SNAPSHOT_REQUIRES_FINAL_GOVERNANCE' USING ERRCODE = '23514';
 END IF;
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable') THEN
  RAISE EXCEPTION 'PHASE4_UNSUPPORTED_ISOLATION' USING ERRCODE = '23514'; END IF;
 IF event_row."status" <> 'ROSTER_LOCKED' OR event_row."startsAt" IS NULL OR
    NEW."lockedAt" < (event_row."startsAt" AT TIME ZONE 'UTC') OR NEW."rulesVersion" <> event_row."rulesVersion" THEN
  RAISE EXCEPTION 'INVALID_SNAPSHOT_LOCK_STATE' USING ERRCODE = '23514'; END IF;
 -- Match application lock order and hold verification/profile/membership facts
 -- stable until the snapshot and all roster/settings changes commit.
 PERFORM u."id" FROM "User" u JOIN "PlayerProfile" p ON p."userId" = u."id"
  WHERE p."id" IN (SELECT m."playerId" FROM "TournamentRosterMember" m JOIN "TournamentRegistration" r ON r."id" = m."registrationId"
    WHERE r."tournamentId" = NEW."tournamentId" AND r."withdrawnAt" IS NULL AND r."disqualifiedAt" IS NULL)
  ORDER BY u."id" FOR UPDATE OF u;
 PERFORM i."id" FROM "ExternalIdentity" i WHERE i."userId" IN (
  SELECT p."userId" FROM "PlayerProfile" p JOIN "TournamentRosterMember" m ON m."playerId" = p."id"
   JOIN "TournamentRegistration" r ON r."id" = m."registrationId"
   WHERE r."tournamentId" = NEW."tournamentId" AND r."withdrawnAt" IS NULL AND r."disqualifiedAt" IS NULL)
  ORDER BY i."id" FOR SHARE;
 PERFORM p."id" FROM "PlayerProfile" p WHERE p."id" IN (
  SELECT m."playerId" FROM "TournamentRosterMember" m JOIN "TournamentRegistration" r ON r."id" = m."registrationId"
   WHERE r."tournamentId" = NEW."tournamentId" AND r."withdrawnAt" IS NULL AND r."disqualifiedAt" IS NULL)
  ORDER BY p."id" FOR UPDATE;
 PERFORM t."id" FROM "Team" t WHERE t."id" IN (
  SELECT "teamId" FROM "TournamentRegistration" WHERE "tournamentId" = NEW."tournamentId"
   AND "withdrawnAt" IS NULL AND "disqualifiedAt" IS NULL) ORDER BY t."id" FOR UPDATE;
 PERFORM tm."id" FROM "TeamMembership" tm WHERE tm."teamId" IN (
  SELECT "teamId" FROM "TournamentRegistration" WHERE "tournamentId" = NEW."tournamentId"
   AND "withdrawnAt" IS NULL AND "disqualifiedAt" IS NULL) AND tm."leftAt" IS NULL FOR SHARE;

 FOR reg IN SELECT * FROM "TournamentRegistration" WHERE "tournamentId" = NEW."tournamentId"
   AND "withdrawnAt" IS NULL AND "disqualifiedAt" IS NULL LOOP
  IF reg."status" <> 'APPROVED' OR reg."rosterLockedAt" IS NULL OR
     (reg."rosterLockedAt" AT TIME ZONE 'UTC') <> NEW."lockedAt" OR
     (event_row."format" = '1v1') IS DISTINCT FROM (reg."soloPlayerId" IS NOT NULL) THEN
   RAISE EXCEPTION 'SNAPSHOT_REGISTRATION_NOT_LOCKED' USING ERRCODE = '23514'; END IF;
  SELECT count(*) FILTER (WHERE "isStarter"), count(*) INTO starter_count, eligible_count
   FROM "TournamentRosterMember" WHERE "registrationId" = reg."id";
  IF starter_count <> event_row."startersPerTeam" OR eligible_count - starter_count > event_row."maxSubstitutes" THEN
   RAISE EXCEPTION 'SNAPSHOT_INCOMPLETE_ENTRANT' USING ERRCODE = '23514'; END IF;
  FOR member IN SELECT m.*, p."userId", p."floor", u."accountStatus" FROM "TournamentRosterMember" m
    JOIN "PlayerProfile" p ON p."id" = m."playerId" JOIN "User" u ON u."id" = p."userId"
    WHERE m."registrationId" = reg."id" AND m."isStarter" LOOP
   IF member."floor" < 1 OR member."accountStatus" NOT IN ('ACTIVE','VERIFIED') OR
      (reg."soloPlayerId" IS NOT NULL AND reg."soloPlayerId" <> member."playerId") OR
      (reg."teamId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "TeamMembership" WHERE "teamId" = reg."teamId" AND "playerId" = member."playerId" AND "leftAt" IS NULL)) THEN
    RAISE EXCEPTION 'SNAPSHOT_STARTER_INELIGIBLE' USING ERRCODE = '23514'; END IF;
   IF (SELECT count(DISTINCT "provider") FROM "ExternalIdentity" WHERE "userId" = member."userId"
     AND "provider" IN ('STEAM','DISCORD') AND "verifiedAt" IS NOT NULL AND "revokedAt" IS NULL AND "administrativeHoldAt" IS NULL) <> 2 THEN
    RAISE EXCEPTION 'SNAPSHOT_IDENTITY_REQUIRED' USING ERRCODE = '23514'; END IF;
   IF member."checkedInAt" IS NULL OR member."checkInRuleVersion" IS DISTINCT FROM event_row."rulesVersion" OR NOT (
    (member."checkedInAt" >= (event_row."startsAt" AT TIME ZONE 'UTC') - INTERVAL '15 minutes' AND member."checkedInAt" < (event_row."startsAt" AT TIME ZONE 'UTC')) OR
    EXISTS (SELECT 1 FROM "TournamentLatenessRequest" req JOIN "TournamentLatenessClaim" claim ON claim."id" = req."claimId"
      WHERE req."tournamentId" = NEW."tournamentId" AND claim."tournamentId" = NEW."tournamentId" AND claim."playerId" = member."playerId"
       AND req."policyVersion" = event_row."rulesVersion" AND req."status" = 'AUTO_APPROVED' AND req."matchId" IS NULL
       AND req."scheduledStart" = (event_row."startsAt" AT TIME ZONE 'UTC') AND req."completedAt" = member."checkedInAt"
       AND claim."usedAt" = req."completedAt" AND claim."decision" = 'AUTO_APPROVED')
   ) THEN RAISE EXCEPTION 'SNAPSHOT_ATTENDANCE_REQUIRED' USING ERRCODE = '23514'; END IF;
   active_count := active_count + 1;
  END LOOP;
 END LOOP;
 IF EXISTS (SELECT m."playerId" FROM "TournamentRosterMember" m JOIN "TournamentRegistration" r ON r."id" = m."registrationId"
  WHERE r."tournamentId" = NEW."tournamentId" AND r."withdrawnAt" IS NULL AND r."disqualifiedAt" IS NULL AND m."isStarter"
  GROUP BY m."playerId" HAVING count(*) > 1) THEN
  RAISE EXCEPTION 'SNAPSHOT_DUPLICATE_STARTER' USING ERRCODE = '23505'; END IF;
 IF NEW."activePlayerCount" <> active_count THEN RAISE EXCEPTION 'SNAPSHOT_PARTICIPANT_COUNT_MISMATCH' USING ERRCODE = '23514'; END IF;
 IF jsonb_typeof(NEW."snapshot"->'entrants') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'SNAPSHOT_ENTRANTS_REQUIRED' USING ERRCODE = '23514'; END IF;
 FOR json_entry IN SELECT value FROM jsonb_array_elements(NEW."snapshot"->'entrants') LOOP
  IF jsonb_typeof(json_entry->'players') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'SNAPSHOT_PLAYERS_REQUIRED' USING ERRCODE = '23514'; END IF;
 END LOOP;
 SELECT array_agg(e->>'registrationId' ORDER BY e->>'registrationId') INTO actual_ids FROM jsonb_array_elements(NEW."snapshot"->'entrants') e;
 SELECT array_agg("id" ORDER BY "id") INTO expected_ids FROM "TournamentRegistration"
  WHERE "tournamentId" = NEW."tournamentId" AND "withdrawnAt" IS NULL AND "disqualifiedAt" IS NULL;
 IF actual_ids IS DISTINCT FROM expected_ids THEN RAISE EXCEPTION 'SNAPSHOT_ENTRANT_SET_MISMATCH' USING ERRCODE = '23514'; END IF;
 SELECT jsonb_agg(jsonb_build_object('registrationId',e->>'registrationId','playerId',p->>'playerId','activeStarter',p->'activeStarter')
   ORDER BY e->>'registrationId',p->>'playerId') INTO actual_lineup
  FROM jsonb_array_elements(NEW."snapshot"->'entrants') e CROSS JOIN LATERAL jsonb_array_elements(e->'players') p;
 SELECT jsonb_agg(jsonb_build_object('registrationId',r."id",'playerId',m."playerId",'activeStarter',m."isStarter")
   ORDER BY r."id",m."playerId") INTO expected_lineup
  FROM "TournamentRegistration" r JOIN "TournamentRosterMember" m ON m."registrationId" = r."id"
  WHERE r."tournamentId" = NEW."tournamentId" AND r."withdrawnAt" IS NULL AND r."disqualifiedAt" IS NULL;
 IF actual_lineup IS DISTINCT FROM expected_lineup THEN RAISE EXCEPTION 'SNAPSHOT_LINEUP_MISMATCH' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "phase4_snapshot_verified_insert" BEFORE INSERT ON "TournamentLockSnapshot"
 FOR EACH ROW EXECUTE FUNCTION "validate_phase4_lock_snapshot"();
COMMIT;
