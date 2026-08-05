ALTER TABLE "historical_import_files" ADD COLUMN "lease_key" VARCHAR(64);

UPDATE "historical_import_files" AS import_file
SET "lease_key" = dataset."dataset"::text || ':' || COALESCE(dataset."season"::text, 'global')
FROM "historical_datasets" AS dataset
WHERE dataset."id" = import_file."dataset_id";

ALTER TABLE "historical_import_files" ALTER COLUMN "lease_key" SET NOT NULL;

DROP INDEX "historical_import_files_active_dataset_key";

CREATE UNIQUE INDEX "historical_import_files_active_lease_key"
ON "historical_import_files"("lease_key")
WHERE "status" = 'RUNNING';

CREATE UNIQUE INDEX "historical_datasets_global_identity_key"
ON "historical_datasets"("dataset", COALESCE("season", -1), "release_id");
