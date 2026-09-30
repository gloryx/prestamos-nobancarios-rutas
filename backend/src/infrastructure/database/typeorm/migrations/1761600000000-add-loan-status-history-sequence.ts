import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLoanStatusHistorySequence1761600000000 implements MigrationInterface {
  name = 'AddLoanStatusHistorySequence1761600000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "loan_status_history" ADD "event_sequence" integer NOT NULL, ADD "idempotency_key" character varying(128), ADD "idempotency_fingerprint" text`);
    await q.query(`CREATE UNIQUE INDEX "UQ_loan_status_history_loan_sequence" ON "loan_status_history" ("loan_id", "event_sequence")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_loan_status_history_idempotency_key" ON "loan_status_history" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "UQ_loan_status_history_idempotency_key"`);
    await q.query(`DROP INDEX "UQ_loan_status_history_loan_sequence"`);
    await q.query(`ALTER TABLE "loan_status_history" DROP COLUMN "idempotency_fingerprint", DROP COLUMN "idempotency_key", DROP COLUMN "event_sequence"`);
  }
}
