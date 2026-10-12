import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLoanRefinancingAnnulments1762300000000 implements MigrationInterface {
  name = 'CreateLoanRefinancingAnnulments1762300000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`DO $fn$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UQ_refinancing_successor') THEN
        RAISE EXCEPTION 'Expected UQ_refinancing_successor before adding refinancing annulments';
      END IF;
    END $fn$`);
    await q.query(`ALTER TABLE "loan_refinancings"
      ADD "status" character varying(16) NOT NULL DEFAULT 'CONFIRMED',
      ADD CONSTRAINT "CHK_loan_refinancing_status" CHECK ("status" IN ('CONFIRMED','ANNULLED'))`);
    await q.query(`ALTER TABLE "loan_refinancings" DROP CONSTRAINT "UQ_refinancing_origin"`);
    await q.query(`CREATE UNIQUE INDEX "UQ_refinancing_confirmed_origin" ON "loan_refinancings" ("origin_loan_id")
      WHERE "status" = 'CONFIRMED'`);

    await q.query(`CREATE TABLE "loan_refinancing_annulments" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "refinancing_id" uuid NOT NULL,
      "annulment_type" character varying(24) NOT NULL,
      "effective_date" date NOT NULL,
      "reason" character varying(500) NOT NULL,
      "annulled_at" timestamptz NOT NULL DEFAULT now(),
      "created_by_user_id" uuid NOT NULL,
      "refund_payment_method_id" uuid,
      "idempotency_key" character varying(128) NOT NULL,
      "idempotency_fingerprint" text NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_loan_refinancing_annulments" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_refinancing_annulment_refinancing" UNIQUE ("refinancing_id"),
      CONSTRAINT "UQ_refinancing_annulment_key" UNIQUE ("idempotency_key"),
      CONSTRAINT "CHK_refinancing_annulment_type" CHECK ("annulment_type" IN ('DATA_CORRECTION','CASH_REFUND')),
      CONSTRAINT "CHK_refinancing_annulment_reason" CHECK (char_length(btrim("reason")) BETWEEN 1 AND 500),
      CONSTRAINT "FK_refinancing_annulment_refinancing" FOREIGN KEY ("refinancing_id") REFERENCES "loan_refinancings"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_refinancing_annulment_actor" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_refinancing_annulment_refund_method" FOREIGN KEY ("refund_payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT
    )`);

    await q.query(`CREATE FUNCTION validate_loan_refinancing_annulment() RETURNS trigger AS $fn$
      DECLARE edge_status varchar(16); edge_date date; edge_new_money numeric(18,2);
      BEGIN
        SELECT status, refinancing_date, new_money_disbursed
          INTO edge_status, edge_date, edge_new_money
          FROM loan_refinancings WHERE id = NEW.refinancing_id FOR UPDATE;
        IF edge_status IS DISTINCT FROM 'CONFIRMED' THEN
          RAISE EXCEPTION 'Only a confirmed refinancing can be annulled';
        END IF;
        IF NEW.annulment_type = 'DATA_CORRECTION'
          AND (NEW.effective_date <> edge_date OR NEW.refund_payment_method_id IS NOT NULL) THEN
          RAISE EXCEPTION 'Data correction must use the original date and no refund method';
        END IF;
        IF NEW.annulment_type = 'CASH_REFUND'
          AND (NEW.effective_date < edge_date
            OR (edge_new_money > 0) <> (NEW.refund_payment_method_id IS NOT NULL)) THEN
          RAISE EXCEPTION 'Cash refund date or receiving method is inconsistent';
        END IF;
        RETURN NEW;
      END; $fn$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER trg_refinancing_annulment_validate BEFORE INSERT ON "loan_refinancing_annulments"
      FOR EACH ROW EXECUTE FUNCTION validate_loan_refinancing_annulment()`);

    await q.query(`CREATE FUNCTION prevent_loan_refinancing_annulment_mutation() RETURNS trigger AS $fn$
      BEGIN RAISE EXCEPTION 'Refinancing annulment facts are immutable'; END; $fn$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER trg_refinancing_annulment_immutable BEFORE UPDATE OR DELETE ON "loan_refinancing_annulments"
      FOR EACH ROW EXECUTE FUNCTION prevent_loan_refinancing_annulment_mutation()`);

    await q.query(`CREATE OR REPLACE FUNCTION check_loan_refinancing_chain() RETURNS trigger AS $fn$
      DECLARE origin_customer uuid; successor_customer uuid;
      BEGIN
        SELECT customer_id INTO origin_customer FROM loans WHERE id = NEW.origin_loan_id;
        SELECT customer_id INTO successor_customer FROM loans WHERE id = NEW.new_loan_id;
        IF origin_customer IS NULL OR successor_customer IS NULL OR origin_customer <> successor_customer THEN
          RAISE EXCEPTION 'Refinancing loans must belong to the same customer';
        END IF;
        IF NEW.status = 'CONFIRMED' AND EXISTS (
          WITH RECURSIVE descendants(id) AS (
            SELECT NEW.new_loan_id
            UNION
            SELECT r.new_loan_id FROM loan_refinancings r JOIN descendants d ON r.origin_loan_id = d.id
            WHERE r.id <> NEW.id AND r.status = 'CONFIRMED'
          ) SELECT 1 FROM descendants WHERE id = NEW.origin_loan_id
        ) THEN RAISE EXCEPTION 'Refinancing cycle is not allowed'; END IF;
        RETURN NEW;
      END; $fn$ LANGUAGE plpgsql`);
    await q.query(`CREATE OR REPLACE FUNCTION prevent_loan_refinancing_mutation() RETURNS trigger AS $fn$
      BEGIN
        IF TG_OP = 'UPDATE'
          AND OLD.status = 'CONFIRMED' AND NEW.status = 'ANNULLED'
          AND to_jsonb(NEW) - 'status' = to_jsonb(OLD) - 'status'
          AND EXISTS (SELECT 1 FROM loan_refinancing_annulments a WHERE a.refinancing_id = OLD.id)
        THEN RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Confirmed refinancing facts are immutable';
      END; $fn$ LANGUAGE plpgsql`);

    await q.query(`ALTER TABLE "cash_movements" ADD "refinancing_annulment_id" uuid`);
    await q.query(`ALTER TABLE "cash_movements" ADD CONSTRAINT "FK_cash_refinancing_annulment"
      FOREIGN KEY ("refinancing_annulment_id") REFERENCES "loan_refinancing_annulments"("id") ON DELETE RESTRICT`);
    await q.query(`CREATE UNIQUE INDEX "UQ_cash_refinancing_annulment" ON "cash_movements" ("refinancing_annulment_id")
      WHERE "refinancing_annulment_id" IS NOT NULL`);

    await q.query(`ALTER TABLE "loan_status_history"
      ADD "refinancing_id" uuid,
      ADD "refinancing_annulment_id" uuid,
      ADD "refinancing_role" character varying(16),
      ADD CONSTRAINT "CHK_loan_status_history_refinancing_role" CHECK ("refinancing_role" IS NULL OR "refinancing_role" IN ('ORIGIN','SUCCESSOR')),
      ADD CONSTRAINT "CHK_loan_status_history_refinancing_shape" CHECK (
        ("refinancing_id" IS NULL AND "refinancing_annulment_id" IS NULL AND "refinancing_role" IS NULL)
        OR ("refinancing_id" IS NOT NULL AND "refinancing_role" IS NOT NULL)),
      ADD CONSTRAINT "FK_loan_status_history_refinancing" FOREIGN KEY ("refinancing_id") REFERENCES "loan_refinancings"("id") ON DELETE RESTRICT,
      ADD CONSTRAINT "FK_loan_status_history_refinancing_annulment" FOREIGN KEY ("refinancing_annulment_id") REFERENCES "loan_refinancing_annulments"("id") ON DELETE RESTRICT`);
    await q.query(`CREATE UNIQUE INDEX "UQ_loan_status_history_refinancing_role" ON "loan_status_history" ("refinancing_id", "refinancing_role")
      WHERE "refinancing_id" IS NOT NULL AND "refinancing_annulment_id" IS NULL`);
    await q.query(`CREATE UNIQUE INDEX "UQ_loan_status_history_refinancing_annulment_role" ON "loan_status_history" ("refinancing_annulment_id", "refinancing_role")
      WHERE "refinancing_annulment_id" IS NOT NULL`);

    await q.query(`INSERT INTO permissions (code, name, module, description) VALUES
      ('loans.refinance.annul','Anular refinanciamientos','PRÉSTAMOS',NULL)
      ON CONFLICT (code) DO NOTHING`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $fn$ BEGIN
      IF EXISTS (SELECT 1 FROM loan_refinancing_annulments)
        OR EXISTS (SELECT 1 FROM cash_movements WHERE refinancing_annulment_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM loan_status_history WHERE refinancing_id IS NOT NULL OR refinancing_annulment_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM loan_refinancings WHERE status = 'ANNULLED')
        OR EXISTS (SELECT 1 FROM loan_refinancings GROUP BY origin_loan_id HAVING count(*) > 1)
        OR EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.code = 'loans.refinance.annul')
      THEN RAISE EXCEPTION 'Cannot roll back refinancing annulment schema while dependent data or grants exist';
      END IF;
    END $fn$`);
    await q.query(`DELETE FROM permissions WHERE code = 'loans.refinance.annul'`);

    await q.query(`DROP INDEX "UQ_loan_status_history_refinancing_annulment_role"`);
    await q.query(`DROP INDEX "UQ_loan_status_history_refinancing_role"`);
    await q.query(`ALTER TABLE "loan_status_history"
      DROP CONSTRAINT "FK_loan_status_history_refinancing_annulment",
      DROP CONSTRAINT "FK_loan_status_history_refinancing",
      DROP CONSTRAINT "CHK_loan_status_history_refinancing_shape",
      DROP CONSTRAINT "CHK_loan_status_history_refinancing_role",
      DROP COLUMN "refinancing_role",
      DROP COLUMN "refinancing_annulment_id",
      DROP COLUMN "refinancing_id"`);

    await q.query(`DROP INDEX "UQ_cash_refinancing_annulment"`);
    await q.query(`ALTER TABLE "cash_movements" DROP CONSTRAINT "FK_cash_refinancing_annulment"`);
    await q.query(`ALTER TABLE "cash_movements" DROP COLUMN "refinancing_annulment_id"`);

    await q.query(`CREATE OR REPLACE FUNCTION check_loan_refinancing_chain() RETURNS trigger AS $fn$
      DECLARE origin_customer uuid; successor_customer uuid;
      BEGIN
        SELECT customer_id INTO origin_customer FROM loans WHERE id = NEW.origin_loan_id;
        SELECT customer_id INTO successor_customer FROM loans WHERE id = NEW.new_loan_id;
        IF origin_customer IS NULL OR successor_customer IS NULL OR origin_customer <> successor_customer THEN
          RAISE EXCEPTION 'Refinancing loans must belong to the same customer';
        END IF;
        IF EXISTS (
          WITH RECURSIVE descendants(id) AS (
            SELECT NEW.new_loan_id
            UNION
            SELECT r.new_loan_id FROM loan_refinancings r JOIN descendants d ON r.origin_loan_id = d.id
            WHERE r.id <> NEW.id
          ) SELECT 1 FROM descendants WHERE id = NEW.origin_loan_id
        ) THEN RAISE EXCEPTION 'Refinancing cycle is not allowed'; END IF;
        RETURN NEW;
      END; $fn$ LANGUAGE plpgsql`);
    await q.query(`CREATE OR REPLACE FUNCTION prevent_loan_refinancing_mutation() RETURNS trigger AS $fn$
      BEGIN RAISE EXCEPTION 'Confirmed refinancing facts are immutable'; END; $fn$ LANGUAGE plpgsql`);
    await q.query(`DROP TRIGGER "trg_refinancing_annulment_immutable" ON "loan_refinancing_annulments"`);
    await q.query(`DROP FUNCTION prevent_loan_refinancing_annulment_mutation()`);
    await q.query(`DROP TRIGGER "trg_refinancing_annulment_validate" ON "loan_refinancing_annulments"`);
    await q.query(`DROP FUNCTION validate_loan_refinancing_annulment()`);
    await q.query(`DROP TABLE "loan_refinancing_annulments"`);

    await q.query(`DROP INDEX "UQ_refinancing_confirmed_origin"`);
    await q.query(`ALTER TABLE "loan_refinancings"
      DROP CONSTRAINT "CHK_loan_refinancing_status",
      DROP COLUMN "status",
      ADD CONSTRAINT "UQ_refinancing_origin" UNIQUE ("origin_loan_id")`);
  }
}
