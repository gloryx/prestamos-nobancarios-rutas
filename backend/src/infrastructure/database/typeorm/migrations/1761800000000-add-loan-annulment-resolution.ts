import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLoanAnnulmentResolution1761800000000 implements MigrationInterface {
  name = 'AddLoanAnnulmentResolution1761800000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "loan_status_history" ADD "disbursement_resolution" varchar(32)`);
    await q.query(`ALTER TABLE "loan_status_history" ADD CONSTRAINT "CHK_loan_annulment_resolution"
      CHECK (CASE
        WHEN "event_kind" = 'TRANSITION' AND "from_status" = 'ACTIVE' AND "to_status" = 'ANNULLED'
        THEN "disbursement_resolution" IS NOT NULL
          AND "disbursement_resolution" IN ('NOT_DELIVERED', 'RETURNED_IN_FULL')
        ELSE "disbursement_resolution" IS NULL
      END)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "loan_status_history" DROP CONSTRAINT "CHK_loan_annulment_resolution"`);
    await q.query(`ALTER TABLE "loan_status_history" DROP COLUMN "disbursement_resolution"`);
  }
}
