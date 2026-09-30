import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLoanStatusHistory1761500000000 implements MigrationInterface {
  name = 'CreateLoanStatusHistory1761500000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "loan_status_history" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "loan_id" uuid NOT NULL,
      "event_kind" varchar NOT NULL,
      "from_status" varchar,
      "to_status" varchar NOT NULL,
      "changed_at" timestamptz NOT NULL,
      "changed_by_user_id" uuid,
      "reason" text,
      "payment_id" uuid,
      "payment_annulment_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_loan_status_history" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_loan_status_history_kind" CHECK ("event_kind" IN ('CREATED','TRANSITION')),
      CONSTRAINT "CHK_loan_status_history_to_status" CHECK ("to_status" IN ('ACTIVE','CANCELLED','REFINANCED','UNCOLLECTIBLE','ANNULLED')),
      CONSTRAINT "CHK_loan_status_history_from_status" CHECK ("from_status" IS NULL OR "from_status" IN ('ACTIVE','CANCELLED','REFINANCED','UNCOLLECTIBLE','ANNULLED')),
      CONSTRAINT "CHK_loan_status_history_shape" CHECK (
        ("event_kind" = 'CREATED' AND "from_status" IS NULL AND "to_status" = 'ACTIVE' AND "reason" IS NULL AND "payment_id" IS NULL AND "payment_annulment_id" IS NULL)
        OR ("event_kind" = 'TRANSITION' AND "from_status" IS NOT NULL AND "from_status" <> "to_status")
      ),
      CONSTRAINT "FK_loan_status_history_loan" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_loan_status_history_user" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_loan_status_history_payment" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_loan_status_history_annulment" FOREIGN KEY ("payment_annulment_id") REFERENCES "payment_annulments"("id") ON DELETE RESTRICT
    )`);
    await q.query(`CREATE INDEX "IDX_loan_status_history_loan_time" ON "loan_status_history" ("loan_id", "changed_at" DESC, "id" DESC)`);
    await q.query(`CREATE INDEX "IDX_loan_status_history_status_time" ON "loan_status_history" ("to_status", "changed_at")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_loan_status_history_created" ON "loan_status_history" ("loan_id") WHERE "event_kind" = 'CREATED'`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "UQ_loan_status_history_created"`);
    await q.query(`DROP INDEX "IDX_loan_status_history_status_time"`);
    await q.query(`DROP INDEX "IDX_loan_status_history_loan_time"`);
    await q.query(`DROP TABLE "loan_status_history"`);
  }
}
