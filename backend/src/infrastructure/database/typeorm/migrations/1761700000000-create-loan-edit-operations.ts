import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLoanEditOperations1761700000000 implements MigrationInterface {
  name = 'CreateLoanEditOperations1761700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "loan_edit_operations" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "loan_id" uuid NOT NULL,
      "created_by_user_id" uuid NOT NULL,
      "idempotency_key" varchar(128) NOT NULL,
      "idempotency_fingerprint" varchar(64) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_loan_edit_operations" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_loan_edit_operations_key" UNIQUE ("idempotency_key"),
      CONSTRAINT "CHK_loan_edit_operations_fingerprint" CHECK ("idempotency_fingerprint" ~ '^[0-9a-f]{64}$'),
      CONSTRAINT "FK_loan_edit_operations_loan" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_loan_edit_operations_actor" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
    )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "loan_edit_operations"`);
  }
}
