import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PreserveAnnulledPaymentAllocation1762900000000 implements MigrationInterface {
  name = 'PreserveAnnulledPaymentAllocation1762900000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "payments" DROP CONSTRAINT "CHK_payments_equation"`);
    await q.query(`ALTER TABLE "payments" ADD CONSTRAINT "CHK_payments_equation"
      CHECK ("amount" = "principal_applied" + "interest_applied"
        AND "principal_applied" >= 0 AND "interest_applied" >= 0) NOT VALID`);
    await q.query(`ALTER TABLE "payments" VALIDATE CONSTRAINT "CHK_payments_equation"`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "payments" DROP CONSTRAINT "CHK_payments_equation"`);
    await q.query(`ALTER TABLE "payments" ADD CONSTRAINT "CHK_payments_equation" CHECK (
      ("status" = 'VALID' AND "amount" = "principal_applied" + "interest_applied"
        AND "principal_applied" >= 0 AND "interest_applied" >= 0)
      OR ("status" = 'ANNULLED' AND "principal_applied" = 0 AND "interest_applied" = 0)
    ) NOT VALID`);
    await q.query(`ALTER TABLE "payments" VALIDATE CONSTRAINT "CHK_payments_equation"`);
  }
}
