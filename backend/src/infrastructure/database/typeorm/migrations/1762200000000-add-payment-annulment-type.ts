import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentAnnulmentType1762200000000 implements MigrationInterface {
  name = 'AddPaymentAnnulmentType1762200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payment_annulments"
      ADD COLUMN "annulment_type" character varying(24) NOT NULL DEFAULT 'CASH_REFUND',
      ADD CONSTRAINT "CHK_payment_annulment_type" CHECK ("annulment_type" IN ('DATA_CORRECTION','CASH_REFUND'))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payment_annulments"
      DROP CONSTRAINT "CHK_payment_annulment_type",
      DROP COLUMN "annulment_type"`);
  }
}
