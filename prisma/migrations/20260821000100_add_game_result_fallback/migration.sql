ALTER TABLE "game_editorial_overrides"
ADD COLUMN "home_score" INTEGER,
ADD COLUMN "away_score" INTEGER,
ADD COLUMN "result_source_name" VARCHAR(160),
ADD COLUMN "result_source_url" TEXT,
ADD COLUMN "result_verified_at" TIMESTAMPTZ(3),
ADD COLUMN "result_reason" VARCHAR(500);

ALTER TABLE "game_editorial_overrides"
ADD CONSTRAINT "game_editorial_overrides_home_score_nonnegative_check"
CHECK ("home_score" IS NULL OR "home_score" >= 0),
ADD CONSTRAINT "game_editorial_overrides_away_score_nonnegative_check"
CHECK ("away_score" IS NULL OR "away_score" >= 0),
ADD CONSTRAINT "game_editorial_overrides_result_pair_check"
CHECK (("home_score" IS NULL) = ("away_score" IS NULL));
