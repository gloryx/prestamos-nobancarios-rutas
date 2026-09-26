import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePayments1761400000000 implements MigrationInterface {
  name = 'CreatePayments1761400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loans" ADD "payment_plan_idempotency_key" character varying(128), ADD "payment_plan_idempotency_fingerprint" text`);
    await queryRunner.query(`ALTER TABLE "payment_plan_entries" DROP CONSTRAINT "CHK_payment_plan_amount"`);
    await queryRunner.query(`ALTER TABLE "payment_plan_entries" ADD CONSTRAINT "CHK_payment_plan_amount" CHECK ("pending_amount" >= 0)`);
    await queryRunner.query(`ALTER TABLE "cash_movements" ADD "payment_id" uuid`);
    await queryRunner.query(`ALTER TABLE "cash_movements" ADD CONSTRAINT "CHK_customer_payment_identity" CHECK ("concept" <> 'CUSTOMER_PAYMENT' OR ("direction" = 'INFLOW' AND "payment_id" IS NOT NULL AND "amount" > 0))`);
    await queryRunner.query(`CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "loan_id" uuid NOT NULL, "amount" numeric(18,2) NOT NULL, "principal_applied" numeric(18,2) NOT NULL, "interest_applied" numeric(18,2) NOT NULL, "payment_date" date NOT NULL, "method_id" uuid NOT NULL, "collector_id" uuid, "created_by_user_id" uuid NOT NULL, "status" character varying NOT NULL, "idempotency_key" character varying(128), "idempotency_fingerprint" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_payments" PRIMARY KEY ("id"), CONSTRAINT "UQ_payments_idempotency" UNIQUE ("idempotency_key"), CONSTRAINT "CHK_payments_amount" CHECK ("amount" > 0), CONSTRAINT "CHK_payments_equation" CHECK ("amount" = "principal_applied" + "interest_applied"), CONSTRAINT "CHK_payments_status" CHECK ("status" IN ('VALID','ANNULLED')))`);
    await queryRunner.query(`CREATE TABLE "payment_applications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "payment_id" uuid NOT NULL, "payment_plan_entry_id" uuid NOT NULL, "amount_applied" numeric(18,2) NOT NULL, "pending_before" numeric(18,2) NOT NULL, "pending_after" numeric(18,2) NOT NULL, "carried_forward_amount" numeric(18,2) NOT NULL DEFAULT 0, "carried_to_plan_entry_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_payment_applications" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "payment_annulments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "payment_id" uuid NOT NULL, "reason" text NOT NULL, "annulled_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by_user_id" uuid NOT NULL, "idempotency_key" character varying(128) NOT NULL, "idempotency_fingerprint" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_payment_annulments" PRIMARY KEY ("id"), CONSTRAINT "UQ_payment_annulments_payment" UNIQUE ("payment_id"), CONSTRAINT "UQ_payment_annulments_key" UNIQUE ("idempotency_key"))`);
    await queryRunner.query(`ALTER TABLE "payments" ADD CONSTRAINT "FK_payments_loan" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT; ALTER TABLE "payments" ADD CONSTRAINT "FK_payments_method" FOREIGN KEY ("method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT; ALTER TABLE "payments" ADD CONSTRAINT "FK_payments_user" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT; ALTER TABLE "payment_applications" ADD CONSTRAINT "FK_payment_applications_payment" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT; ALTER TABLE "payment_applications" ADD CONSTRAINT "FK_payment_applications_entry" FOREIGN KEY ("payment_plan_entry_id") REFERENCES "payment_plan_entries"("id") ON DELETE RESTRICT; ALTER TABLE "payment_annulments" ADD CONSTRAINT "FK_payment_annulments_payment" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT; ALTER TABLE "payment_annulments" ADD CONSTRAINT "FK_payment_annulments_user" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT; ALTER TABLE "cash_movements" ADD CONSTRAINT "FK_cash_movements_payment" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_cash_movements_payment_unique" ON "cash_movements" ("payment_id") WHERE "payment_id" IS NOT NULL; CREATE UNIQUE INDEX "IDX_customer_payment_unique" ON "cash_movements" ("concept", "payment_id") WHERE "concept" = 'CUSTOMER_PAYMENT' AND "payment_id" IS NOT NULL; CREATE INDEX "IDX_payments_loan_date" ON "payments" ("loan_id", "payment_date", "created_at", "id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_payments_loan_date"; DROP INDEX "IDX_customer_payment_unique"; DROP INDEX "IDX_cash_movements_payment_unique"`);
    await queryRunner.query(`ALTER TABLE "cash_movements" DROP CONSTRAINT "CHK_customer_payment_identity"`);
    await queryRunner.query(`ALTER TABLE "cash_movements" DROP CONSTRAINT "FK_cash_movements_payment"`);
    await queryRunner.query(`DROP TABLE "payment_annulments"; DROP TABLE "payment_applications"; DROP TABLE "payments"`);
    await queryRunner.query(`ALTER TABLE "cash_movements" DROP COLUMN "payment_id"`);
    await queryRunner.query(`ALTER TABLE "payment_plan_entries" DROP CONSTRAINT "CHK_payment_plan_amount"; ALTER TABLE "payment_plan_entries" ADD CONSTRAINT "CHK_payment_plan_amount" CHECK ("pending_amount" > 0)`);
    await queryRunner.query(`ALTER TABLE "loans" DROP COLUMN "payment_plan_idempotency_fingerprint", DROP COLUMN "payment_plan_idempotency_key"`);
  }
}
