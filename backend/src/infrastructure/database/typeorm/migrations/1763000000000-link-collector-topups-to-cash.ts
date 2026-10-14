import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkCollectorTopupsToCash1763000000000 implements MigrationInterface {
  name = 'LinkCollectorTopupsToCash1763000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`DO $fn$ BEGIN
      IF EXISTS (SELECT 1 FROM collector_custody_entries WHERE entry_type = 'COMPANY_TOP_UP') THEN
        RAISE EXCEPTION 'Cannot enable collector top-up cash linkage while unlinked top-ups exist';
      END IF;
    END $fn$`);
    await q.query(`ALTER TABLE "cash_movements" DROP CONSTRAINT "CHK_cash_movement_concept"`);
    await q.query(`ALTER TABLE "cash_movements" ADD CONSTRAINT "CHK_cash_movement_concept" CHECK ("concept" IN
      ('CAPITAL_CONTRIBUTION','CAPITAL_WITHDRAWAL','EXTERNAL_INCOME','OPERATING_EXPENSE','LOAN_DISBURSEMENT',
       'CUSTOMER_PAYMENT','REFINANCING_NEW_MONEY_DISBURSEMENT','COLLECTOR_CUSTODY_TRANSFER','REVERSAL'))`);
    await q.query(`ALTER TABLE "cash_movements" ADD "collector_custody_entry_id" uuid`);
    await q.query(`ALTER TABLE "cash_movements" ADD CONSTRAINT "FK_cash_collector_custody_entry"
      FOREIGN KEY ("collector_custody_entry_id") REFERENCES "collector_custody_entries"("id") ON DELETE RESTRICT`);
    await q.query(`CREATE UNIQUE INDEX "UQ_cash_collector_custody_entry"
      ON "cash_movements" ("collector_custody_entry_id") WHERE "collector_custody_entry_id" IS NOT NULL`);
    await q.query(`ALTER TABLE "cash_movements" ADD CONSTRAINT "CHK_cash_collector_custody_transfer_pair" CHECK (
      ("concept" = 'COLLECTOR_CUSTODY_TRANSFER' AND "direction" = 'OUTFLOW' AND "collector_custody_entry_id" IS NOT NULL)
      OR ("concept" <> 'COLLECTOR_CUSTODY_TRANSFER' AND "collector_custody_entry_id" IS NULL))`);

    await q.query(`CREATE FUNCTION validate_collector_topup_cash() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE custody collector_custody_entries%ROWTYPE;
      BEGIN
        IF NEW.concept = 'COLLECTOR_CUSTODY_TRANSFER' THEN
          SELECT * INTO custody FROM collector_custody_entries WHERE id = NEW.collector_custody_entry_id;
          IF NOT FOUND OR custody.entry_type <> 'COMPANY_TOP_UP' OR custody.direction <> 'CREDIT'
            OR custody.amount <> NEW.amount OR custody.effective_date <> NEW.movement_date
            OR custody.payment_method_id IS DISTINCT FROM NEW.payment_method_id
            OR custody.reference IS DISTINCT FROM NEW.observations
            OR custody.created_by_user_id <> NEW.created_by_user_id THEN
            RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_cash_collector_topup_match',
              MESSAGE = 'Collector top-up cash movement does not match custody entry';
          END IF;
        END IF;
        RETURN NEW;
      END $fn$`);
    await q.query(`CREATE TRIGGER "TRG_cash_collector_topup_validate"
      BEFORE INSERT OR UPDATE ON "cash_movements" FOR EACH ROW EXECUTE FUNCTION validate_collector_topup_cash()`);

    await q.query(`CREATE FUNCTION require_collector_topup_cash() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.entry_type = 'COMPANY_TOP_UP' AND NOT EXISTS (
          SELECT 1 FROM cash_movements cash WHERE cash.collector_custody_entry_id = NEW.id
            AND cash.concept = 'COLLECTOR_CUSTODY_TRANSFER') THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_collector_topup_requires_cash',
            MESSAGE = 'Collector top-up requires a matching cash outflow';
        END IF;
        RETURN NEW;
      END $fn$`);
    await q.query(`CREATE CONSTRAINT TRIGGER "TRG_collector_topup_requires_cash"
      AFTER INSERT ON "collector_custody_entries" DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION require_collector_topup_cash()`);
    await q.query(`CREATE FUNCTION guard_collector_topup_cash_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF OLD.concept = 'COLLECTOR_CUSTODY_TRANSFER' THEN
          RAISE EXCEPTION 'collector top-up cash movements are immutable';
        END IF;
        RETURN COALESCE(NEW, OLD);
      END $fn$`);
    await q.query(`CREATE TRIGGER "TRG_collector_topup_cash_immutable"
      BEFORE UPDATE OR DELETE ON "cash_movements" FOR EACH ROW EXECUTE FUNCTION guard_collector_topup_cash_immutable()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $fn$ BEGIN
      IF EXISTS (SELECT 1 FROM cash_movements WHERE concept = 'COLLECTOR_CUSTODY_TRANSFER') THEN
        RAISE EXCEPTION 'Cannot roll back collector top-up cash linkage while transfers exist';
      END IF;
    END $fn$`);
    await q.query(`DROP TRIGGER "TRG_collector_topup_cash_immutable" ON "cash_movements"`);
    await q.query(`DROP FUNCTION guard_collector_topup_cash_immutable()`);
    await q.query(`DROP TRIGGER "TRG_collector_topup_requires_cash" ON "collector_custody_entries"`);
    await q.query(`DROP FUNCTION require_collector_topup_cash()`);
    await q.query(`DROP TRIGGER "TRG_cash_collector_topup_validate" ON "cash_movements"`);
    await q.query(`DROP FUNCTION validate_collector_topup_cash()`);
    await q.query(`ALTER TABLE "cash_movements" DROP CONSTRAINT "CHK_cash_collector_custody_transfer_pair"`);
    await q.query(`DROP INDEX "UQ_cash_collector_custody_entry"`);
    await q.query(`ALTER TABLE "cash_movements" DROP CONSTRAINT "FK_cash_collector_custody_entry"`);
    await q.query(`ALTER TABLE "cash_movements" DROP COLUMN "collector_custody_entry_id"`);
    await q.query(`ALTER TABLE "cash_movements" DROP CONSTRAINT "CHK_cash_movement_concept"`);
    await q.query(`ALTER TABLE "cash_movements" ADD CONSTRAINT "CHK_cash_movement_concept" CHECK ("concept" IN
      ('CAPITAL_CONTRIBUTION','CAPITAL_WITHDRAWAL','EXTERNAL_INCOME','OPERATING_EXPENSE','LOAN_DISBURSEMENT',
       'CUSTOMER_PAYMENT','REFINANCING_NEW_MONEY_DISBURSEMENT','REVERSAL'))`);
  }
}
