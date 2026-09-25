import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDta2026Tables1760000000000 implements MigrationInterface {
  name = 'CreateDta2026Tables1760000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await queryRunner.query(`CREATE TABLE "provinces" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "official_code" varchar(1) NOT NULL, "name" varchar NOT NULL, CONSTRAINT "PK_provinces_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_provinces_official_code" UNIQUE ("official_code"))`);
    await queryRunner.query(`CREATE TABLE "cantons" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "official_code" varchar(3) NOT NULL, "name" varchar NOT NULL, "province_id" uuid NOT NULL, CONSTRAINT "PK_cantons_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_cantons_official_code" UNIQUE ("official_code"))`);
    await queryRunner.query(`CREATE INDEX "idx_cantons_province_id" ON "cantons" ("province_id")`);
    await queryRunner.query(`CREATE TABLE "districts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "official_code" varchar(5) NOT NULL, "name" varchar NOT NULL, "canton_id" uuid NOT NULL, CONSTRAINT "PK_districts_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_districts_official_code" UNIQUE ("official_code"))`);
    await queryRunner.query(`CREATE INDEX "idx_districts_canton_id" ON "districts" ("canton_id")`);
    await queryRunner.query(`ALTER TABLE "cantons" ADD CONSTRAINT "FK_cantons_province_id" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "districts" ADD CONSTRAINT "FK_districts_canton_id" FOREIGN KEY ("canton_id") REFERENCES "cantons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "districts"');
    await queryRunner.query('DROP TABLE "cantons"');
    await queryRunner.query('DROP TABLE "provinces"');
  }
}
