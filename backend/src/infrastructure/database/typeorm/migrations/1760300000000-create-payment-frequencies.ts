import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentFrequencies1760300000000 implements MigrationInterface {
  name = 'CreatePaymentFrequencies1760300000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await queryRunner.query(`CREATE TABLE "payment_frequencies" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" varchar NOT NULL, "interval_unit" varchar NOT NULL, "interval_value" integer NOT NULL, "display_order" integer NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "PK_payment_frequencies_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_payment_frequencies_name_trimmed_nonblank" CHECK (btrim("name") = "name" AND btrim("name") <> ''), CONSTRAINT "CHK_payment_frequencies_interval_unit" CHECK ("interval_unit" IN ('DAY', 'WEEK', 'MONTH')), CONSTRAINT "CHK_payment_frequencies_interval_value_positive" CHECK ("interval_value" > 0), CONSTRAINT "CHK_payment_frequencies_display_order_positive" CHECK ("display_order" > 0))`);
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_payment_frequencies_name_lower" ON "payment_frequencies" (lower("name"))');
    await queryRunner.query('CREATE INDEX "IDX_payment_frequencies_active_order" ON "payment_frequencies" ("is_active", "display_order")');
  }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query('DROP INDEX "IDX_payment_frequencies_active_order"'); await queryRunner.query('DROP INDEX "UQ_payment_frequencies_name_lower"'); await queryRunner.query('DROP TABLE "payment_frequencies"'); }
}
