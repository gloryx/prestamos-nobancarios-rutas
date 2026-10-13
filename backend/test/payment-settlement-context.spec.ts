import { readFileSync } from 'fs';
import { join } from 'path';
import { TransactionalPaymentRegistrar, TrustedSettlementPaymentContext } from '../src/application/payment/payment.use-case';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const input = { loanId: uuid(1), collectorId: uuid(2), methodId: uuid(3), amount: '1.00', paymentDate: '2026-10-12',
  idempotencyKey: `collector-settlement:precollection:${uuid(4)}` };

describe('trusted settlement payment context', () => {
  const registrar = new TransactionalPaymentRegistrar({ readValidTotals: jest.fn() } as never);
  it('prevents regular payment requests from spoofing the internal namespace', () => {
    expect(() => registrar.assertInput(input)).toThrow(expect.objectContaining({ reasonCode: 'RESERVED_IDEMPOTENCY_NAMESPACE' }));
  });
  it('accepts only a matching capability and excludes exactly its precollection in SQL', () => {
    const context = TrustedSettlementPaymentContext.forPrecollection(uuid(4), uuid(1), uuid(2));
    expect(() => registrar.assertInput(input, context)).not.toThrow();
    expect(() => registrar.assertInput({ ...input, loanId: uuid(5) }, context)).toThrow();
    const source = readFileSync(join(__dirname, '../src/application/payment/payment.use-case.ts'), 'utf8');
    expect(source).toContain('AND id <> $${reservationParams.push(context.precollectionId)}');
    expect(source).toContain("pg_advisory_xact_lock_shared(hashtext('financial-closes-v2'))");
  });
});
