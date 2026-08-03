-- A published matchup may exist before the NFL assigns an exact kickoff.
ALTER TABLE "games" ALTER COLUMN "start_time" DROP NOT NULL;
