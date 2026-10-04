import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLoanRefinancings1761900000000 implements MigrationInterface {
  name = 'CreateLoanRefinancings1761900000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "loan_refinancings" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "origin_loan_id" uuid NOT NULL, "new_loan_id" uuid NOT NULL,
      "outstanding_principal_transferred" numeric(18,2) NOT NULL,
      "capitalized_outstanding_interest" numeric(18,2) NOT NULL,
      "new_money_disbursed" numeric(18,2) NOT NULL,
      "new_interest_amount" numeric(18,2) NOT NULL,
      "new_contractual_principal" numeric(18,2) NOT NULL,
      "new_contractual_total" numeric(18,2) NOT NULL,
      "refinancing_date" date NOT NULL, "created_by_user_id" uuid NOT NULL,
      "idempotency_key" varchar(128) NOT NULL, "idempotency_fingerprint" text NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_loan_refinancings" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_refinancing_origin" UNIQUE ("origin_loan_id"),
      CONSTRAINT "UQ_refinancing_successor" UNIQUE ("new_loan_id"),
      CONSTRAINT "UQ_refinancing_key" UNIQUE ("idempotency_key"),
      CONSTRAINT "CHK_refinancing_distinct" CHECK ("origin_loan_id" <> "new_loan_id"),
      CONSTRAINT "CHK_refinancing_amounts" CHECK (
        "outstanding_principal_transferred" >= 0 AND "capitalized_outstanding_interest" >= 0
        AND "new_money_disbursed" >= 0 AND "new_interest_amount" >= 0
        AND "new_contractual_principal" > 0
        AND "new_contractual_principal" = "outstanding_principal_transferred" + "capitalized_outstanding_interest" + "new_money_disbursed"
        AND "new_contractual_total" = "new_contractual_principal" + "new_interest_amount"),
      CONSTRAINT "FK_refinancing_origin" FOREIGN KEY ("origin_loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_refinancing_successor" FOREIGN KEY ("new_loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_refinancing_actor" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
    )`);
    await q.query(`CREATE FUNCTION check_loan_refinancing_chain() RETURNS trigger AS $fn$
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
    await q.query(`CREATE TRIGGER trg_refinancing_chain BEFORE INSERT OR UPDATE ON loan_refinancings
      FOR EACH ROW EXECUTE FUNCTION check_loan_refinancing_chain()`);
    await q.query(`CREATE FUNCTION prevent_loan_refinancing_mutation() RETURNS trigger AS $fn$
      BEGIN RAISE EXCEPTION 'Confirmed refinancing facts are immutable'; END; $fn$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER trg_refinancing_immutable BEFORE UPDATE OR DELETE ON loan_refinancings
      FOR EACH ROW EXECUTE FUNCTION prevent_loan_refinancing_mutation()`);

    await q.query(`ALTER TABLE cash_movements DROP CONSTRAINT "CHK_cash_loan_disbursement_pair"`);
    await q.query(`ALTER TABLE cash_movements ADD CONSTRAINT "CHK_cash_loan_disbursement_pair" CHECK (
      (concept IN ('LOAN_DISBURSEMENT','REFINANCING_NEW_MONEY_DISBURSEMENT')
        AND loan_disbursement_id IS NOT NULL AND direction = 'OUTFLOW' AND payment_id IS NULL)
      OR (concept NOT IN ('LOAN_DISBURSEMENT','REFINANCING_NEW_MONEY_DISBURSEMENT') AND loan_disbursement_id IS NULL))`);
    await q.query(`CREATE OR REPLACE FUNCTION check_loan_disbursement_cash_pair() RETURNS trigger AS $fn$
      DECLARE d_amount numeric(18,2); d_method uuid; d_date date; d_loan uuid;
      BEGIN
        IF NEW.loan_disbursement_id IS NOT NULL THEN
          SELECT amount, payment_method_id, disbursement_date, loan_id INTO d_amount, d_method, d_date, d_loan
          FROM loan_disbursements WHERE id = NEW.loan_disbursement_id;
          IF d_amount IS NULL OR NEW.amount <> d_amount OR NEW.payment_method_id <> d_method OR NEW.movement_date <> d_date THEN
            RAISE EXCEPTION 'Loan disbursement cash movement does not match its disbursement';
          END IF;
          IF NEW.concept = 'REFINANCING_NEW_MONEY_DISBURSEMENT' AND NOT EXISTS (
            SELECT 1 FROM loan_refinancings r WHERE r.new_loan_id = d_loan AND r.new_money_disbursed = d_amount
          ) THEN RAISE EXCEPTION 'Refinancing new-money cash movement has no matching refinancing'; END IF;
          IF NEW.concept = 'LOAN_DISBURSEMENT' AND EXISTS (
            SELECT 1 FROM loan_refinancings r WHERE r.new_loan_id = d_loan
          ) THEN RAISE EXCEPTION 'Refinancing disbursement must use the new-money concept'; END IF;
        END IF;
        RETURN NEW;
      END; $fn$ LANGUAGE plpgsql`);
    await q.query(`INSERT INTO permissions (code, name, module, description) VALUES
      ('loans.refinance.view','Consultar refinanciamientos','PRÉSTAMOS',NULL),
      ('loans.refinance.create','Confirmar refinanciamientos','PRÉSTAMOS',NULL)
      ON CONFLICT (code) DO NOTHING`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $fn$ BEGIN
      IF EXISTS (SELECT 1 FROM loan_refinancings) OR EXISTS (
        SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code IN ('loans.refinance.view','loans.refinance.create')) THEN
        RAISE EXCEPTION 'Cannot roll back refinancing schema with operations or granted permissions';
      END IF;
    END $fn$`);
    await q.query(`ALTER TABLE cash_movements DROP CONSTRAINT "CHK_cash_loan_disbursement_pair"`);
    await q.query(`ALTER TABLE cash_movements ADD CONSTRAINT "CHK_cash_loan_disbursement_pair" CHECK (
      (concept = 'LOAN_DISBURSEMENT' AND loan_disbursement_id IS NOT NULL AND direction = 'OUTFLOW')
      OR (concept <> 'LOAN_DISBURSEMENT' AND loan_disbursement_id IS NULL))`);
    await q.query(`CREATE OR REPLACE FUNCTION check_loan_disbursement_cash_pair() RETURNS trigger AS $fn$
      DECLARE d_amount numeric(18,2); d_method uuid; d_date date;
      BEGIN
        IF NEW.loan_disbursement_id IS NOT NULL THEN
          SELECT amount, payment_method_id, disbursement_date INTO d_amount, d_method, d_date
          FROM loan_disbursements WHERE id = NEW.loan_disbursement_id;
          IF d_amount IS NULL OR NEW.amount <> d_amount OR NEW.payment_method_id <> d_method OR NEW.movement_date <> d_date THEN
            RAISE EXCEPTION 'Loan disbursement cash movement does not match its disbursement';
          END IF;
        END IF;
        RETURN NEW;
      END; $fn$ LANGUAGE plpgsql`);
    await q.query(`DROP TRIGGER trg_refinancing_chain ON loan_refinancings`);
    await q.query(`DROP TRIGGER trg_refinancing_immutable ON loan_refinancings`);
    await q.query(`DROP FUNCTION check_loan_refinancing_chain()`);
    await q.query(`DROP FUNCTION prevent_loan_refinancing_mutation()`);
    await q.query(`DROP TABLE loan_refinancings`);
    await q.query(`DELETE FROM permissions WHERE code IN ('loans.refinance.view','loans.refinance.create')`);
  }
}
