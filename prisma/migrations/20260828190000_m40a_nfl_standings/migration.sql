CREATE TABLE "standings_snapshots" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "season" INTEGER NOT NULL,
    "season_type" "SeasonType" NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "standings_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "team_standings" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "provider_order" INTEGER NOT NULL,
    "conference_rank" INTEGER,
    "playoff_seed" INTEGER,
    "wins" INTEGER,
    "losses" INTEGER,
    "ties" INTEGER,
    "win_percentage" DOUBLE PRECISION,
    "home_wins" INTEGER,
    "home_losses" INTEGER,
    "home_ties" INTEGER,
    "away_wins" INTEGER,
    "away_losses" INTEGER,
    "away_ties" INTEGER,
    "division_wins" INTEGER,
    "division_losses" INTEGER,
    "division_ties" INTEGER,
    "conference_wins" INTEGER,
    "conference_losses" INTEGER,
    "conference_ties" INTEGER,
    "points_for" INTEGER,
    "points_against" INTEGER,
    "point_differential" INTEGER,
    "streak_type" VARCHAR(4),
    "streak_length" INTEGER,
    "streak_display" VARCHAR(16),
    CONSTRAINT "team_standings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "standings_snapshots_provider_season_type_key" ON "standings_snapshots"("provider", "season", "season_type");
CREATE INDEX "standings_snapshots_public_lookup_idx" ON "standings_snapshots"("season", "season_type", "updated_at");
CREATE UNIQUE INDEX "team_standings_snapshot_team_key" ON "team_standings"("snapshot_id", "team_id");
CREATE INDEX "team_standings_snapshot_order_idx" ON "team_standings"("snapshot_id", "provider_order");
CREATE INDEX "team_standings_team_idx" ON "team_standings"("team_id");
ALTER TABLE "team_standings" ADD CONSTRAINT "team_standings_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "standings_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_standings" ADD CONSTRAINT "team_standings_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
