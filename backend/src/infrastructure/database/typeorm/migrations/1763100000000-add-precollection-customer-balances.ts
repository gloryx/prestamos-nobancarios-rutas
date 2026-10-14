import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPrecollectionCustomerBalances1763100000000 implements MigrationInterface {
  name = 'AddPrecollectionCustomerBalances1763100000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`DO $block$ BEGIN
      IF EXISTS (SELECT 1 FROM collector_precollections WHERE status = 'REJECTED') THEN
        RAISE EXCEPTION 'Cannot backfill customer receipt balances: rejected precollections have no temporal rejection audit';
      END IF;
      IF EXISTS (SELECT 1 FROM collector_precollections precollection
        JOIN loan_edit_operations operation ON operation.loan_id = precollection.loan_id
          AND operation.created_at > precollection.recorded_at) THEN
        RAISE EXCEPTION 'Cannot backfill customer receipt balances: a loan was edited after a precollection without historical amount snapshots';
      END IF;
    END $block$`);
    await q.query(`CREATE SEQUENCE "collector_precollection_receipt_number_seq" START WITH 1`);
    await q.query(`ALTER TABLE "collector_precollections"
      ADD "receipt_number" character varying(16),
      ADD "customer_balance_before" numeric(18,2),
      ADD "customer_balance_after" numeric(18,2)`);
    await q.query(`WITH numbered AS (
      SELECT id, row_number() OVER (ORDER BY recorded_at, id) AS sequence
      FROM collector_precollections
    )
    UPDATE collector_precollections target
    SET receipt_number = 'CP-' || lpad(numbered.sequence::text, 12, '0')
    FROM numbered WHERE numbered.id = target.id`);
    await q.query(`SELECT setval('collector_precollection_receipt_number_seq',
      GREATEST((SELECT COUNT(*) FROM collector_precollections), 1),
      EXISTS (SELECT 1 FROM collector_precollections))`);
    await q.query(`WITH historical AS (
      SELECT current.id, GREATEST(loan.total_amount
        - COALESCE((SELECT SUM(payment.amount)
          FROM payments payment
          LEFT JOIN payment_annulments annulment ON annulment.payment_id = payment.id
          WHERE payment.loan_id = current.loan_id
            AND NOT EXISTS (SELECT 1 FROM collector_settlement_items item WHERE item.payment_id = payment.id)
            AND (payment.payment_date, payment.created_at, payment.id)
              < (current.effective_date, current.recorded_at, current.id)
            AND payment.created_at <= current.recorded_at
            AND (annulment.annulled_at IS NULL OR annulment.annulled_at > current.recorded_at)), 0)
        - COALESCE((SELECT SUM(previous.amount)
          FROM collector_precollections previous
          WHERE previous.loan_id = current.loan_id
            AND (previous.effective_date, previous.recorded_at, previous.id)
              < (current.effective_date, current.recorded_at, current.id)
            AND previous.recorded_at <= current.recorded_at
            AND previous.status <> 'REJECTED'
            AND (previous.cancelled_at IS NULL OR previous.cancelled_at > current.recorded_at)), 0), 0)::numeric(18,2) AS balance_before
      FROM collector_precollections current
      JOIN loans loan ON loan.id = current.loan_id
    )
    UPDATE collector_precollections target SET
      customer_balance_before = historical.balance_before,
      customer_balance_after = GREATEST(historical.balance_before - target.amount, 0)::numeric(18,2)
    FROM historical WHERE historical.id = target.id`);
    await q.query(`ALTER TABLE "collector_precollections"
      ALTER COLUMN "receipt_number" SET DEFAULT
        ('CP-' || lpad(nextval('collector_precollection_receipt_number_seq')::text, 12, '0')),
      ALTER COLUMN "receipt_number" SET NOT NULL,
      ALTER COLUMN "customer_balance_before" SET NOT NULL,
      ALTER COLUMN "customer_balance_after" SET NOT NULL,
      ADD CONSTRAINT "UQ_collector_precollections_receipt_number" UNIQUE ("receipt_number"),
      ADD CONSTRAINT "CHK_collector_precollections_customer_balances"
        CHECK ("customer_balance_before" >= 0 AND "customer_balance_after" >= 0
          AND "customer_balance_after" <= "customer_balance_before")`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "collector_precollections"
      DROP CONSTRAINT "CHK_collector_precollections_customer_balances",
      DROP CONSTRAINT "UQ_collector_precollections_receipt_number",
      DROP COLUMN "customer_balance_after",
      DROP COLUMN "customer_balance_before",
      DROP COLUMN "receipt_number"`);
    await q.query(`DROP SEQUENCE "collector_precollection_receipt_number_seq"`);
  }
}
