-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "configurationPolicy" TEXT,
ADD COLUMN     "entryFee" INTEGER,
ADD COLUMN     "hostUserId" TEXT;

-- CreateIndex
CREATE INDEX "Tournament_hostUserId_status_idx" ON "Tournament"("hostUserId", "status");

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Legacy events retain NULL policy/ownership/fee; no historical host is guessed.
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_phase3_configuration_check" CHECK (
  "configurationPolicy" IS NULL OR (
    "configurationPolicy" = 'PHASE3_FREE_OPEN_V1' AND "hostUserId" IS NOT NULL
    AND "entryFee" IS NOT NULL AND "entryFee" = 0 AND "style" = 'Open Bracket'
    AND "format" IN ('1v1','2v2','3v3','5v5') AND "capacity" IN (2,4,8,16,32,64)
    AND "teamSize" = CASE "format" WHEN '1v1' THEN 1 WHEN '2v2' THEN 2 WHEN '3v3' THEN 3 WHEN '5v5' THEN 5 END
    AND "startersPerTeam" = "teamSize"
    AND "maxSubstitutes" = CASE "format" WHEN '5v5' THEN 1 ELSE 0 END
  )
);

-- Protect the hosting quota even when writes bypass the application service.
CREATE FUNCTION "enforce_tournament_host_quota"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."hostUserId" IS DISTINCT FROM NEW."hostUserId" THEN
    RAISE EXCEPTION 'TOURNAMENT_HOST_CHANGE_UNAVAILABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW."hostUserId" IS NULL OR NEW."status" IN ('COMPLETED','ARCHIVED') THEN RETURN NEW; END IF;
  PERFORM 1 FROM "User" WHERE "id" = NEW."hostUserId" FOR UPDATE;
  IF (SELECT COUNT(*) FROM "Tournament" WHERE "hostUserId" = NEW."hostUserId"
      AND "status" NOT IN ('COMPLETED','ARCHIVED') AND "id" <> NEW."id") >= 3 THEN
    RAISE EXCEPTION 'HOSTING_LIMIT_REACHED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Tournament_host_quota" BEFORE INSERT OR UPDATE OF "hostUserId", "status" ON "Tournament"
FOR EACH ROW EXECUTE FUNCTION "enforce_tournament_host_quota"();
