import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRoutes1760400000000 implements MigrationInterface {
  name = 'CreateRoutes1760400000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await queryRunner.query(`CREATE TABLE "routes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" varchar NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "PK_routes_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_routes_name_trimmed_nonblank" CHECK (btrim("name") = "name" AND btrim("name") <> ''))`);
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_routes_name_lower" ON "routes" (lower("name"))');
  }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query('DROP INDEX "UQ_routes_name_lower"'); await queryRunner.query('DROP TABLE "routes"'); }
}
