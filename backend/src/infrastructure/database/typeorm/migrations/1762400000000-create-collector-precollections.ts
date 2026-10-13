import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCollectorPrecollections1762400000000 implements MigrationInterface {
  name = 'CreateCollectorPrecollections1762400000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "collector_precollections" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "collector_id" uuid NOT NULL,
      "collector_user_id" uuid NOT NULL,
      "customer_id" uuid NOT NULL,
      "loan_id" uuid NOT NULL,
      "route_id" uuid NOT NULL,
      "customer_route_assignment_id" uuid NOT NULL,
      "collector_route_assignment_id" uuid NOT NULL,
      "payment_method_id" uuid NOT NULL,
      "amount" numeric(18,2) NOT NULL,
      "effective_date" date NOT NULL,
      "reference" character varying(200),
      "notes" text,
      "status" character varying(16) NOT NULL DEFAULT 'RECORDED',
      "recorded_by_user_id" uuid NOT NULL,
      "recorded_at" timestamptz NOT NULL DEFAULT now(),
      "idempotency_key" character varying(128) NOT NULL,
      "idempotency_fingerprint" text NOT NULL,
      "cancelled_by_user_id" uuid,
      "cancelled_at" timestamptz,
      "cancellation_reason" character varying(500),
      "cancellation_idempotency_key" character varying(128),
      "cancellation_idempotency_fingerprint" text,
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_collector_precollections" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_collector_precollections_amount" CHECK ("amount" > 0),
      CONSTRAINT "CHK_collector_precollections_reference" CHECK ("reference" IS NULL OR char_length(btrim("reference")) BETWEEN 1 AND 200),
      CONSTRAINT "CHK_collector_precollections_notes" CHECK ("notes" IS NULL OR char_length(btrim("notes")) BETWEEN 1 AND 1000),
      CONSTRAINT "CHK_collector_precollections_status" CHECK ("status" IN ('RECORDED','SUBMITTED','SETTLED','REJECTED','CANCELLED')),
      CONSTRAINT "CHK_collector_precollections_cancellation_shape" CHECK (
        ("status" = 'CANCELLED' AND "cancelled_by_user_id" IS NOT NULL AND "cancelled_at" IS NOT NULL
          AND "cancellation_reason" IS NOT NULL AND char_length(btrim("cancellation_reason")) BETWEEN 1 AND 500
          AND "cancellation_idempotency_key" IS NOT NULL AND "cancellation_idempotency_fingerprint" IS NOT NULL)
        OR ("status" <> 'CANCELLED' AND "cancelled_by_user_id" IS NULL AND "cancelled_at" IS NULL
          AND "cancellation_reason" IS NULL AND "cancellation_idempotency_key" IS NULL
          AND "cancellation_idempotency_fingerprint" IS NULL)),
      CONSTRAINT "FK_collector_precollections_collector" FOREIGN KEY ("collector_id") REFERENCES "collectors"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_precollections_collector_user" FOREIGN KEY ("collector_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_precollections_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_precollections_loan" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_precollections_route" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_precollections_customer_assignment" FOREIGN KEY ("customer_route_assignment_id") REFERENCES "customer_route_assignments"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_precollections_collector_assignment" FOREIGN KEY ("collector_route_assignment_id") REFERENCES "collector_route_assignments"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_precollections_method" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_precollections_recorder" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_precollections_canceller" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
    )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_precollections_idempotency"
      ON "collector_precollections" ("idempotency_key")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_precollections_cancellation_key"
      ON "collector_precollections" ("cancellation_idempotency_key")
      WHERE "cancellation_idempotency_key" IS NOT NULL`);
    await q.query(`CREATE INDEX "IDX_collector_precollections_collector_date"
      ON "collector_precollections" ("collector_id", "effective_date", "recorded_at", "id")`);
    await q.query(`CREATE INDEX "IDX_collector_precollections_date"
      ON "collector_precollections" ("effective_date", "recorded_at", "id")`);
    await q.query(`CREATE INDEX "IDX_collector_precollections_loan_reservation"
      ON "collector_precollections" ("loan_id", "status") WHERE "status" IN ('RECORDED','SUBMITTED')`);
    await q.query(`CREATE INDEX "IDX_collector_precollections_method_date"
      ON "collector_precollections" ("payment_method_id", "effective_date")`);
    await q.query(`CREATE INDEX "IDX_collector_precollections_route_date"
      ON "collector_precollections" ("route_id", "effective_date")`);

    await q.query(`INSERT INTO permissions (code, name, module, description) VALUES
      ('collector-precollections.create','Registrar cobros preliminares','COBRANZAS',NULL),
      ('collector-precollections.assigned.view','Ver mis cobros preliminares','COBRANZAS',NULL),
      ('collector-precollections.view','Consultar todos los cobros preliminares','COBRANZAS',NULL),
      ('collector-precollections.cancel','Cancelar cobros preliminares','COBRANZAS',NULL)
      ON CONFLICT (code) DO NOTHING`);
    await q.query(`INSERT INTO role_permissions (role_id, permission_id)
      SELECT role.id, permission.id FROM roles role CROSS JOIN permissions permission
      WHERE role.code = 'COLLECTOR' AND permission.code IN (
        'collector-precollections.create', 'collector-precollections.assigned.view', 'collector-precollections.cancel')
      ON CONFLICT DO NOTHING`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $fn$ BEGIN
      IF EXISTS (SELECT 1 FROM collector_precollections) THEN
        RAISE EXCEPTION 'Cannot roll back collector precollections while records exist';
      END IF;
      IF EXISTS (
        SELECT 1 FROM role_permissions rp
        JOIN permissions permission ON permission.id = rp.permission_id
        JOIN roles role ON role.id = rp.role_id
        WHERE permission.code LIKE 'collector-precollections.%' AND role.code <> 'COLLECTOR'
      ) THEN RAISE EXCEPTION 'Cannot roll back collector precollections while non-default permission grants exist';
      END IF;
    END $fn$`);
    await q.query(`DELETE FROM role_permissions WHERE permission_id IN (
      SELECT id FROM permissions WHERE code IN ('collector-precollections.create',
        'collector-precollections.assigned.view', 'collector-precollections.view', 'collector-precollections.cancel'))`);
    await q.query(`DELETE FROM permissions WHERE code IN ('collector-precollections.create',
      'collector-precollections.assigned.view', 'collector-precollections.view', 'collector-precollections.cancel')`);
    await q.query(`DROP TABLE "collector_precollections"`);
  }
}
