import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeCustomerIdentificationFrontOptional1760700000000 implements MigrationInterface {
  name = 'MakeCustomerIdentificationFrontOptional1760700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "customers" ALTER COLUMN "identification_front_file_key" DROP NOT NULL');
    await q.query('ALTER TABLE "customers" DROP CONSTRAINT "CHK_customers_nonblank"');
    await q.query('ALTER TABLE "customers" ADD CONSTRAINT "CHK_customers_nonblank" CHECK (btrim("identification") <> \'\' AND btrim("first_name") <> \'\' AND btrim("first_last_name") <> \'\' AND btrim("primary_phone") <> \'\' AND ("identification_front_file_key" IS NULL OR btrim("identification_front_file_key") <> \'\'))');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "customers" DROP CONSTRAINT "CHK_customers_nonblank"');
    await q.query('UPDATE "customers" SET "identification_front_file_key" = \'legacy-identification\' WHERE "identification_front_file_key" IS NULL');
    await q.query('ALTER TABLE "customers" ADD CONSTRAINT "CHK_customers_nonblank" CHECK (btrim("identification") <> \'\' AND btrim("first_name") <> \'\' AND btrim("first_last_name") <> \'\' AND btrim("primary_phone") <> \'\' AND btrim("identification_front_file_key") <> \'\')');
    await q.query('ALTER TABLE "customers" ALTER COLUMN "identification_front_file_key" SET NOT NULL');
  }
}
