import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('collector precollection customer balance migration', () => {
  const migration = readFileSync(join(__dirname,
    '../src/infrastructure/database/typeorm/migrations/1763100000000-add-precollection-customer-balances.ts'), 'utf8');

  it('persists non-negative before/after snapshots and backfills in deterministic event order', () => {
    expect(migration).toContain('collector_precollection_receipt_number_seq');
    expect(migration).toContain('UQ_collector_precollections_receipt_number');
    expect(migration).toContain("'CP-' || lpad");
    expect(migration).toContain('customer_balance_before');
    expect(migration).toContain('customer_balance_after');
    expect(migration).toContain('numeric(18,2)');
    expect(migration).toContain('(previous.effective_date, previous.recorded_at, previous.id)');
    expect(migration).toContain('(payment.payment_date, payment.created_at, payment.id)');
    expect(migration).toContain("previous.status <> 'REJECTED'");
    expect(migration).toContain('previous.cancelled_at > current.recorded_at');
    expect(migration).toContain('collector_settlement_items item');
    expect(migration).toContain('payment_annulments annulment');
    expect(migration).toContain('CHK_collector_precollections_customer_balances');
    expect(migration).toContain("status = 'REJECTED'");
    expect(migration).toContain('rejected precollections have no temporal rejection audit');
    expect(migration).toContain('loan_edit_operations operation');
    expect(migration).toContain('operation.created_at > precollection.recorded_at');
    expect(migration).toContain('a loan was edited after a precollection');
  });
});
