-- PROPOSAL ONLY. NOT an installed Prisma migration. NOT authorized to execute.
-- Separate owner review, target preflight, backup/rollback plan and write approval required.
BEGIN;
ALTER TABLE public."User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE public."User" ALTER COLUMN "passwordHash" DROP NOT NULL;
COMMIT;
-- Retain existing values, defaults, unique indexes, references and identity history.
-- Nullable unique email supports multiple Discord accounts with no email.
-- Future schema.prisma changes: email String? @unique; passwordHash String?.
-- Regenerate the Prisma client only in a separately approved preparation stage.
-- Reverting NOT NULL after passwordless accounts exist is NOT an automatic rollback.
