// Prepared native-test SQL only. Importing this file never connects or executes SQL.
// Fixture values are bound with set_config(..., true) before this fixed DO block.
const detailToken='PHASE4_TEST_EXPECTED_DUPLICATE_PARTICIPATION_V1';
const sql=String.raw`DO $phase4_duplicate$
DECLARE
 fixture jsonb := current_setting('phase4.duplicate_fixture')::jsonb;
 error_state text; error_message text; error_constraint text; error_context text;
BEGIN
 BEGIN
  INSERT INTO "TournamentRosterMember" ("id", "registrationId", "playerId", "isStarter")
  VALUES (fixture->>'id', fixture->>'registrationId', fixture->>'playerId', true);
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS error_state = RETURNED_SQLSTATE, error_message = MESSAGE_TEXT,
   error_constraint = CONSTRAINT_NAME, error_context = PG_EXCEPTION_CONTEXT;
  IF error_state = '23505' AND error_message = 'DUPLICATE_TOURNAMENT_PARTICIPATION'
    AND coalesce(error_constraint, '') = ''
    AND error_context ~ '(^|\n)PL/pgSQL function (public\.)?"?enforce_phase4_entrant_invariants"?\(\) '
  THEN
   RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'DUPLICATE_TOURNAMENT_PARTICIPATION',
    DETAIL = 'PHASE4_TEST_EXPECTED_DUPLICATE_PARTICIPATION_V1';
  ELSE
   RAISE;
  END IF;
 END;
END;
$phase4_duplicate$;`;
module.exports={sql,detailToken};
