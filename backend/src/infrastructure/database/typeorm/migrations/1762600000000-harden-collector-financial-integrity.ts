import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenCollectorFinancialIntegrity1762600000000 implements MigrationInterface {
  name = 'HardenCollectorFinancialIntegrity1762600000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "collector_user_assignments" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "collector_id" uuid NOT NULL, "user_id" uuid NOT NULL,
      "assigned_at" timestamptz NOT NULL DEFAULT now(), "assigned_by_user_id" uuid,
      "ended_at" timestamptz, "ended_by_user_id" uuid,
      CONSTRAINT "PK_collector_user_assignments" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_collector_user_assignments_period" CHECK (("ended_at" IS NULL AND "ended_by_user_id" IS NULL)
        OR ("ended_at" IS NOT NULL AND "ended_by_user_id" IS NOT NULL AND "ended_at" >= "assigned_at")),
      CONSTRAINT "FK_collector_user_assignments_collector" FOREIGN KEY ("collector_id") REFERENCES "collectors"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_user_assignments_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_user_assignments_assigner" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_user_assignments_ender" FOREIGN KEY ("ended_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
    )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_user_assignments_active_collector"
      ON "collector_user_assignments" ("collector_id") WHERE "ended_at" IS NULL`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_user_assignments_active_user"
      ON "collector_user_assignments" ("user_id") WHERE "ended_at" IS NULL`);
    await q.query(`CREATE INDEX "IDX_collector_user_assignments_history"
      ON "collector_user_assignments" ("collector_id","assigned_at","id")`);
    await q.query(`INSERT INTO "collector_user_assignments" ("collector_id","user_id","assigned_at")
      SELECT "id","user_id","created_at" FROM "collectors" WHERE "user_id" IS NOT NULL`);
    await q.query(`ALTER TABLE "collector_custody_entries" ADD CONSTRAINT "CHK_collector_custody_entries_active_type"
      CHECK ("entry_type" IN ('CUSTOMER_COLLECTION','REMITTANCE_TO_COMPANY','COMPANY_TOP_UP','AUTHORIZED_ADJUSTMENT','REVERSAL')) NOT VALID`);
    await q.query(`ALTER TABLE "collector_custody_entries" ADD CONSTRAINT "CHK_collector_custody_entries_shape_v2" CHECK (
      ("entry_type" = 'CUSTOMER_COLLECTION' AND "direction" = 'CREDIT' AND "payment_method_id" IS NOT NULL
        AND "precollection_id" IS NOT NULL AND "settlement_id" IS NULL AND "reversed_entry_id" IS NULL AND "reason" IS NULL)
      OR ("entry_type" = 'REMITTANCE_TO_COMPANY' AND "direction" = 'DEBIT' AND "payment_method_id" IS NOT NULL
        AND "precollection_id" IS NULL AND "reversed_entry_id" IS NULL
        AND (("settlement_id" IS NULL AND btrim(coalesce("reference",'')) <> '' AND btrim(coalesce("reason",'')) <> '')
          OR ("settlement_id" IS NOT NULL AND "reason" IS NULL)))
      OR ("entry_type" = 'COMPANY_TOP_UP' AND "direction" = 'CREDIT' AND "payment_method_id" IS NOT NULL
        AND "precollection_id" IS NULL AND "settlement_id" IS NULL AND "reversed_entry_id" IS NULL
        AND btrim(coalesce("reference",'')) <> '' AND btrim(coalesce("reason",'')) <> '')
      OR ("entry_type" = 'AUTHORIZED_ADJUSTMENT' AND "direction" IN ('CREDIT','DEBIT') AND "payment_method_id" IS NOT NULL
        AND "precollection_id" IS NULL AND "settlement_id" IS NULL AND "reversed_entry_id" IS NULL
        AND btrim(coalesce("reference",'')) <> '' AND btrim(coalesce("reason",'')) <> '')
      OR ("entry_type" = 'REVERSAL' AND "direction" = 'DEBIT' AND "payment_method_id" IS NOT NULL
        AND "precollection_id" IS NOT NULL AND "settlement_id" IS NULL AND "reversed_entry_id" IS NOT NULL
        AND "reference" IS NULL AND btrim(coalesce("reason",'')) <> '')
    ) NOT VALID`);
    await q.query(`CREATE FUNCTION validate_collector_custody_insert_v2() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.entry_type = 'CUSTOMER_COLLECTION' AND NOT EXISTS (
          SELECT 1 FROM collector_precollections cp WHERE cp.id = NEW.precollection_id
            AND cp.collector_id = NEW.collector_id AND cp.custody_treatment = 'COLLECTOR_HELD'
            AND cp.amount = NEW.amount AND cp.effective_date = NEW.effective_date
            AND cp.payment_method_id = NEW.payment_method_id
        ) THEN RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_collector_custody_customer_source_v2',
          MESSAGE = 'customer collection custody source does not reconcile';
        END IF;
        IF NEW.entry_type = 'REVERSAL' AND NOT EXISTS (
          SELECT 1 FROM collector_custody_entries original
          WHERE original.id = NEW.reversed_entry_id AND original.entry_type = 'CUSTOMER_COLLECTION'
            AND original.direction = 'CREDIT' AND original.collector_id = NEW.collector_id
            AND original.precollection_id = NEW.precollection_id AND original.amount = NEW.amount
            AND original.payment_method_id = NEW.payment_method_id
        ) THEN RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_collector_custody_reversal_source_v2',
          MESSAGE = 'custody reversal source does not reconcile';
        END IF;
        IF NEW.entry_type = 'REMITTANCE_TO_COMPANY' AND NEW.settlement_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM collector_settlements settlement
          WHERE settlement.id = NEW.settlement_id AND settlement.collector_id = NEW.collector_id
        ) THEN RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_collector_custody_settlement_source_v2',
          MESSAGE = 'settlement remittance source does not reconcile';
        END IF;
        RETURN NEW;
      END $fn$`);
    await q.query(`CREATE TRIGGER "TRG_collector_custody_validate_insert_v2" BEFORE INSERT ON "collector_custody_entries"
      FOR EACH ROW EXECUTE FUNCTION validate_collector_custody_insert_v2()`);
    await q.query(`CREATE INDEX "IDX_collector_settlement_items_payment" ON "collector_settlement_items" ("payment_id")
      WHERE "payment_id" IS NOT NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "IDX_collector_settlement_items_payment"`);
    await q.query(`DROP TRIGGER "TRG_collector_custody_validate_insert_v2" ON "collector_custody_entries"`);
    await q.query(`DROP FUNCTION validate_collector_custody_insert_v2()`);
    await q.query(`ALTER TABLE "collector_custody_entries" DROP CONSTRAINT "CHK_collector_custody_entries_shape_v2"`);
    await q.query(`ALTER TABLE "collector_custody_entries" DROP CONSTRAINT "CHK_collector_custody_entries_active_type"`);
    await q.query(`DROP TABLE "collector_user_assignments"`);
  }
}
