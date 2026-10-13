import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCollectorOperationalProgramming1762700000000 implements MigrationInterface {
  name = 'CreateCollectorOperationalProgramming1762700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "collector_collection_model_activations" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "singleton_key" character varying(20) NOT NULL DEFAULT 'DEFAULT',
      "model_version" integer NOT NULL,
      "activation_date" date NOT NULL,
      "activated_by_user_id" uuid NOT NULL,
      "idempotency_key" character varying(128) NOT NULL,
      "idempotency_fingerprint" text NOT NULL,
      "activated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_collector_collection_model_activations" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_collector_collection_model_activation_singleton" CHECK ("singleton_key" = 'DEFAULT'),
      CONSTRAINT "CHK_collector_collection_model_activation_version" CHECK ("model_version" > 0),
      CONSTRAINT "FK_collector_collection_model_activation_actor" FOREIGN KEY ("activated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
    )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_collection_model_activation_singleton"
      ON "collector_collection_model_activations" ("singleton_key")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_collection_model_activation_version"
      ON "collector_collection_model_activations" ("model_version")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_collection_model_activation_idempotency"
      ON "collector_collection_model_activations" ("idempotency_key")`);

    await q.query(`CREATE TABLE "collector_operational_plan_versions" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "activation_id" uuid NOT NULL,
      "loan_id" uuid NOT NULL,
      "version" integer NOT NULL,
      "previous_version_id" uuid,
      "event_type" character varying(40) NOT NULL,
      "effective_from" date NOT NULL,
      "baseline_valid_payments" numeric(18,2) NOT NULL,
      "baseline_financial_balance" numeric(18,2) NOT NULL,
      "baseline_active_precollections" numeric(18,2) NOT NULL,
      "plan_total" numeric(18,2) NOT NULL,
      "collector_id" uuid NOT NULL,
      "collector_user_id" uuid NOT NULL,
      "route_id" uuid NOT NULL,
      "customer_route_assignment_id" uuid NOT NULL,
      "collector_route_assignment_id" uuid NOT NULL,
      "created_by_user_id" uuid NOT NULL,
      "reason" character varying(500),
      "idempotency_key" character varying(128) NOT NULL,
      "idempotency_fingerprint" text NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_collector_operational_plan_versions" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_collector_operational_plan_version" CHECK ("version" > 0),
      CONSTRAINT "CHK_collector_operational_plan_event" CHECK ("event_type" IN (
        'ACTIVATION_BASELINE','COLLECTOR_NEGOTIATION','PAYMENT_ANNULMENT_REBASELINE',
        'REFINANCING_SUCCESSOR','REFINANCING_ANNULMENT_RESTORE','TERMINATION')),
      CONSTRAINT "CHK_collector_operational_plan_amounts" CHECK (
        "baseline_valid_payments" >= 0 AND "baseline_financial_balance" >= 0
        AND "baseline_active_precollections" >= 0 AND "plan_total" >= 0
        AND "baseline_active_precollections" <= "baseline_financial_balance"
        AND (("event_type" = 'TERMINATION' AND "plan_total" = 0)
          OR ("event_type" <> 'TERMINATION' AND "plan_total" > 0
            AND "plan_total" = "baseline_financial_balance" - "baseline_active_precollections"))),
      CONSTRAINT "CHK_collector_operational_plan_previous" CHECK (
        ("version" = 1 AND "previous_version_id" IS NULL)
        OR ("version" > 1 AND "previous_version_id" IS NOT NULL)),
      CONSTRAINT "FK_collector_operational_plan_activation" FOREIGN KEY ("activation_id") REFERENCES "collector_collection_model_activations"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_operational_plan_loan" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_operational_plan_previous" FOREIGN KEY ("previous_version_id") REFERENCES "collector_operational_plan_versions"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_operational_plan_collector" FOREIGN KEY ("collector_id") REFERENCES "collectors"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_operational_plan_collector_user" FOREIGN KEY ("collector_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_operational_plan_route" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_operational_plan_customer_assignment" FOREIGN KEY ("customer_route_assignment_id") REFERENCES "customer_route_assignments"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_operational_plan_collector_assignment" FOREIGN KEY ("collector_route_assignment_id") REFERENCES "collector_route_assignments"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_operational_plan_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
    )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_operational_plan_loan_version"
      ON "collector_operational_plan_versions" ("loan_id","version")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_operational_plan_previous"
      ON "collector_operational_plan_versions" ("previous_version_id") WHERE "previous_version_id" IS NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_operational_plan_idempotency"
      ON "collector_operational_plan_versions" ("idempotency_key")`);
    await q.query(`CREATE INDEX "IDX_collector_operational_plan_effective"
      ON "collector_operational_plan_versions" ("loan_id","effective_from","version")`);
    await q.query(`CREATE INDEX "IDX_collector_operational_plan_collector"
      ON "collector_operational_plan_versions" ("collector_user_id","effective_from","loan_id")`);

    await q.query(`CREATE TABLE "collector_operational_plan_entries" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "plan_version_id" uuid NOT NULL,
      "sequence" integer NOT NULL,
      "due_date" date NOT NULL,
      "scheduled_amount" numeric(18,2) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_collector_operational_plan_entries" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_collector_operational_plan_entry_sequence" CHECK ("sequence" > 0),
      CONSTRAINT "CHK_collector_operational_plan_entry_amount" CHECK ("scheduled_amount" > 0),
      CONSTRAINT "FK_collector_operational_plan_entry_version" FOREIGN KEY ("plan_version_id") REFERENCES "collector_operational_plan_versions"("id") ON DELETE RESTRICT
    )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_operational_plan_entry_sequence"
      ON "collector_operational_plan_entries" ("plan_version_id","sequence")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_operational_plan_entry_date"
      ON "collector_operational_plan_entries" ("plan_version_id","due_date")`);
    await q.query(`CREATE INDEX "IDX_collector_operational_plan_entry_due"
      ON "collector_operational_plan_entries" ("due_date","plan_version_id")`);

    await q.query(`CREATE TABLE "collector_collection_day_snapshots" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "activation_id" uuid NOT NULL,
      "snapshot_date" date NOT NULL,
      "loan_id" uuid NOT NULL,
      "operational_plan_version_id" uuid NOT NULL,
      "revision" integer NOT NULL,
      "supersedes_snapshot_id" uuid,
      "collector_id" uuid NOT NULL,
      "collector_user_id" uuid NOT NULL,
      "route_id" uuid NOT NULL,
      "customer_route_assignment_id" uuid NOT NULL,
      "collector_route_assignment_id" uuid NOT NULL,
      "scheduled_for_date" numeric(18,2) NOT NULL,
      "scheduled_through_date" numeric(18,2) NOT NULL,
      "plan_total" numeric(18,2) NOT NULL,
      "generation_reason" character varying(24) NOT NULL,
      "generated_by_user_id" uuid,
      "generation_key" character varying(128) NOT NULL,
      "generation_fingerprint" text NOT NULL,
      "generated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_collector_collection_day_snapshots" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_collector_collection_day_snapshot_revision" CHECK ("revision" > 0),
      CONSTRAINT "CHK_collector_collection_day_snapshot_chain" CHECK (
        ("revision" = 1 AND "supersedes_snapshot_id" IS NULL)
        OR ("revision" > 1 AND "supersedes_snapshot_id" IS NOT NULL)),
      CONSTRAINT "CHK_collector_collection_day_snapshot_amounts" CHECK (
        "scheduled_for_date" >= 0 AND "scheduled_through_date" >= 0 AND "plan_total" > 0
        AND "scheduled_for_date" <= "scheduled_through_date" AND "scheduled_through_date" <= "plan_total"),
      CONSTRAINT "CHK_collector_collection_day_snapshot_reason" CHECK ("generation_reason" IN (
        'ACTIVATION','DAILY','READ_THROUGH','PLAN_VERSION','REASSIGNMENT','CORRECTION')),
      CONSTRAINT "FK_collector_collection_day_snapshot_activation" FOREIGN KEY ("activation_id") REFERENCES "collector_collection_model_activations"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_collection_day_snapshot_loan" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_collection_day_snapshot_plan" FOREIGN KEY ("operational_plan_version_id") REFERENCES "collector_operational_plan_versions"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_collection_day_snapshot_previous" FOREIGN KEY ("supersedes_snapshot_id") REFERENCES "collector_collection_day_snapshots"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_collection_day_snapshot_collector" FOREIGN KEY ("collector_id") REFERENCES "collectors"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_collection_day_snapshot_collector_user" FOREIGN KEY ("collector_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_collection_day_snapshot_route" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_collection_day_snapshot_customer_assignment" FOREIGN KEY ("customer_route_assignment_id") REFERENCES "customer_route_assignments"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_collection_day_snapshot_collector_assignment" FOREIGN KEY ("collector_route_assignment_id") REFERENCES "collector_route_assignments"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_collector_collection_day_snapshot_generator" FOREIGN KEY ("generated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
    )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_collection_day_snapshot_revision"
      ON "collector_collection_day_snapshots" ("loan_id","snapshot_date","revision")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_collection_day_snapshot_previous"
      ON "collector_collection_day_snapshots" ("supersedes_snapshot_id") WHERE "supersedes_snapshot_id" IS NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_collection_day_snapshot_source"
      ON "collector_collection_day_snapshots" ("snapshot_date","loan_id","operational_plan_version_id",
        "customer_route_assignment_id","collector_route_assignment_id")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collector_collection_day_snapshot_generation_key"
      ON "collector_collection_day_snapshots" ("generation_key")`);
    await q.query(`CREATE INDEX "IDX_collector_collection_day_snapshot_collector_date"
      ON "collector_collection_day_snapshots" ("collector_user_id","snapshot_date","loan_id")`);
    await q.query(`CREATE INDEX "IDX_collector_collection_day_snapshot_plan"
      ON "collector_collection_day_snapshots" ("operational_plan_version_id","snapshot_date")`);

    await q.query(`ALTER TABLE "collector_precollections" ADD "collection_day_snapshot_id" uuid`);
    await q.query(`ALTER TABLE "collector_precollections" ADD CONSTRAINT "FK_collector_precollections_collection_day_snapshot"
      FOREIGN KEY ("collection_day_snapshot_id") REFERENCES "collector_collection_day_snapshots"("id") ON DELETE RESTRICT`);
    await q.query(`CREATE INDEX "IDX_collector_precollections_collection_day_snapshot"
      ON "collector_precollections" ("collection_day_snapshot_id") WHERE "collection_day_snapshot_id" IS NOT NULL`);

    await q.query(`CREATE FUNCTION guard_collector_operational_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = TG_TABLE_NAME || ' rows are immutable';
      END $fn$`);
    for (const table of ['collector_collection_model_activations', 'collector_operational_plan_versions',
      'collector_operational_plan_entries', 'collector_collection_day_snapshots']) {
      await q.query(`CREATE TRIGGER "TRG_${table}_immutable" BEFORE UPDATE OR DELETE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION guard_collector_operational_immutable()`);
    }

    await q.query(`CREATE FUNCTION validate_collector_operational_plan_version() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE
        activation_date_value date;
        loan_customer_id uuid;
        loan_total numeric(18,2);
        valid_payments numeric(18,2);
        active_precollections numeric(18,2);
        previous_row collector_operational_plan_versions%ROWTYPE;
      BEGIN
        SELECT activation_date INTO activation_date_value FROM collector_collection_model_activations
          WHERE id = NEW.activation_id;
        IF activation_date_value IS NULL OR NEW.effective_from < activation_date_value THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_collector_operational_plan_activation_date',
            MESSAGE = 'operational plan predates model activation';
        END IF;

        SELECT customer_id, total_amount INTO loan_customer_id, loan_total FROM loans WHERE id = NEW.loan_id FOR SHARE;
        SELECT COALESCE(SUM(amount), 0) INTO valid_payments FROM payments
          WHERE loan_id = NEW.loan_id AND status = 'VALID';
        SELECT COALESCE(SUM(amount), 0) INTO active_precollections FROM collector_precollections
          WHERE loan_id = NEW.loan_id AND status IN ('RECORDED','SUBMITTED');
        IF NEW.baseline_valid_payments <> valid_payments
          OR NEW.baseline_financial_balance <> loan_total - valid_payments
          OR NEW.baseline_active_precollections <> active_precollections
          OR (NEW.event_type = 'TERMINATION' AND NEW.plan_total <> 0)
          OR (NEW.event_type <> 'TERMINATION'
            AND NEW.plan_total <> loan_total - valid_payments - active_precollections) THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_collector_operational_plan_financial_baseline',
            MESSAGE = 'operational plan baseline does not reconcile';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM customer_route_assignments assignment
          WHERE assignment.id = NEW.customer_route_assignment_id AND assignment.customer_id = loan_customer_id
            AND assignment.route_id = NEW.route_id
            AND (assignment.assigned_at AT TIME ZONE 'America/Costa_Rica')::date <= NEW.effective_from
            AND (assignment.ended_at IS NULL OR (assignment.ended_at AT TIME ZONE 'America/Costa_Rica')::date >= NEW.effective_from))
          OR NOT EXISTS (SELECT 1 FROM collector_route_assignments assignment
          WHERE assignment.id = NEW.collector_route_assignment_id AND assignment.route_id = NEW.route_id
            AND assignment.collector_user_id = NEW.collector_user_id
            AND (assignment.assigned_at AT TIME ZONE 'America/Costa_Rica')::date <= NEW.effective_from
            AND (assignment.ended_at IS NULL OR (assignment.ended_at AT TIME ZONE 'America/Costa_Rica')::date >= NEW.effective_from))
          OR NOT EXISTS (SELECT 1 FROM collector_user_assignments assignment
          WHERE assignment.collector_id = NEW.collector_id AND assignment.user_id = NEW.collector_user_id
            AND (assignment.assigned_at AT TIME ZONE 'America/Costa_Rica')::date <= NEW.effective_from
            AND (assignment.ended_at IS NULL OR (assignment.ended_at AT TIME ZONE 'America/Costa_Rica')::date >= NEW.effective_from)) THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_collector_operational_plan_assignment',
            MESSAGE = 'operational plan assignment does not reconcile';
        END IF;

        IF NEW.previous_version_id IS NOT NULL THEN
          SELECT * INTO previous_row FROM collector_operational_plan_versions WHERE id = NEW.previous_version_id;
          IF previous_row.id IS NULL OR previous_row.loan_id <> NEW.loan_id
            OR previous_row.activation_id <> NEW.activation_id OR NEW.version <> previous_row.version + 1
            OR NEW.effective_from < previous_row.effective_from THEN
            RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_collector_operational_plan_lineage',
              MESSAGE = 'operational plan lineage does not reconcile';
          END IF;
        END IF;
        RETURN NEW;
      END $fn$`);
    await q.query(`CREATE TRIGGER "TRG_collector_operational_plan_validate" BEFORE INSERT ON "collector_operational_plan_versions"
      FOR EACH ROW EXECUTE FUNCTION validate_collector_operational_plan_version()`);

    await q.query(`CREATE FUNCTION validate_collector_operational_plan_entry() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE effective_date_value date;
      BEGIN
        SELECT effective_from INTO effective_date_value FROM collector_operational_plan_versions
          WHERE id = NEW.plan_version_id;
        IF NEW.due_date < effective_date_value THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_collector_operational_plan_entry_date',
            MESSAGE = 'operational plan entry predates its version';
        END IF;
        IF EXISTS (SELECT 1 FROM collector_collection_day_snapshots
          WHERE operational_plan_version_id = NEW.plan_version_id) THEN
          RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'snapshotted operational plan entries are sealed';
        END IF;
        RETURN NEW;
      END $fn$`);
    await q.query(`CREATE TRIGGER "TRG_collector_operational_plan_entry_validate" BEFORE INSERT ON "collector_operational_plan_entries"
      FOR EACH ROW EXECUTE FUNCTION validate_collector_operational_plan_entry()`);

    await q.query(`CREATE FUNCTION validate_collector_operational_plan_total() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE version_id uuid; expected numeric(18,2); event_value character varying(40); actual numeric(18,2);
      BEGIN
        version_id := CASE WHEN TG_TABLE_NAME = 'collector_operational_plan_versions' THEN NEW.id ELSE NEW.plan_version_id END;
        SELECT plan_total, event_type INTO expected, event_value FROM collector_operational_plan_versions WHERE id = version_id;
        SELECT COALESCE(SUM(scheduled_amount), 0) INTO actual FROM collector_operational_plan_entries
          WHERE plan_version_id = version_id;
        IF actual <> expected OR (event_value = 'TERMINATION' AND actual <> 0) THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_collector_operational_plan_entry_total',
            MESSAGE = 'operational plan entries do not reconcile with plan total';
        END IF;
        RETURN NULL;
      END $fn$`);
    await q.query(`CREATE CONSTRAINT TRIGGER "TRG_collector_operational_plan_total_from_version"
      AFTER INSERT ON "collector_operational_plan_versions" DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_collector_operational_plan_total()`);
    await q.query(`CREATE CONSTRAINT TRIGGER "TRG_collector_operational_plan_total_from_entry"
      AFTER INSERT ON "collector_operational_plan_entries" DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_collector_operational_plan_total()`);

    await q.query(`CREATE FUNCTION validate_collector_collection_day_snapshot() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE
        plan_row collector_operational_plan_versions%ROWTYPE;
        activation_date_value date;
        loan_customer_id uuid;
        expected_for_date numeric(18,2);
        expected_through_date numeric(18,2);
        previous_row collector_collection_day_snapshots%ROWTYPE;
      BEGIN
        SELECT * INTO plan_row FROM collector_operational_plan_versions WHERE id = NEW.operational_plan_version_id;
        SELECT activation_date INTO activation_date_value FROM collector_collection_model_activations WHERE id = NEW.activation_id;
        SELECT customer_id INTO loan_customer_id FROM loans WHERE id = NEW.loan_id;
        IF plan_row.id IS NULL OR plan_row.loan_id <> NEW.loan_id OR plan_row.activation_id <> NEW.activation_id
          OR plan_row.event_type = 'TERMINATION' OR plan_row.effective_from > NEW.snapshot_date
          OR activation_date_value IS NULL OR NEW.snapshot_date < activation_date_value THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_collector_collection_day_snapshot_plan',
            MESSAGE = 'collection day snapshot plan does not reconcile';
        END IF;
        SELECT COALESCE(SUM(scheduled_amount) FILTER (WHERE due_date = NEW.snapshot_date), 0),
          COALESCE(SUM(scheduled_amount) FILTER (WHERE due_date <= NEW.snapshot_date), 0)
          INTO expected_for_date, expected_through_date FROM collector_operational_plan_entries
          WHERE plan_version_id = NEW.operational_plan_version_id;
        IF NEW.scheduled_for_date <> expected_for_date OR NEW.scheduled_through_date <> expected_through_date
          OR NEW.plan_total <> plan_row.plan_total THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_collector_collection_day_snapshot_amounts_source',
            MESSAGE = 'collection day snapshot amounts do not reconcile';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM customer_route_assignments assignment
          WHERE assignment.id = NEW.customer_route_assignment_id AND assignment.customer_id = loan_customer_id
            AND assignment.route_id = NEW.route_id
            AND (assignment.assigned_at AT TIME ZONE 'America/Costa_Rica')::date <= NEW.snapshot_date
            AND (assignment.ended_at IS NULL OR (assignment.ended_at AT TIME ZONE 'America/Costa_Rica')::date >= NEW.snapshot_date))
          OR NOT EXISTS (SELECT 1 FROM collector_route_assignments assignment
          WHERE assignment.id = NEW.collector_route_assignment_id AND assignment.route_id = NEW.route_id
            AND assignment.collector_user_id = NEW.collector_user_id
            AND (assignment.assigned_at AT TIME ZONE 'America/Costa_Rica')::date <= NEW.snapshot_date
            AND (assignment.ended_at IS NULL OR (assignment.ended_at AT TIME ZONE 'America/Costa_Rica')::date >= NEW.snapshot_date))
          OR NOT EXISTS (SELECT 1 FROM collector_user_assignments assignment
          WHERE assignment.collector_id = NEW.collector_id AND assignment.user_id = NEW.collector_user_id
            AND (assignment.assigned_at AT TIME ZONE 'America/Costa_Rica')::date <= NEW.snapshot_date
            AND (assignment.ended_at IS NULL OR (assignment.ended_at AT TIME ZONE 'America/Costa_Rica')::date >= NEW.snapshot_date)) THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_collector_collection_day_snapshot_assignment',
            MESSAGE = 'collection day snapshot assignment does not reconcile';
        END IF;
        IF NEW.supersedes_snapshot_id IS NOT NULL THEN
          SELECT * INTO previous_row FROM collector_collection_day_snapshots WHERE id = NEW.supersedes_snapshot_id;
          IF previous_row.id IS NULL OR previous_row.loan_id <> NEW.loan_id
            OR previous_row.snapshot_date <> NEW.snapshot_date OR NEW.revision <> previous_row.revision + 1
            OR previous_row.activation_id <> NEW.activation_id THEN
            RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_collector_collection_day_snapshot_lineage',
              MESSAGE = 'collection day snapshot lineage does not reconcile';
          END IF;
        END IF;
        RETURN NEW;
      END $fn$`);
    await q.query(`CREATE TRIGGER "TRG_collector_collection_day_snapshot_validate" BEFORE INSERT ON "collector_collection_day_snapshots"
      FOR EACH ROW EXECUTE FUNCTION validate_collector_collection_day_snapshot()`);

    await q.query(`CREATE FUNCTION validate_collector_precollection_snapshot() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.collection_day_snapshot_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM collector_collection_day_snapshots snapshot
          JOIN loans loan ON loan.id = snapshot.loan_id
          WHERE snapshot.id = NEW.collection_day_snapshot_id AND snapshot.loan_id = NEW.loan_id
            AND loan.customer_id = NEW.customer_id AND snapshot.snapshot_date = NEW.effective_date
            AND snapshot.collector_id = NEW.collector_id AND snapshot.collector_user_id = NEW.collector_user_id
            AND snapshot.route_id = NEW.route_id
            AND snapshot.customer_route_assignment_id = NEW.customer_route_assignment_id
            AND snapshot.collector_route_assignment_id = NEW.collector_route_assignment_id
        ) THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'CHK_collector_precollection_snapshot_source',
            MESSAGE = 'precollection does not reconcile with collection day snapshot';
        END IF;
        RETURN NEW;
      END $fn$`);
    await q.query(`CREATE TRIGGER "TRG_collector_precollection_snapshot_validate"
      BEFORE INSERT OR UPDATE OF "collection_day_snapshot_id" ON "collector_precollections"
      FOR EACH ROW EXECUTE FUNCTION validate_collector_precollection_snapshot()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $fn$ BEGIN
      IF EXISTS (SELECT 1 FROM collector_collection_model_activations)
        OR EXISTS (SELECT 1 FROM collector_operational_plan_versions)
        OR EXISTS (SELECT 1 FROM collector_operational_plan_entries)
        OR EXISTS (SELECT 1 FROM collector_collection_day_snapshots)
        OR EXISTS (SELECT 1 FROM collector_precollections WHERE collection_day_snapshot_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Cannot roll back collector operational programming while records exist';
      END IF;
    END $fn$`);
    await q.query(`DROP TRIGGER "TRG_collector_precollection_snapshot_validate" ON "collector_precollections"`);
    await q.query(`DROP FUNCTION validate_collector_precollection_snapshot()`);
    await q.query(`DROP INDEX "IDX_collector_precollections_collection_day_snapshot"`);
    await q.query(`ALTER TABLE "collector_precollections" DROP CONSTRAINT "FK_collector_precollections_collection_day_snapshot"`);
    await q.query(`ALTER TABLE "collector_precollections" DROP COLUMN "collection_day_snapshot_id"`);
    await q.query(`DROP TRIGGER "TRG_collector_collection_day_snapshot_validate" ON "collector_collection_day_snapshots"`);
    await q.query(`DROP FUNCTION validate_collector_collection_day_snapshot()`);
    await q.query(`DROP TRIGGER "TRG_collector_operational_plan_total_from_entry" ON "collector_operational_plan_entries"`);
    await q.query(`DROP TRIGGER "TRG_collector_operational_plan_total_from_version" ON "collector_operational_plan_versions"`);
    await q.query(`DROP FUNCTION validate_collector_operational_plan_total()`);
    await q.query(`DROP TRIGGER "TRG_collector_operational_plan_entry_validate" ON "collector_operational_plan_entries"`);
    await q.query(`DROP FUNCTION validate_collector_operational_plan_entry()`);
    await q.query(`DROP TRIGGER "TRG_collector_operational_plan_validate" ON "collector_operational_plan_versions"`);
    await q.query(`DROP FUNCTION validate_collector_operational_plan_version()`);
    for (const table of ['collector_collection_day_snapshots', 'collector_operational_plan_entries',
      'collector_operational_plan_versions', 'collector_collection_model_activations']) {
      await q.query(`DROP TRIGGER "TRG_${table}_immutable" ON "${table}"`);
    }
    await q.query(`DROP FUNCTION guard_collector_operational_immutable()`);
    await q.query(`DROP TABLE "collector_collection_day_snapshots"`);
    await q.query(`DROP TABLE "collector_operational_plan_entries"`);
    await q.query(`DROP TABLE "collector_operational_plan_versions"`);
    await q.query(`DROP TABLE "collector_collection_model_activations"`);
  }
}
