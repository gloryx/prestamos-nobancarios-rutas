import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinancialClosesV21762100000000 implements MigrationInterface {
  name = 'CreateFinancialClosesV21762100000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "financial_closes" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "period" varchar(7) NOT NULL, "sequence" integer NOT NULL,
      "model_version" integer NOT NULL, "from_date" date NOT NULL, "to_date" date NOT NULL,
      "integrity_status" varchar(20) NOT NULL, "blocking_issues" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb, "confirmed_by_user_id" uuid NOT NULL,
      "confirmed_at" timestamptz, CONSTRAINT "PK_financial_closes" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_financial_closes_period" UNIQUE ("period"), CONSTRAINT "UQ_financial_closes_sequence" UNIQUE ("sequence"),
      CONSTRAINT "CK_financial_closes_period" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
      CONSTRAINT "CK_financial_closes_sequence" CHECK ("sequence" > 0),
      CONSTRAINT "CK_financial_closes_model_version" CHECK ("model_version" > 0),
      CONSTRAINT "CK_financial_closes_dates" CHECK ("from_date" <= "to_date"),
      CONSTRAINT "CK_financial_closes_integrity" CHECK ("integrity_status" = 'COMPLETE'),
      CONSTRAINT "FK_financial_closes_user" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT)`);
    await q.query(`CREATE TABLE "financial_close_concepts" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "financial_close_id" uuid NOT NULL, "section" varchar(40) NOT NULL,
      "code" varchar(80) NOT NULL, "label" varchar(160) NOT NULL, "classification" varchar(40) NOT NULL,
      "amount" numeric(38,2) NOT NULL, "ordinal" integer NOT NULL,
      CONSTRAINT "PK_financial_close_concepts" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_financial_close_concepts_code" UNIQUE ("financial_close_id", "code"),
      CONSTRAINT "UQ_financial_close_concepts_ordinal" UNIQUE ("financial_close_id", "ordinal"),
      CONSTRAINT "CK_financial_close_concepts_ordinal" CHECK ("ordinal" > 0),
      CONSTRAINT "CK_financial_close_concepts_section" CHECK ("section" IN ('LIQUIDITY','CONTRACTUAL_PORTFOLIO','ECONOMIC_CAPITAL','REFINANCINGS','PROFITABILITY','RECONCILIATIONS')),
      CONSTRAINT "CK_financial_close_concepts_classification" CHECK ("classification" IN ('OPERATING','FINANCING','EXTERNAL_NON_OPERATING','BALANCE','CONTROL','RESULT')),
      CONSTRAINT "FK_financial_close_concepts_header" FOREIGN KEY ("financial_close_id") REFERENCES "financial_closes"("id") ON DELETE RESTRICT)`);
    await q.query(`CREATE OR REPLACE FUNCTION guard_financial_close_header_mutation() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'UPDATE' AND OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL
          AND (to_jsonb(NEW) - 'confirmed_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'confirmed_at') THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'financial close snapshots are immutable after sealing' USING ERRCODE = '55000';
      END; $$ LANGUAGE plpgsql`);
    await q.query(`CREATE OR REPLACE FUNCTION guard_financial_close_concept_mutation() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          PERFORM 1 FROM financial_closes WHERE id = NEW.financial_close_id AND confirmed_at IS NULL FOR SHARE;
          IF FOUND THEN RETURN NEW; END IF;
          RAISE EXCEPTION 'financial close concepts can only be inserted before sealing' USING ERRCODE = '55000';
        END IF;
        RAISE EXCEPTION 'financial close concepts are immutable' USING ERRCODE = '55000';
      END; $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER "TR_financial_closes_immutable" BEFORE UPDATE OR DELETE ON "financial_closes"
      FOR EACH ROW EXECUTE FUNCTION guard_financial_close_header_mutation()`);
    await q.query(`CREATE TRIGGER "TR_financial_close_concepts_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "financial_close_concepts"
      FOR EACH ROW EXECUTE FUNCTION guard_financial_close_concept_mutation()`);
    await q.query(`INSERT INTO permissions (code, name, module, description) VALUES
      ('financial-closes.view', 'Consultar cierres financieros', 'FINANZAS', NULL),
      ('financial-closes.confirm', 'Confirmar cierres financieros', 'FINANZAS', NULL)
      ON CONFLICT (code) DO NOTHING`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM permissions WHERE code IN ('financial-closes.view','financial-closes.confirm')`);
    await q.query(`DROP TRIGGER "TR_financial_close_concepts_immutable" ON "financial_close_concepts"`);
    await q.query(`DROP TRIGGER "TR_financial_closes_immutable" ON "financial_closes"`);
    await q.query(`DROP FUNCTION guard_financial_close_concept_mutation()`);
    await q.query(`DROP FUNCTION guard_financial_close_header_mutation()`);
    await q.query(`DROP TABLE "financial_close_concepts"`);
    await q.query(`DROP TABLE "financial_closes"`);
  }
}
