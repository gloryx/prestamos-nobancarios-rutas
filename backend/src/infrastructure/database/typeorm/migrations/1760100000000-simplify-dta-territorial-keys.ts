import { MigrationInterface, QueryRunner } from 'typeorm';

export class SimplifyDtaTerritorialKeys1760100000000 implements MigrationInterface {
  name = 'SimplifyDtaTerritorialKeys1760100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "districts" DROP CONSTRAINT "FK_districts_canton_id"');
    await queryRunner.query('ALTER TABLE "cantons" DROP CONSTRAINT "FK_cantons_province_id"');
    await queryRunner.query('DROP INDEX "idx_districts_canton_id"');
    await queryRunner.query('DROP INDEX "idx_cantons_province_id"');
    await queryRunner.query('ALTER TABLE "districts" DROP CONSTRAINT "UQ_districts_official_code"');
    await queryRunner.query('ALTER TABLE "cantons" DROP CONSTRAINT "UQ_cantons_official_code"');
    await queryRunner.query('ALTER TABLE "provinces" DROP CONSTRAINT "UQ_provinces_official_code"');
    await queryRunner.query('ALTER TABLE "districts" DROP CONSTRAINT "PK_districts_id"');
    await queryRunner.query('ALTER TABLE "cantons" DROP CONSTRAINT "PK_cantons_id"');
    await queryRunner.query('ALTER TABLE "provinces" DROP CONSTRAINT "PK_provinces_id"');

    await queryRunner.query('ALTER TABLE "provinces" ADD COLUMN "code" smallint');
    await queryRunner.query('ALTER TABLE "cantons" ADD COLUMN "code" smallint');
    await queryRunner.query('ALTER TABLE "cantons" ADD COLUMN "province_code" smallint');
    await queryRunner.query('ALTER TABLE "districts" ADD COLUMN "code" integer');
    await queryRunner.query('ALTER TABLE "districts" ADD COLUMN "canton_code" smallint');

    await queryRunner.query('UPDATE "provinces" SET "code" = "official_code"::smallint');
    await queryRunner.query('UPDATE "cantons" SET "code" = "cantons"."official_code"::smallint, "province_code" = p."official_code"::smallint FROM "provinces" p WHERE "cantons"."province_id" = p."id"');
    await queryRunner.query('UPDATE "districts" SET "code" = "districts"."official_code"::integer, "canton_code" = c."official_code"::smallint FROM "cantons" c WHERE "districts"."canton_id" = c."id"');

    await queryRunner.query(`DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "provinces" WHERE "code" IS NULL)
          OR EXISTS (SELECT 1 FROM "provinces" WHERE "code" <= 0)
          OR EXISTS (SELECT 1 FROM "cantons" WHERE "code" IS NULL OR "province_code" IS NULL)
          OR EXISTS (SELECT 1 FROM "cantons" WHERE "code" <= 0 OR "province_code" <= 0)
          OR EXISTS (SELECT 1 FROM "districts" WHERE "code" IS NULL OR "canton_code" IS NULL)
          OR EXISTS (SELECT 1 FROM "districts" WHERE "code" <= 0 OR "canton_code" <= 0)
          OR (SELECT COUNT(*) FROM "provinces") <> (SELECT COUNT(DISTINCT "code") FROM "provinces")
          OR (SELECT COUNT(*) FROM "cantons") <> (SELECT COUNT(DISTINCT "code") FROM "cantons")
          OR (SELECT COUNT(*) FROM "districts") <> (SELECT COUNT(DISTINCT "code") FROM "districts")
          OR EXISTS (SELECT 1 FROM "cantons" c WHERE NOT EXISTS (SELECT 1 FROM "provinces" p WHERE p."code" = c."province_code"))
          OR EXISTS (SELECT 1 FROM "districts" d WHERE NOT EXISTS (SELECT 1 FROM "cantons" c WHERE c."code" = d."canton_code"))
          OR EXISTS (SELECT 1 FROM "cantons" WHERE left("code"::text, 1) <> "province_code"::text)
          OR EXISTS (SELECT 1 FROM "districts" WHERE left("code"::text, 3) <> "canton_code"::text)
          OR (SELECT COUNT(*) FROM "provinces") <> 7
          OR (SELECT COUNT(*) FROM "cantons") <> 84
          OR (SELECT COUNT(*) FROM "districts") <> 494
        THEN RAISE EXCEPTION 'DTA code mapping validation failed';
        END IF;
      END $$`);

    await queryRunner.query('ALTER TABLE "provinces" ALTER COLUMN "code" SET NOT NULL');
    await queryRunner.query('ALTER TABLE "cantons" ALTER COLUMN "code" SET NOT NULL, ALTER COLUMN "province_code" SET NOT NULL');
    await queryRunner.query('ALTER TABLE "districts" ALTER COLUMN "code" SET NOT NULL, ALTER COLUMN "canton_code" SET NOT NULL');
    await queryRunner.query('ALTER TABLE "provinces" ADD CONSTRAINT "PK_provinces_code" PRIMARY KEY ("code")');
    await queryRunner.query('ALTER TABLE "cantons" ADD CONSTRAINT "PK_cantons_code" PRIMARY KEY ("code")');
    await queryRunner.query('ALTER TABLE "districts" ADD CONSTRAINT "PK_districts_code" PRIMARY KEY ("code")');
    await queryRunner.query('CREATE INDEX "idx_cantons_province_code" ON "cantons" ("province_code")');
    await queryRunner.query('CREATE INDEX "idx_districts_canton_code" ON "districts" ("canton_code")');
    await queryRunner.query('ALTER TABLE "cantons" ADD CONSTRAINT "FK_cantons_province_code" FOREIGN KEY ("province_code") REFERENCES "provinces"("code") ON DELETE RESTRICT ON UPDATE NO ACTION');
    await queryRunner.query('ALTER TABLE "districts" ADD CONSTRAINT "FK_districts_canton_code" FOREIGN KEY ("canton_code") REFERENCES "cantons"("code") ON DELETE RESTRICT ON UPDATE NO ACTION');
    await queryRunner.query('ALTER TABLE "districts" DROP COLUMN "id", DROP COLUMN "official_code", DROP COLUMN "canton_id"');
    await queryRunner.query('ALTER TABLE "cantons" DROP COLUMN "id", DROP COLUMN "official_code", DROP COLUMN "province_id"');
    await queryRunner.query('ALTER TABLE "provinces" DROP COLUMN "id", DROP COLUMN "official_code"');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await queryRunner.query('ALTER TABLE "districts" DROP CONSTRAINT "FK_districts_canton_code"');
    await queryRunner.query('ALTER TABLE "cantons" DROP CONSTRAINT "FK_cantons_province_code"');
    await queryRunner.query('DROP INDEX "idx_districts_canton_code"');
    await queryRunner.query('DROP INDEX "idx_cantons_province_code"');
    await queryRunner.query('ALTER TABLE "districts" DROP CONSTRAINT "PK_districts_code"');
    await queryRunner.query('ALTER TABLE "cantons" DROP CONSTRAINT "PK_cantons_code"');
    await queryRunner.query('ALTER TABLE "provinces" DROP CONSTRAINT "PK_provinces_code"');
    await queryRunner.query('ALTER TABLE "provinces" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL, ADD COLUMN "official_code" varchar(1)');
    await queryRunner.query('ALTER TABLE "cantons" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL, ADD COLUMN "official_code" varchar(3), ADD COLUMN "province_id" uuid');
    await queryRunner.query('ALTER TABLE "districts" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL, ADD COLUMN "official_code" varchar(5), ADD COLUMN "canton_id" uuid');
    await queryRunner.query('UPDATE "provinces" SET "official_code" = "code"::text');
    await queryRunner.query('UPDATE "cantons" SET "official_code" = "code"::text, "province_id" = p."id" FROM "provinces" p WHERE p."code" = "cantons"."province_code"');
    await queryRunner.query('UPDATE "districts" SET "official_code" = "code"::text, "canton_id" = c."id" FROM "cantons" c WHERE c."code" = "districts"."canton_code"');
    await queryRunner.query('ALTER TABLE "provinces" ALTER COLUMN "official_code" SET NOT NULL');
    await queryRunner.query('ALTER TABLE "cantons" ALTER COLUMN "official_code" SET NOT NULL, ALTER COLUMN "province_id" SET NOT NULL');
    await queryRunner.query('ALTER TABLE "districts" ALTER COLUMN "official_code" SET NOT NULL, ALTER COLUMN "canton_id" SET NOT NULL');
    await queryRunner.query('ALTER TABLE "provinces" ADD CONSTRAINT "PK_provinces_id" PRIMARY KEY ("id"), ADD CONSTRAINT "UQ_provinces_official_code" UNIQUE ("official_code")');
    await queryRunner.query('ALTER TABLE "cantons" ADD CONSTRAINT "PK_cantons_id" PRIMARY KEY ("id"), ADD CONSTRAINT "UQ_cantons_official_code" UNIQUE ("official_code")');
    await queryRunner.query('ALTER TABLE "districts" ADD CONSTRAINT "PK_districts_id" PRIMARY KEY ("id"), ADD CONSTRAINT "UQ_districts_official_code" UNIQUE ("official_code")');
    await queryRunner.query('CREATE INDEX "idx_cantons_province_id" ON "cantons" ("province_id")');
    await queryRunner.query('CREATE INDEX "idx_districts_canton_id" ON "districts" ("canton_id")');
    await queryRunner.query('ALTER TABLE "cantons" ADD CONSTRAINT "FK_cantons_province_id" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION');
    await queryRunner.query('ALTER TABLE "districts" ADD CONSTRAINT "FK_districts_canton_id" FOREIGN KEY ("canton_id") REFERENCES "cantons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION');
    await queryRunner.query('ALTER TABLE "districts" DROP COLUMN "code", DROP COLUMN "canton_code"');
    await queryRunner.query('ALTER TABLE "cantons" DROP COLUMN "code", DROP COLUMN "province_code"');
    await queryRunner.query('ALTER TABLE "provinces" DROP COLUMN "code"');
  }
}
