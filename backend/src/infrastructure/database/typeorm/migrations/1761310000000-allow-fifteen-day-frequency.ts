import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowFifteenDayFrequency1761310000000 implements MigrationInterface {
  name = 'AllowFifteenDayFrequency1761310000000';
  async up(q: QueryRunner): Promise<void> { await q.query(`ALTER TABLE "payment_frequencies" DROP CONSTRAINT "CHK_payment_frequencies_interval_unit"`); await q.query(`ALTER TABLE "payment_frequencies" ADD CONSTRAINT "CHK_payment_frequencies_interval_unit" CHECK ("interval_unit" IN ('DAY','WEEK','DAY/15','MONTH'))`); }
  async down(q: QueryRunner): Promise<void> { await q.query(`ALTER TABLE "payment_frequencies" DROP CONSTRAINT "CHK_payment_frequencies_interval_unit"`); await q.query(`ALTER TABLE "payment_frequencies" ADD CONSTRAINT "CHK_payment_frequencies_interval_unit" CHECK ("interval_unit" IN ('DAY','WEEK','MONTH'))`); }
}
