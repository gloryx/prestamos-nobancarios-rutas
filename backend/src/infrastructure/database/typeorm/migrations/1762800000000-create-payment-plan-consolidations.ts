import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentPlanConsolidations1762800000000 implements MigrationInterface {
  name = 'CreatePaymentPlanConsolidations1762800000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "payment_plan_consolidations" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "payment_id" uuid NOT NULL,
      "loan_id" uuid NOT NULL,
      "rule_version" smallint NOT NULL DEFAULT 1,
      "effective_payment_date" date NOT NULL,
      "target_plan_entry_id" uuid NOT NULL,
      "target_due_date" date NOT NULL,
      "target_sequence" integer NOT NULL,
      "target_pending_before" numeric(18,2) NOT NULL,
      "target_pending_after" numeric(18,2) NOT NULL,
      "total_moved" numeric(18,2) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_payment_plan_consolidations" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_payment_plan_consolidation_payment" UNIQUE ("payment_id"),
      CONSTRAINT "CHK_payment_plan_consolidation_version" CHECK ("rule_version" = 1),
      CONSTRAINT "CHK_payment_plan_consolidation_target_sequence" CHECK ("target_sequence" >= 1),
      CONSTRAINT "CHK_payment_plan_consolidation_target_amounts" CHECK (
        "target_pending_before" > 0 AND "total_moved" > 0
        AND "target_pending_after" = "target_pending_before" + "total_moved"),
      CONSTRAINT "FK_payment_plan_consolidation_payment" FOREIGN KEY ("payment_id")
        REFERENCES "payments"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_payment_plan_consolidation_loan" FOREIGN KEY ("loan_id")
        REFERENCES "loans"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_payment_plan_consolidation_target" FOREIGN KEY ("target_plan_entry_id")
        REFERENCES "payment_plan_entries"("id") ON DELETE RESTRICT
    )`);

    await q.query(`CREATE TABLE "payment_plan_consolidation_sources" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "consolidation_id" uuid NOT NULL,
      "loan_id" uuid NOT NULL,
      "ordinal" integer NOT NULL,
      "source_plan_entry_id" uuid NOT NULL,
      "source_due_date" date NOT NULL,
      "source_sequence" integer NOT NULL,
      "amount_moved" numeric(18,2) NOT NULL,
      "source_pending_before" numeric(18,2) NOT NULL,
      "source_pending_after" numeric(18,2) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_payment_plan_consolidation_sources" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_plan_consolidation_source_ordinal" UNIQUE ("consolidation_id", "ordinal"),
      CONSTRAINT "UQ_plan_consolidation_source_entry" UNIQUE ("consolidation_id", "source_plan_entry_id"),
      CONSTRAINT "CHK_plan_consolidation_source_ordinal" CHECK ("ordinal" >= 1),
      CONSTRAINT "CHK_plan_consolidation_source_sequence" CHECK ("source_sequence" >= 1),
      CONSTRAINT "CHK_plan_consolidation_source_amounts" CHECK (
        "amount_moved" > 0 AND "source_pending_before" = "amount_moved"
        AND "source_pending_after" = 0),
      CONSTRAINT "FK_plan_consolidation_source_header" FOREIGN KEY ("consolidation_id")
        REFERENCES "payment_plan_consolidations"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_plan_consolidation_source_loan" FOREIGN KEY ("loan_id")
        REFERENCES "loans"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_plan_consolidation_source_entry" FOREIGN KEY ("source_plan_entry_id")
        REFERENCES "payment_plan_entries"("id") ON DELETE RESTRICT
    )`);

    await q.query(`CREATE TABLE "payment_plan_consolidation_reversals" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "consolidation_id" uuid NOT NULL,
      "payment_annulment_id" uuid NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_payment_plan_consolidation_reversals" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_plan_consolidation_reversal_header" UNIQUE ("consolidation_id"),
      CONSTRAINT "UQ_plan_consolidation_reversal_annulment" UNIQUE ("payment_annulment_id"),
      CONSTRAINT "FK_plan_consolidation_reversal_header" FOREIGN KEY ("consolidation_id")
        REFERENCES "payment_plan_consolidations"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_plan_consolidation_reversal_annulment" FOREIGN KEY ("payment_annulment_id")
        REFERENCES "payment_annulments"("id") ON DELETE RESTRICT
    )`);

    await q.query(`CREATE INDEX "IDX_payment_plan_consolidation_loan_created"
      ON "payment_plan_consolidations" ("loan_id", "created_at", "id")`);
    await q.query(`CREATE INDEX "IDX_payment_plan_consolidation_source_entry"
      ON "payment_plan_consolidation_sources" ("source_plan_entry_id")`);

    await q.query(`CREATE FUNCTION validate_payment_plan_consolidation() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE
        payment_loan_id uuid;
        payment_date_value date;
        payment_status character varying;
        target_loan_id uuid;
        target_date_value date;
        target_sequence_value integer;
        target_pending_value numeric(18,2);
      BEGIN
        SELECT loan_id, payment_date, status INTO payment_loan_id, payment_date_value, payment_status
          FROM payments WHERE id = NEW.payment_id FOR SHARE;
        SELECT loan_id, due_date, sequence, pending_amount
          INTO target_loan_id, target_date_value, target_sequence_value, target_pending_value
          FROM payment_plan_entries WHERE id = NEW.target_plan_entry_id FOR SHARE;
        IF payment_loan_id IS DISTINCT FROM NEW.loan_id OR target_loan_id IS DISTINCT FROM NEW.loan_id THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_payment_plan_consolidation_same_loan',
            MESSAGE = 'payment plan consolidation crosses loan boundaries';
        END IF;
        IF payment_status IS DISTINCT FROM 'VALID' OR payment_date_value IS DISTINCT FROM NEW.effective_payment_date THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_payment_plan_consolidation_payment_snapshot',
            MESSAGE = 'payment plan consolidation payment snapshot does not reconcile';
        END IF;
        IF target_date_value IS DISTINCT FROM NEW.target_due_date
          OR target_sequence_value IS DISTINCT FROM NEW.target_sequence
          OR target_pending_value IS DISTINCT FROM NEW.target_pending_before
          OR NEW.target_due_date <= NEW.effective_payment_date THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_payment_plan_consolidation_target_snapshot',
            MESSAGE = 'payment plan consolidation target snapshot does not reconcile';
        END IF;
        RETURN NEW;
      END $fn$`);
    await q.query(`CREATE TRIGGER "TRG_payment_plan_consolidation_validate"
      BEFORE INSERT ON "payment_plan_consolidations"
      FOR EACH ROW EXECUTE FUNCTION validate_payment_plan_consolidation()`);

    await q.query(`CREATE FUNCTION validate_payment_plan_consolidation_source() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE
        header_loan_id uuid;
        target_entry_id uuid;
        payment_date_value date;
        source_loan_id uuid;
        source_date_value date;
        source_sequence_value integer;
        source_pending_value numeric(18,2);
      BEGIN
        SELECT loan_id, target_plan_entry_id, effective_payment_date
          INTO header_loan_id, target_entry_id, payment_date_value
          FROM payment_plan_consolidations WHERE id = NEW.consolidation_id FOR SHARE;
        SELECT loan_id, due_date, sequence, pending_amount
          INTO source_loan_id, source_date_value, source_sequence_value, source_pending_value
          FROM payment_plan_entries WHERE id = NEW.source_plan_entry_id FOR SHARE;
        IF header_loan_id IS DISTINCT FROM NEW.loan_id OR source_loan_id IS DISTINCT FROM NEW.loan_id THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_plan_consolidation_source_same_loan',
            MESSAGE = 'payment plan consolidation source crosses loan boundaries';
        END IF;
        IF NEW.source_plan_entry_id = target_entry_id THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_plan_consolidation_distinct_entries',
            MESSAGE = 'payment plan consolidation source equals target';
        END IF;
        IF source_date_value IS DISTINCT FROM NEW.source_due_date
          OR source_sequence_value IS DISTINCT FROM NEW.source_sequence
          OR source_pending_value IS DISTINCT FROM NEW.source_pending_before
          OR NEW.source_due_date > payment_date_value THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_plan_consolidation_source_snapshot',
            MESSAGE = 'payment plan consolidation source snapshot does not reconcile';
        END IF;
        RETURN NEW;
      END $fn$`);
    await q.query(`CREATE TRIGGER "TRG_payment_plan_consolidation_source_validate"
      BEFORE INSERT ON "payment_plan_consolidation_sources"
      FOR EACH ROW EXECUTE FUNCTION validate_payment_plan_consolidation_source()`);

    await q.query(`CREATE FUNCTION validate_payment_plan_consolidation_total() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE consolidation_key uuid; expected numeric(18,2); actual numeric(18,2); source_count integer;
      BEGIN
        IF TG_TABLE_NAME = 'payment_plan_consolidations' THEN
          consolidation_key := (to_jsonb(NEW) ->> 'id')::uuid;
        ELSIF TG_TABLE_NAME = 'payment_plan_consolidation_sources' THEN
          consolidation_key := (to_jsonb(NEW) ->> 'consolidation_id')::uuid;
        ELSE
          RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'unsupported consolidation total trigger source';
        END IF;
        SELECT total_moved INTO expected FROM payment_plan_consolidations WHERE id = consolidation_key;
        SELECT COALESCE(SUM(amount_moved), 0), COUNT(*)::integer INTO actual, source_count
          FROM payment_plan_consolidation_sources WHERE consolidation_id = consolidation_key;
        IF expected IS NULL OR source_count = 0 OR actual <> expected THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_payment_plan_consolidation_source_total',
            MESSAGE = 'payment plan consolidation sources do not reconcile';
        END IF;
        RETURN NULL;
      END $fn$`);
    await q.query(`CREATE CONSTRAINT TRIGGER "TRG_payment_plan_consolidation_total_from_header"
      AFTER INSERT ON "payment_plan_consolidations" DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_payment_plan_consolidation_total()`);
    await q.query(`CREATE CONSTRAINT TRIGGER "TRG_payment_plan_consolidation_total_from_source"
      AFTER INSERT ON "payment_plan_consolidation_sources" DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_payment_plan_consolidation_total()`);

    await q.query(`CREATE FUNCTION validate_payment_plan_consolidation_reversal() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE consolidation_payment_id uuid; annulment_payment_id uuid;
      BEGIN
        SELECT payment_id INTO consolidation_payment_id FROM payment_plan_consolidations
          WHERE id = NEW.consolidation_id FOR SHARE;
        SELECT payment_id INTO annulment_payment_id FROM payment_annulments
          WHERE id = NEW.payment_annulment_id FOR SHARE;
        IF consolidation_payment_id IS NULL OR annulment_payment_id IS NULL
          OR consolidation_payment_id <> annulment_payment_id THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_plan_consolidation_reversal_payment',
            MESSAGE = 'payment plan consolidation reversal does not match its payment annulment';
        END IF;
        RETURN NEW;
      END $fn$`);
    await q.query(`CREATE TRIGGER "TRG_payment_plan_consolidation_reversal_validate"
      BEFORE INSERT ON "payment_plan_consolidation_reversals"
      FOR EACH ROW EXECUTE FUNCTION validate_payment_plan_consolidation_reversal()`);

    await q.query(`CREATE FUNCTION guard_payment_plan_consolidation_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = TG_TABLE_NAME || ' rows are immutable';
      END $fn$`);
    for (const table of ['payment_plan_consolidations', 'payment_plan_consolidation_sources',
      'payment_plan_consolidation_reversals']) {
      await q.query(`CREATE TRIGGER "TRG_${table}_immutable" BEFORE UPDATE OR DELETE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION guard_payment_plan_consolidation_immutable()`);
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $fn$ BEGIN
      IF EXISTS (SELECT 1 FROM payment_plan_consolidations)
        OR EXISTS (SELECT 1 FROM payment_plan_consolidation_sources)
        OR EXISTS (SELECT 1 FROM payment_plan_consolidation_reversals) THEN
        RAISE EXCEPTION 'Cannot roll back payment plan consolidation schema while records exist';
      END IF;
    END $fn$`);

    for (const table of ['payment_plan_consolidation_reversals', 'payment_plan_consolidation_sources',
      'payment_plan_consolidations']) {
      await q.query(`DROP TRIGGER "TRG_${table}_immutable" ON "${table}"`);
    }
    await q.query(`DROP FUNCTION guard_payment_plan_consolidation_immutable()`);
    await q.query(`DROP TRIGGER "TRG_payment_plan_consolidation_reversal_validate" ON "payment_plan_consolidation_reversals"`);
    await q.query(`DROP FUNCTION validate_payment_plan_consolidation_reversal()`);
    await q.query(`DROP TRIGGER "TRG_payment_plan_consolidation_total_from_source" ON "payment_plan_consolidation_sources"`);
    await q.query(`DROP TRIGGER "TRG_payment_plan_consolidation_total_from_header" ON "payment_plan_consolidations"`);
    await q.query(`DROP FUNCTION validate_payment_plan_consolidation_total()`);
    await q.query(`DROP TRIGGER "TRG_payment_plan_consolidation_source_validate" ON "payment_plan_consolidation_sources"`);
    await q.query(`DROP FUNCTION validate_payment_plan_consolidation_source()`);
    await q.query(`DROP TRIGGER "TRG_payment_plan_consolidation_validate" ON "payment_plan_consolidations"`);
    await q.query(`DROP FUNCTION validate_payment_plan_consolidation()`);
    await q.query(`DROP TABLE "payment_plan_consolidation_reversals"`);
    await q.query(`DROP TABLE "payment_plan_consolidation_sources"`);
    await q.query(`DROP TABLE "payment_plan_consolidations"`);
  }
}
