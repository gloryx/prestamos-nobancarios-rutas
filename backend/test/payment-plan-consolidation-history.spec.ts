import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';
import { PaymentPlanConsolidationHistoryTypeormReader } from
  '../src/infrastructure/database/typeorm/repositories/payment-plan-consolidation-history.reader';
import { PAYMENT_PLAN_CONSOLIDATION_HISTORY_READER } from
  '../src/application/payment/payment-plan-consolidation-history.reader';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { PaymentModule } from '../src/presentation/payment/payment.module';
import { PaymentContextUseCase } from '../src/application/payment/payment.use-case';

describe('payment plan consolidation history read contract', () => {
  it('groups effective and reversed events with one ordered query and explicit moved amounts', async () => {
    const query = jest.fn().mockResolvedValue([
      { id: 'c1', paymentId: 'p1', effectivePaymentDate: '2026-10-12', totalMoved: '100.00',
        targetPlanEntryId: 't1', targetDueDate: '2026-10-13', targetSequence: 10,
        targetPendingBefore: '50.00', targetPendingAfter: '150.00', sourcePlanEntryId: 's1',
        sourceDueDate: '2026-10-10', sourceSequence: 8, amountMoved: '40.00', reversalId: null,
        paymentAnnulmentId: null },
      { id: 'c1', paymentId: 'p1', effectivePaymentDate: '2026-10-12', totalMoved: '100.00',
        targetPlanEntryId: 't1', targetDueDate: '2026-10-13', targetSequence: 10,
        targetPendingBefore: '50.00', targetPendingAfter: '150.00', sourcePlanEntryId: 's2',
        sourceDueDate: '2026-10-12', sourceSequence: 9, amountMoved: '60.00', reversalId: null,
        paymentAnnulmentId: null },
      { id: 'c2', paymentId: 'p2', effectivePaymentDate: '2026-10-14', totalMoved: '25.00',
        targetPlanEntryId: 't2', targetDueDate: '2026-10-15', targetSequence: 12,
        targetPendingBefore: '75.00', targetPendingAfter: '100.00', sourcePlanEntryId: 's3',
        sourceDueDate: '2026-10-14', sourceSequence: 11, amountMoved: '25.00', reversalId: 'r2',
        paymentAnnulmentId: 'a2' },
    ]);
    const result = await new PaymentPlanConsolidationHistoryTypeormReader({ query }).read('loan-1');
    expect(result).toEqual([
      { id: 'c1', paymentId: 'p1', effectivePaymentDate: '2026-10-12', totalMoved: '100.00', status: 'EFFECTIVE',
        target: { planEntryId: 't1', dueDate: '2026-10-13', sequence: 10, pendingBefore: '50.00', pendingAfter: '150.00' },
        sources: [{ planEntryId: 's1', dueDate: '2026-10-10', sequence: 8, amountMoved: '40.00' },
          { planEntryId: 's2', dueDate: '2026-10-12', sequence: 9, amountMoved: '60.00' }], reversal: null },
      { id: 'c2', paymentId: 'p2', effectivePaymentDate: '2026-10-14', totalMoved: '25.00', status: 'REVERSED',
        target: { planEntryId: 't2', dueDate: '2026-10-15', sequence: 12, pendingBefore: '75.00', pendingAfter: '100.00' },
        sources: [{ planEntryId: 's3', dueDate: '2026-10-14', sequence: 11, amountMoved: '25.00' }],
        reversal: { id: 'r2', paymentAnnulmentId: 'a2' } },
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('JOIN payment_plan_consolidation_sources'), ['loan-1']);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain('LEFT JOIN payment_plan_consolidation_reversals');
    expect(sql).toContain('ORDER BY header.effective_payment_date, header.created_at, header.id, source.ordinal');
    expect(sql).not.toContain('cash_movements');
  });

  it('returns an empty history without inferring events from the current plan', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await expect(new PaymentPlanConsolidationHistoryTypeormReader({ query }).read('historical-loan')).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('extends the existing payment loan detail under payments.view without adding a route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PaymentController.prototype.detail)).toBe('loans/:loanId');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PaymentController.prototype.detail)).toEqual(['payments.view']);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PaymentModule) as Array<{
      provide: unknown; inject?: unknown[];
    }>;
    expect(providers.find((provider) => provider.provide === PAYMENT_PLAN_CONSOLIDATION_HISTORY_READER)?.inject)
      .toHaveLength(1);
    expect(providers.find((provider) => provider.provide === PaymentContextUseCase)?.inject)
      .toContain(PAYMENT_PLAN_CONSOLIDATION_HISTORY_READER);
  });
});
