import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCollectorSettlementsCustody1762500000000 implements MigrationInterface {
  name = 'CreateCollectorSettlementsCustody1762500000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "collector_precollections" ADD "custody_treatment" character varying(24)`);
    // Compatibility assumption only: rows captured before Stage 3A are treated as collector-held.
    await q.query(`UPDATE "collector_precollections" SET "custody_treatment" = 'COLLECTOR_HELD' WHERE "custody_treatment" IS NULL`);
    await q.query(`ALTER TABLE "collector_precollections" ALTER COLUMN "custody_treatment" SET NOT NULL`);
    await q.query(`ALTER TABLE "collector_precollections" ADD CONSTRAINT "CHK_collector_precollections_custody_treatment"
      CHECK ("custody_treatment" IN ('COLLECTOR_HELD','COMPANY_RECEIVED'))`);

    await q.query(`CREATE TABLE "collector_settlements" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "collector_id" uuid NOT NULL, "collector_user_id" uuid NOT NULL,
      "status" character varying(20) NOT NULL DEFAULT 'DRAFT', "total_declared" numeric(18,2) NOT NULL,
      "total_confirmed" numeric(18,2) NOT NULL DEFAULT 0, "amount_delivered" numeric(18,2) NOT NULL DEFAULT 0,
      "retained_amount" numeric(18,2) NOT NULL DEFAULT 0, "difference_amount" numeric(18,2) NOT NULL DEFAULT 0,
      "delivery_date" date, "delivery_payment_method_id" uuid, "delivery_reference" character varying(200),
      "delivery_notes" text, "reason" character varying(500), "created_by_user_id" uuid NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(), "submitted_by_user_id" uuid, "submitted_at" timestamptz,
      "reviewed_by_user_id" uuid, "reviewed_at" timestamptz, "confirmed_by_user_id" uuid, "confirmed_at" timestamptz,
      "rejected_by_user_id" uuid, "rejected_at" timestamptz, "cancelled_by_user_id" uuid, "cancelled_at" timestamptz,
      "idempotency_key" character varying(128) NOT NULL, "idempotency_fingerprint" text NOT NULL,
      "last_action_idempotency_key" character varying(128), "last_action_fingerprint" text,
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_collector_settlements" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_collector_settlements_status" CHECK ("status" IN ('DRAFT','SUBMITTED','UNDER_REVIEW','CONFIRMED','REJECTED','CANCELLED')),
      CONSTRAINT "CHK_collector_settlements_amounts" CHECK ("total_declared" > 0 AND "total_confirmed" >= 0 AND "amount_delivered" >= 0 AND "retained_amount" >= 0),
      CONSTRAINT "FK_collector_settlements_collector" FOREIGN KEY ("collector_id") REFERENCES "collectors"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_settlements_collector_user" FOREIGN KEY ("collector_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_settlements_delivery_method" FOREIGN KEY ("delivery_payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_settlements_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_settlements_submitter" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_settlements_reviewer" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_settlements_confirmer" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_settlements_rejecter" FOREIGN KEY ("rejected_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_settlements_canceller" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT)`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_settlements_idempotency" ON "collector_settlements" ("idempotency_key")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_settlements_action_idempotency" ON "collector_settlements" ("last_action_idempotency_key") WHERE "last_action_idempotency_key" IS NOT NULL`);
    await q.query(`CREATE INDEX "IDX_collector_settlements_collector_status" ON "collector_settlements" ("collector_id","status","created_at")`);

    await q.query(`CREATE TABLE "collector_settlement_actions" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "settlement_id" uuid NOT NULL,
      "action" character varying(16) NOT NULL, "actor_user_id" uuid NOT NULL,
      "reason" character varying(500), "idempotency_key" character varying(128) NOT NULL,
      "idempotency_fingerprint" text NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_collector_settlement_actions" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_collector_settlement_actions_action" CHECK ("action" IN ('SUBMIT','REVIEW','REJECT','CANCEL','CONFIRM')),
      CONSTRAINT "FK_collector_settlement_actions_settlement" FOREIGN KEY ("settlement_id") REFERENCES "collector_settlements"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_settlement_actions_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT)`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_settlement_actions_idempotency" ON "collector_settlement_actions" ("idempotency_key")`);
    await q.query(`CREATE INDEX "IDX_collector_settlement_actions_settlement" ON "collector_settlement_actions" ("settlement_id","created_at","id")`);

    await q.query(`CREATE TABLE "collector_settlement_items" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "settlement_id" uuid NOT NULL, "precollection_id" uuid NOT NULL,
      "declared_amount" numeric(18,2) NOT NULL, "confirmed_amount" numeric(18,2), "payment_id" uuid,
      "active_reservation" boolean NOT NULL DEFAULT true, "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_collector_settlement_items" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_collector_settlement_items_amounts" CHECK ("declared_amount" > 0 AND ("confirmed_amount" IS NULL OR "confirmed_amount" > 0)),
      CONSTRAINT "FK_collector_settlement_items_settlement" FOREIGN KEY ("settlement_id") REFERENCES "collector_settlements"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_settlement_items_precollection" FOREIGN KEY ("precollection_id") REFERENCES "collector_precollections"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_settlement_items_payment" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT)`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_settlement_items_pair" ON "collector_settlement_items" ("settlement_id","precollection_id")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_settlement_items_active_precollection" ON "collector_settlement_items" ("precollection_id") WHERE "active_reservation" = true`);

    await q.query(`CREATE TABLE "collector_custody_entries" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "collector_id" uuid NOT NULL, "direction" character varying(6) NOT NULL,
      "entry_type" character varying(32) NOT NULL, "amount" numeric(18,2) NOT NULL, "effective_date" date NOT NULL,
      "payment_method_id" uuid, "reference" character varying(200), "reason" character varying(500), "notes" text,
      "precollection_id" uuid, "settlement_id" uuid, "reversed_entry_id" uuid, "created_by_user_id" uuid NOT NULL,
      "idempotency_key" character varying(160) NOT NULL, "idempotency_fingerprint" text NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_collector_custody_entries" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_collector_custody_entries_amount" CHECK ("amount" > 0),
      CONSTRAINT "CHK_collector_custody_entries_direction" CHECK ("direction" IN ('CREDIT','DEBIT')),
      CONSTRAINT "CHK_collector_custody_entries_type" CHECK ("entry_type" IN ('CUSTOMER_COLLECTION','REMITTANCE_TO_COMPANY','COMPANY_TOP_UP','AUTHORIZED_ADJUSTMENT','REVERSAL','LOAN_DISBURSEMENT')),
      CONSTRAINT "CHK_collector_custody_entries_source" CHECK (("entry_type" = 'CUSTOMER_COLLECTION') = ("precollection_id" IS NOT NULL AND "reversed_entry_id" IS NULL) OR "entry_type" <> 'CUSTOMER_COLLECTION'),
      CONSTRAINT "FK_collector_custody_entries_collector" FOREIGN KEY ("collector_id") REFERENCES "collectors"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_custody_entries_method" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_custody_entries_precollection" FOREIGN KEY ("precollection_id") REFERENCES "collector_precollections"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_custody_entries_settlement" FOREIGN KEY ("settlement_id") REFERENCES "collector_settlements"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_custody_entries_reversed" FOREIGN KEY ("reversed_entry_id") REFERENCES "collector_custody_entries"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_custody_entries_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT)`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_custody_entries_idempotency" ON "collector_custody_entries" ("idempotency_key")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_custody_customer_collection" ON "collector_custody_entries" ("precollection_id") WHERE "entry_type" = 'CUSTOMER_COLLECTION'`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_custody_reversal" ON "collector_custody_entries" ("reversed_entry_id") WHERE "reversed_entry_id" IS NOT NULL`);
    await q.query(`CREATE INDEX "IDX_collector_custody_collector_date" ON "collector_custody_entries" ("collector_id","effective_date","created_at","id")`);
    await q.query(`CREATE FUNCTION guard_collector_custody_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN
      RAISE EXCEPTION 'collector custody entries are immutable'; END $fn$`);
    await q.query(`CREATE TRIGGER "TRG_collector_custody_immutable" BEFORE UPDATE OR DELETE ON "collector_custody_entries"
      FOR EACH ROW EXECUTE FUNCTION guard_collector_custody_immutable()`);
    await q.query(`INSERT INTO collector_custody_entries
      (collector_id,direction,entry_type,amount,effective_date,payment_method_id,reference,notes,precollection_id,
       created_by_user_id,idempotency_key,idempotency_fingerprint,created_at)
      SELECT collector_id,'CREDIT','CUSTOMER_COLLECTION',amount,effective_date,payment_method_id,reference,notes,id,
        recorded_by_user_id,'precollection:' || id::text || ':custody',idempotency_fingerprint,recorded_at
      FROM collector_precollections`);
    await q.query(`INSERT INTO collector_custody_entries
      (collector_id,direction,entry_type,amount,effective_date,payment_method_id,reason,precollection_id,reversed_entry_id,
       created_by_user_id,idempotency_key,idempotency_fingerprint,created_at)
      SELECT cp.collector_id,'DEBIT','REVERSAL',cp.amount,cp.effective_date,cp.payment_method_id,cp.cancellation_reason,cp.id,
        original.id,cp.cancelled_by_user_id,'precollection-cancel:' || cp.id::text || ':migration',
        cp.cancellation_idempotency_fingerprint,cp.cancelled_at
      FROM collector_precollections cp JOIN collector_custody_entries original
        ON original.precollection_id = cp.id AND original.entry_type = 'CUSTOMER_COLLECTION'
      WHERE cp.status = 'CANCELLED'`);

    await q.query(`INSERT INTO permissions (code,name,module,description) VALUES
      ('collector-settlements.self.create','Crear mis liquidaciones','LIQUIDACIONES',NULL),
      ('collector-settlements.create','Crear liquidaciones globales','LIQUIDACIONES',NULL),
      ('collector-settlements.self.view','Ver mis liquidaciones','LIQUIDACIONES',NULL),
      ('collector-settlements.view','Ver liquidaciones globales','LIQUIDACIONES',NULL),
      ('collector-settlements.self.submit','Enviar mis liquidaciones','LIQUIDACIONES',NULL),
      ('collector-settlements.submit','Enviar liquidaciones globales','LIQUIDACIONES',NULL),
      ('collector-settlements.review','Revisar liquidaciones','LIQUIDACIONES',NULL),
      ('collector-settlements.confirm','Confirmar liquidaciones','LIQUIDACIONES',NULL),
      ('collector-settlements.reject','Rechazar liquidaciones','LIQUIDACIONES',NULL),
      ('collector-settlements.self.cancel','Cancelar mis liquidaciones','LIQUIDACIONES',NULL),
      ('collector-settlements.cancel','Cancelar liquidaciones globales','LIQUIDACIONES',NULL),
      ('collector-custody.self.view','Ver mi custodia','CUSTODIA',NULL),
      ('collector-custody.view','Ver custodia global','CUSTODIA',NULL),
      ('collector-custody.self.remit','Remitir mi custodia','CUSTODIA',NULL),
      ('collector-custody.remit','Registrar remesas globales','CUSTODIA',NULL),
      ('collector-custody.topup','Registrar aportes de empresa','CUSTODIA',NULL),
      ('collector-custody.adjust','Registrar ajustes autorizados','CUSTODIA',NULL)
      ON CONFLICT (code) DO NOTHING`);
    await q.query(`INSERT INTO role_permissions (role_id, permission_id)
      SELECT role.id, permission.id FROM roles role CROSS JOIN permissions permission
      WHERE (role.code = 'COLLECTOR' AND permission.code IN (
        'collector-settlements.self.create','collector-settlements.self.view','collector-settlements.self.submit',
        'collector-settlements.self.cancel','collector-custody.self.view','collector-custody.self.remit'))
      OR (role.code = 'COLLECTION_MANAGER' AND permission.code IN (
        'collector-settlements.create','collector-settlements.view','collector-settlements.submit',
        'collector-settlements.review','collector-settlements.confirm','collector-settlements.reject',
        'collector-settlements.cancel','collector-custody.view','collector-custody.remit',
        'collector-custody.topup','collector-custody.adjust')) ON CONFLICT DO NOTHING`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $fn$ BEGIN
      IF EXISTS (SELECT 1 FROM collector_settlements) THEN
        RAISE EXCEPTION 'Cannot roll back collector settlements while records exist';
      END IF;
      IF EXISTS (SELECT 1 FROM collector_custody_entries
        WHERE entry_type NOT IN ('CUSTOMER_COLLECTION','REVERSAL')) THEN
        RAISE EXCEPTION 'Cannot roll back non-derived collector custody operations';
      END IF;
      IF EXISTS (SELECT 1 FROM collector_precollections WHERE custody_treatment = 'COMPANY_RECEIVED') THEN
        RAISE EXCEPTION 'Cannot roll back while COMPANY_RECEIVED custody treatment would be lost';
      END IF;
    END $fn$`);
    await q.query(`DROP TRIGGER IF EXISTS "TRG_collector_custody_immutable" ON "collector_custody_entries"`);
    await q.query(`DROP FUNCTION IF EXISTS guard_collector_custody_immutable()`);
    await q.query(`DROP TABLE "collector_custody_entries"`);
    await q.query(`DROP TABLE "collector_settlement_items"`);
    await q.query(`DROP TABLE "collector_settlement_actions"`);
    await q.query(`DROP TABLE "collector_settlements"`);
    await q.query(`ALTER TABLE "collector_precollections" DROP CONSTRAINT "CHK_collector_precollections_custody_treatment"`);
    await q.query(`ALTER TABLE "collector_precollections" DROP COLUMN "custody_treatment"`);
    await q.query(`DELETE FROM role_permissions WHERE permission_id IN (
      SELECT id FROM permissions WHERE code LIKE 'collector-settlements.%' OR code LIKE 'collector-custody.%')`);
    await q.query(`DELETE FROM permissions WHERE code LIKE 'collector-settlements.%' OR code LIKE 'collector-custody.%'`);
  }
}
