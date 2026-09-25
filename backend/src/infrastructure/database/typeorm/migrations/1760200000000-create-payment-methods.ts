import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentMethods1760200000000 implements MigrationInterface {
  name = 'CreatePaymentMethods1760200000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await queryRunner.query(`CREATE TABLE "payment_methods" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" varchar NOT NULL, "display_order" integer NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "PK_payment_methods_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_payment_methods_name_trimmed_nonblank" CHECK (btrim("name") = "name" AND btrim("name") <> ''), CONSTRAINT "CHK_payment_methods_display_order_positive" CHECK ("display_order" > 0))`);
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_payment_methods_name_lower" ON "payment_methods" (lower("name"))');
    await queryRunner.query('CREATE INDEX "IDX_payment_methods_active_order" ON "payment_methods" ("is_active", "display_order")');
  }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query('DROP INDEX "IDX_payment_methods_active_order"'); await queryRunner.query('DROP INDEX "UQ_payment_methods_name_lower"'); await queryRunner.query('DROP TABLE "payment_methods"'); }
}
